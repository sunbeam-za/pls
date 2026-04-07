/**
 * OpenAPI ingestion.
 *
 * We lean on well-tested libraries for the parts that have an ecosystem:
 *   - `js-yaml`                          → YAML + JSON text → JS object
 *   - `@apidevtools/swagger-parser`      → validate + dereference $refs
 *                                          (handles Swagger 2.0 and OpenAPI 3.x)
 *   - `openapi-sampler`                  → generate realistic example payloads
 *                                          from JSON Schema fragments
 *
 * Our own code only handles the two things that are app-specific:
 *   1. Mapping resolved operations → our `RequestItem` shape
 *   2. 3-way merging on resync so user edits survive spec updates
 */

import SwaggerParser from '@apidevtools/swagger-parser'
import yaml from 'js-yaml'
import { sample as sampleSchema } from 'openapi-sampler'
import type { OpenAPI, OpenAPIV2, OpenAPIV3, OpenAPIV3_1 } from 'openapi-types'

import type {
  Collection,
  HeaderEntry,
  HttpMethod,
  OpenApiLink,
  OpenApiSourceType,
  RequestItem,
  RequestNode,
  RequestSpecLink,
  RequestSpecSnapshot,
  TreeNode
} from '../../../preload/index'
import { newId } from './storage'

// Collect every request in the tree into a flat array, preserving order.
function flattenRequests(nodes: TreeNode[]): RequestItem[] {
  const out: RequestItem[] = []
  for (const node of nodes) {
    if (node.kind === 'request') out.push(node.request)
    else out.push(...flattenRequests(node.children))
  }
  return out
}

// Rebuild a tree by replacing each request (matched by id) with the
// version from `updates`. Requests that aren't in `updates` are dropped.
// Folder structure is preserved.
function replaceRequestsInTree(
  nodes: TreeNode[],
  updates: Map<string, RequestItem>
): TreeNode[] {
  const out: TreeNode[] = []
  for (const node of nodes) {
    if (node.kind === 'request') {
      const replacement = updates.get(node.request.id)
      if (replacement) {
        out.push({ kind: 'request', request: replacement } as RequestNode)
      }
      // Requests not present in `updates` are intentionally dropped —
      // callers decide what belongs before calling this.
    } else {
      out.push({ ...node, children: replaceRequestsInTree(node.children, updates) })
    }
  }
  return out
}

const HTTP_METHODS: readonly HttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS'
]
const METHOD_SET = new Set<string>(HTTP_METHODS)

// A fully dereferenced OpenAPI 3.x document. Swagger 2.0 inputs are still
// supported by swagger-parser but we normalize our walker to the OpenAPI 3.x
// shape for simplicity — the structural differences we care about (parameters,
// requestBody, servers) are handled below.
type AnyDocument = OpenAPIV3_1.Document | OpenAPIV3.Document | OpenAPIV2.Document
type AnyOperation =
  | OpenAPIV3_1.OperationObject
  | OpenAPIV3.OperationObject
  | OpenAPIV2.OperationObject
type AnyParameter = OpenAPIV3_1.ParameterObject | OpenAPIV3.ParameterObject | OpenAPIV2.Parameter
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySchema = any

// --- parsing ---

export class OpenApiParseError extends Error {}

/**
 * Parse spec text (JSON or YAML) into a JS object without any OpenAPI-specific
 * interpretation. `js-yaml` accepts JSON too, so this is the single entry point.
 */
function textToObject(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) throw new OpenApiParseError('Spec is empty')
  try {
    return yaml.load(trimmed)
  } catch (err) {
    throw new OpenApiParseError(
      `Could not parse spec as JSON or YAML: ${
        err instanceof Error ? err.message : String(err)
      }`
    )
  }
}

/**
 * Turn raw spec text into a fully dereferenced OpenAPI document. Accepts
 * Swagger 2.0 and OpenAPI 3.x, JSON or YAML.
 */
export async function loadDocument(text: string): Promise<AnyDocument> {
  const parsed = textToObject(text)
  if (!parsed || typeof parsed !== 'object') {
    throw new OpenApiParseError('Spec did not parse to an object')
  }
  try {
    // `dereference` resolves all $refs in place and returns the resolved doc.
    // Clone first so we don't mutate any cached copy the caller holds.
    const clone = JSON.parse(JSON.stringify(parsed))
    const doc = (await SwaggerParser.dereference(clone)) as unknown as AnyDocument
    return doc
  } catch (err) {
    throw new OpenApiParseError(
      `Invalid OpenAPI document: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

// --- hashing (stable FNV-1a) ---

export function hashSpec(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

// --- spec → requests ---

function pickBaseUrl(doc: AnyDocument): string | undefined {
  // OpenAPI 3.x
  const servers = (doc as OpenAPIV3.Document).servers
  if (servers && servers.length > 0 && servers[0]?.url) {
    return servers[0].url.replace(/\/+$/, '')
  }
  // Swagger 2.0
  const v2 = doc as OpenAPIV2.Document
  if (v2.host) {
    const scheme = v2.schemes?.[0] ?? 'https'
    const basePath = v2.basePath ?? ''
    return `${scheme}://${v2.host}${basePath}`.replace(/\/+$/, '')
  }
  return undefined
}

function sampleOrNull(schema: AnySchema, doc: AnyDocument): unknown {
  if (!schema || typeof schema !== 'object') return null
  try {
    return sampleSchema(schema, { skipNonRequired: false, quiet: true }, doc as object)
  } catch {
    return null
  }
}

function paramExample(param: AnyParameter, doc: AnyDocument): unknown {
  // OpenAPI 3.x: parameters carry a `schema`. Swagger 2.0: schema fields live
  // flat on the parameter object itself (or under `schema` for body params).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = param as any
  if (p.example !== undefined) return p.example
  if (p.schema?.example !== undefined) return p.schema.example
  if (p.schema) return sampleOrNull(p.schema, doc)
  // Swagger 2.0 inline schema fields
  if (p.type) return sampleOrNull(p, doc)
  return null
}

function buildBodyExample(op: AnyOperation, doc: AnyDocument): string {
  // OpenAPI 3.x: requestBody.content
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const req3 = (op as any).requestBody
  if (req3?.content && typeof req3.content === 'object') {
    const content = req3.content as Record<string, { schema?: AnySchema; example?: unknown; examples?: Record<string, { value?: unknown }> }>
    const preferredKey =
      'application/json' in content ? 'application/json' : Object.keys(content)[0]
    const entry = preferredKey ? content[preferredKey] : undefined
    if (entry) {
      if (entry.example !== undefined) {
        return typeof entry.example === 'string'
          ? entry.example
          : JSON.stringify(entry.example, null, 2)
      }
      const firstExample = entry.examples && Object.values(entry.examples)[0]?.value
      if (firstExample !== undefined) {
        return typeof firstExample === 'string'
          ? firstExample
          : JSON.stringify(firstExample, null, 2)
      }
      if (entry.schema) {
        const generated = sampleOrNull(entry.schema, doc)
        if (generated != null) return JSON.stringify(generated, null, 2)
      }
    }
  }
  // Swagger 2.0: parameters with `in: body`
  const params = ((op as OpenAPIV2.OperationObject).parameters ?? []) as AnyParameter[]
  const body = params.find((p) => 'in' in p && p.in === 'body') as
    | (OpenAPIV2.InBodyParameterObject & { schema?: AnySchema })
    | undefined
  if (body?.schema) {
    const generated = sampleOrNull(body.schema, doc)
    if (generated != null) return JSON.stringify(generated, null, 2)
  }
  return ''
}

function collectParameters(
  pathItem: OpenAPIV3.PathItemObject | OpenAPIV2.PathItemObject,
  op: AnyOperation
): AnyParameter[] {
  const shared = ((pathItem as OpenAPIV3.PathItemObject).parameters ?? []) as AnyParameter[]
  const opParams = ((op.parameters ?? []) as unknown) as AnyParameter[]
  return [...shared, ...opParams]
}

function buildUrl(
  baseUrl: string | undefined,
  path: string,
  params: AnyParameter[],
  doc: AnyDocument
): string {
  let url = (baseUrl ?? '') + path
  // Path params stay as literal {braces} so the user can see what to fill in.
  // Query params: attach required ones (or those with a concrete example).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query = (params as any[]).filter((p) => p.in === 'query' && (p.required || p.example !== undefined || p.schema?.example !== undefined))
  if (query.length > 0) {
    const qs = query
      .map((p) => {
        const v = paramExample(p as AnyParameter, doc) ?? ''
        return `${encodeURIComponent(p.name)}=${encodeURIComponent(String(v))}`
      })
      .join('&')
    url += (url.includes('?') ? '&' : '?') + qs
  }
  return url
}

function buildHeaders(
  op: AnyOperation,
  params: AnyParameter[],
  doc: AnyDocument
): HeaderEntry[] {
  const headers: HeaderEntry[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const p of params as any[]) {
    if (p.in !== 'header') continue
    const v = paramExample(p as AnyParameter, doc) ?? ''
    headers.push({ key: p.name, value: String(v), enabled: true })
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const req3 = (op as any).requestBody
  if (req3?.content?.['application/json']) {
    headers.push({ key: 'Content-Type', value: 'application/json', enabled: true })
  } else if (
    (op as OpenAPIV2.OperationObject).consumes &&
    (op as OpenAPIV2.OperationObject).consumes!.includes('application/json')
  ) {
    headers.push({ key: 'Content-Type', value: 'application/json', enabled: true })
  }
  return headers
}

function operationName(method: HttpMethod, path: string, op: AnyOperation): string {
  if (op.summary && op.summary.trim()) return op.summary.trim()
  if (op.operationId && op.operationId.trim()) return op.operationId.trim()
  return `${method} ${path}`
}

export interface ParsedOperation {
  operationId?: string
  path: string
  method: HttpMethod
  name: string
  snapshot: RequestSpecSnapshot
}

export function extractOperations(doc: AnyDocument): ParsedOperation[] {
  const baseUrl = pickBaseUrl(doc)
  const paths = (doc.paths ?? {}) as Record<
    string,
    OpenAPIV3.PathItemObject | OpenAPIV2.PathItemObject | undefined
  >
  const out: ParsedOperation[] = []
  for (const [path, pathItem] of Object.entries(paths)) {
    if (!pathItem) continue
    for (const methodKey of Object.keys(pathItem)) {
      const upper = methodKey.toUpperCase()
      if (!METHOD_SET.has(upper)) continue
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const op = (pathItem as any)[methodKey] as AnyOperation | undefined
      if (!op || typeof op !== 'object') continue
      const method = upper as HttpMethod
      const params = collectParameters(pathItem, op)
      const snapshot: RequestSpecSnapshot = {
        method,
        url: buildUrl(baseUrl, path, params, doc),
        headers: buildHeaders(op, params, doc),
        body: buildBodyExample(op, doc)
      }
      out.push({
        operationId: op.operationId,
        path,
        method,
        name: operationName(method, path, op),
        snapshot
      })
    }
  }
  return out
}

// --- building a fresh collection from a spec ---

export interface ImportResult {
  collection: Collection
  operationCount: number
}

export async function collectionFromSpec(
  text: string,
  sourceType: OpenApiSourceType,
  sourceLocation: string | undefined
): Promise<ImportResult> {
  const doc = await loadDocument(text)
  const operations = extractOperations(doc)
  const baseUrl = pickBaseUrl(doc)
  const info = (doc as OpenAPI.Document).info
  const link: OpenApiLink = {
    sourceType,
    sourceLocation,
    specText: text,
    specHash: hashSpec(text),
    lastSyncedAt: Date.now(),
    specTitle: info?.title,
    baseUrl
  }
  const requests: RequestItem[] = operations.map((op) => ({
    id: newId(),
    name: op.name,
    method: op.snapshot.method,
    url: op.snapshot.url,
    headers: op.snapshot.headers.map((h) => ({ ...h })),
    body: op.snapshot.body,
    spec: {
      operationId: op.operationId,
      specPath: op.path,
      specMethod: op.method,
      snapshot: cloneSnapshot(op.snapshot)
    } satisfies RequestSpecLink
  }))
  const collection: Collection = {
    id: newId(),
    name: info?.title?.trim() || 'Imported API',
    children: requests.map((request) => ({ kind: 'request', request })),
    openapi: link
  }
  return { collection, operationCount: operations.length }
}

// --- resync / 3-way merge ---

export interface SyncResult {
  collection: Collection
  added: number
  updated: number
  removed: number
  unchanged: number
  conflicts: number
}

function cloneSnapshot(snapshot: RequestSpecSnapshot): RequestSpecSnapshot {
  return {
    method: snapshot.method,
    url: snapshot.url,
    headers: snapshot.headers.map((h) => ({ ...h })),
    body: snapshot.body
  }
}

function opKey(op: { operationId?: string; path: string; method: HttpMethod }): string {
  return op.operationId ? `id:${op.operationId}` : `pm:${op.method} ${op.path}`
}

function requestKey(req: RequestItem): string | null {
  if (!req.spec) return null
  return req.spec.operationId
    ? `id:${req.spec.operationId}`
    : `pm:${req.spec.specMethod} ${req.spec.specPath}`
}

function headersEqual(a: HeaderEntry[], b: HeaderEntry[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].key !== b[i].key || a[i].value !== b[i].value || a[i].enabled !== b[i].enabled) {
      return false
    }
  }
  return true
}

/**
 * Apply a 3-way merge from an old snapshot to a new snapshot onto a request
 * that may have user edits. Rule per field: if current value equals the old
 * snapshot, the user hasn't touched it — pull in the new value. Otherwise the
 * user edited it; keep their value (a "conflict" for reporting purposes).
 */
function mergeRequest(
  req: RequestItem,
  newOp: ParsedOperation
): { next: RequestItem; changed: boolean; conflict: boolean } {
  const old = req.spec?.snapshot
  const fresh = newOp.snapshot
  let changed = false
  let conflict = false

  const next: RequestItem = { ...req }

  if (!old || req.method === old.method) {
    if (next.method !== fresh.method) {
      next.method = fresh.method
      changed = true
    }
  } else if (req.method !== fresh.method) {
    conflict = true
  }

  if (!old || req.url === old.url) {
    if (next.url !== fresh.url) {
      next.url = fresh.url
      changed = true
    }
  } else if (req.url !== fresh.url) {
    conflict = true
  }

  if (!old || req.body === old.body) {
    if (next.body !== fresh.body) {
      next.body = fresh.body
      changed = true
    }
  } else if (req.body !== fresh.body) {
    conflict = true
  }

  // Headers as an atomic block — simpler to reason about than per-key merge.
  if (!old || headersEqual(req.headers, old.headers)) {
    if (!headersEqual(next.headers, fresh.headers)) {
      next.headers = fresh.headers.map((h) => ({ ...h }))
      changed = true
    }
  } else if (!headersEqual(req.headers, fresh.headers)) {
    conflict = true
  }

  next.spec = {
    operationId: newOp.operationId,
    specPath: newOp.path,
    specMethod: newOp.method,
    snapshot: cloneSnapshot(fresh)
  }

  return { next, changed, conflict }
}

/**
 * Re-sync a collection against a new version of its OpenAPI spec.
 *
 * Behaviour:
 *  - Matching existing requests (by operationId, falling back to method+path)
 *    get a 3-way merge applied.
 *  - Operations present in the new spec but missing from the collection are
 *    appended as new requests.
 *  - Requests whose linked operation is no longer in the spec are KEPT but
 *    have their `.spec` link stripped — they become orphans but survive so
 *    users don't lose custom work. Reported in `removed`.
 *  - Requests that were never linked to the spec (user-added) are untouched.
 */
export async function resyncCollection(
  collection: Collection,
  newSpecText: string
): Promise<SyncResult> {
  if (!collection.openapi) {
    throw new Error('Collection is not linked to an OpenAPI spec')
  }
  const doc = await loadDocument(newSpecText)
  const operations = extractOperations(doc)
  const baseUrl = pickBaseUrl(doc)
  const info = (doc as OpenAPI.Document).info

  const opsByKey = new Map<string, ParsedOperation>()
  for (const op of operations) opsByKey.set(opKey(op), op)

  const seen = new Set<string>()
  let added = 0
  let updated = 0
  let removed = 0
  let unchanged = 0
  let conflicts = 0

  // Flatten the current tree so the merge can work on a flat list. We
  // preserve the tree structure when rebuilding — each existing request
  // stays exactly where it was (root or folder), only the request payload
  // changes. New spec-added requests land at the collection root.
  const existingRequests = flattenRequests(collection.children)
  const mergedRequests: RequestItem[] = existingRequests.map((req) => {
    const key = requestKey(req)
    if (!key) return req // user-added request

    const match = opsByKey.get(key)
    if (!match) {
      removed++
      return { ...req, spec: undefined }
    }
    seen.add(key)
    const { next, changed, conflict } = mergeRequest(req, match)
    if (conflict) conflicts++
    if (changed) {
      updated++
    } else {
      unchanged++
    }
    return next
  })

  const newRequestNodes: RequestNode[] = []
  for (const op of operations) {
    const key = opKey(op)
    if (seen.has(key)) continue
    added++
    newRequestNodes.push({
      kind: 'request',
      request: {
        id: newId(),
        name: op.name,
        method: op.snapshot.method,
        url: op.snapshot.url,
        headers: op.snapshot.headers.map((h) => ({ ...h })),
        body: op.snapshot.body,
        spec: {
          operationId: op.operationId,
          specPath: op.path,
          specMethod: op.method,
          snapshot: cloneSnapshot(op.snapshot)
        }
      }
    })
  }

  // Rebuild the tree with the merged requests in their original positions,
  // then append any newly-added spec requests at the collection root.
  const updatesById = new Map(mergedRequests.map((r) => [r.id, r]))
  const rebuiltChildren = replaceRequestsInTree(collection.children, updatesById)
  rebuiltChildren.push(...newRequestNodes)

  const nextCollection: Collection = {
    ...collection,
    children: rebuiltChildren,
    openapi: {
      ...collection.openapi,
      specText: newSpecText,
      specHash: hashSpec(newSpecText),
      lastSyncedAt: Date.now(),
      specTitle: info?.title ?? collection.openapi.specTitle,
      baseUrl: baseUrl ?? collection.openapi.baseUrl
    }
  }

  return { collection: nextCollection, added, updated, removed, unchanged, conflicts }
}
