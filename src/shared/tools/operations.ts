// Tool-shaped operations over the store + HTTP. Pure async functions, no
// Electron, no MCP SDK. Both the in-app assistant (later) and the MCP server
// wrap these. Both the storage and the HTTP transport are injected via
// adapters, so the same tool surface works against a file + fetch, a
// memory store + mock transport, or anything in between.

import type { HttpAdapter } from '../http/adapter.js'
import type { SendRequestResult } from '../http/types.js'
import type { SecretsAdapter } from '../secrets/adapter.js'
import { createEnvSecretsAdapter } from '../secrets/adapters/env.js'
import type { StorageAdapter } from '../store/adapter.js'
import type {
  Collection,
  FolderNode,
  HeaderEntry,
  HistoryEntry,
  HttpMethod,
  RequestItem,
  RequestNode,
  Store
} from '../store/types.js'
import {
  countRequests,
  findFolderInTree,
  findRequestAncestry,
  findRequestInTree,
  HISTORY_BODY_MAX,
  HISTORY_MAX_ENTRIES,
  newId,
  walkRequests
} from '../store/types.js'
import { applyQueryParams, resolveAuthProfile } from './auth.js'

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

export class ToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolError'
  }
}

// ---------- Shape helpers ----------

export interface CollectionSummary {
  id: string
  name: string
  requestCount: number
  hasSpec: boolean
  specTitle?: string
}

export interface RequestSummary {
  id: string
  collectionId: string
  name: string
  method: HttpMethod
  url: string
}

export interface RequestDetail extends RequestSummary {
  headers: HeaderEntry[]
  body: string
  fromSpec?: { operationId?: string; specPath: string; specMethod: HttpMethod }
}

const summarizeCollection = (c: Collection): CollectionSummary => ({
  id: c.id,
  name: c.name,
  requestCount: countRequests(c.children),
  hasSpec: !!c.openapi,
  specTitle: c.openapi?.specTitle
})

const summarizeRequest = (c: Collection, r: RequestItem): RequestSummary => ({
  id: r.id,
  collectionId: c.id,
  name: r.name,
  method: r.method,
  url: r.url
})

const detailRequest = (c: Collection, r: RequestItem): RequestDetail => ({
  ...summarizeRequest(c, r),
  headers: r.headers,
  body: r.body,
  fromSpec: r.spec
    ? { operationId: r.spec.operationId, specPath: r.spec.specPath, specMethod: r.spec.specMethod }
    : undefined
})

function findRequest(
  store: Store,
  requestId: string
): { collection: Collection; request: RequestItem } {
  for (const c of store.config.collections) {
    const hit = findRequestInTree(c.children, requestId)
    if (hit) return { collection: c, request: hit.request }
  }
  throw new ToolError(`request not found: ${requestId}`)
}

function findCollection(store: Store, collectionId: string): Collection {
  const c = store.config.collections.find((x) => x.id === collectionId)
  if (!c) throw new ToolError(`collection not found: ${collectionId}`)
  return c
}

/**
 * Locate a request + the full ancestry chain (collection + enclosing
 * folders). The ancestry is what `sendSavedRequest` walks to build
 * inherited headers and auth.
 */
function findRequestWithAncestry(
  store: Store,
  requestId: string
): { collection: Collection; folders: FolderNode[]; request: RequestItem } {
  for (const c of store.config.collections) {
    const hit = findRequestAncestry(c.children, requestId)
    if (hit) return { collection: c, folders: hit.folders, request: hit.request }
  }
  throw new ToolError(`request not found: ${requestId}`)
}

/**
 * Merge several header lists into one. Later lists override earlier by
 * case-insensitive header key. Disabled header entries are carried
 * through so the user's intent is preserved — the HTTP adapter is the
 * one place that filters them out at send time.
 */
function mergeHeadersChain(chain: Array<HeaderEntry[] | undefined>): HeaderEntry[] {
  const byKey = new Map<string, HeaderEntry>()
  for (const list of chain) {
    if (!list) continue
    for (const h of list) {
      if (!h.key?.trim()) continue
      byKey.set(h.key.toLowerCase(), { ...h })
    }
  }
  return Array.from(byKey.values())
}

/**
 * Turn a send payload + result into a HistoryEntry. The body preview is
 * truncated at HISTORY_BODY_MAX so the store file doesn't bloat when
 * agents hit endpoints that return megabytes of JSON.
 */
function buildHistoryEntry(
  send: {
    method: HttpMethod
    url: string
    headers: HeaderEntry[]
    body: string
    requestId?: string
    requestName?: string
  },
  result: SendRequestResult
): HistoryEntry {
  const body = result.body ?? ''
  const truncated = body.length > HISTORY_BODY_MAX
  return {
    id: newId(),
    sentAt: Date.now(),
    requestId: send.requestId,
    requestName: send.requestName,
    method: send.method,
    url: send.url,
    headers: send.headers,
    body: send.body,
    response: {
      ok: result.ok,
      status: result.status,
      statusText: result.statusText,
      durationMs: result.durationMs,
      size: result.size,
      error: result.error,
      bodyPreview: truncated ? body.slice(0, HISTORY_BODY_MAX) : body,
      bodyTruncated: truncated
    }
  }
}

function normalizeHeaders(headers: unknown): HeaderEntry[] {
  if (!Array.isArray(headers)) return []
  const out: HeaderEntry[] = []
  for (const h of headers) {
    if (!h || typeof h !== 'object') continue
    const entry = h as Partial<HeaderEntry>
    if (typeof entry.key !== 'string') continue
    out.push({
      key: entry.key,
      value: typeof entry.value === 'string' ? entry.value : '',
      enabled: entry.enabled !== false
    })
  }
  return out
}

function normalizeMethod(method: unknown, fallback: HttpMethod = 'GET'): HttpMethod {
  if (typeof method !== 'string') return fallback
  const upper = method.toUpperCase() as HttpMethod
  return METHODS.includes(upper) ? upper : fallback
}

// ---------- Operations ----------

export interface Ops {
  listCollections(): Promise<CollectionSummary[]>
  listRequests(collectionId: string): Promise<RequestSummary[]>
  getRequest(requestId: string): Promise<RequestDetail>
  createCollection(name: string): Promise<CollectionSummary>
  createRequest(input: {
    collectionId: string
    name?: string
    method?: HttpMethod
    url?: string
    headers?: HeaderEntry[]
    body?: string
  }): Promise<RequestDetail>
  updateRequest(
    requestId: string,
    patch: {
      name?: string
      method?: HttpMethod
      url?: string
      headers?: HeaderEntry[]
      body?: string
    }
  ): Promise<RequestDetail>
  deleteRequest(requestId: string): Promise<{ deleted: true; id: string }>
  /**
   * Create a folder at the root of a collection, or inside another folder
   * if `parentFolderId` is given. Folders are purely organisational — the
   * inheritance behaviour (headers, auth) is controlled by the caller
   * populating `defaultHeaders` / `authProfileId` afterwards.
   */
  createFolder(input: {
    collectionId: string
    name?: string
    parentFolderId?: string
  }): Promise<{ id: string; name: string }>
  deleteFolder(folderId: string): Promise<{ deleted: true; id: string }>
  sendSavedRequest(
    requestId: string,
    overrides?: { url?: string; headers?: HeaderEntry[]; body?: string }
  ): Promise<SendRequestResult>
  sendAdHoc(payload: {
    method: HttpMethod
    url: string
    headers?: HeaderEntry[]
    body?: string
  }): Promise<SendRequestResult>
}

export interface OpsAdapters {
  storage: StorageAdapter
  http: HttpAdapter
  /** Optional secrets resolver. Defaults to env-vars if omitted. */
  secrets?: SecretsAdapter
}

/**
 * Find the nearest auth profile id, walking the ancestry chain upward
 * from the request: request → closest folder with one → farther folders
 * → collection. Returns undefined if nothing along the chain has
 * opinions about auth.
 */
function resolveEffectiveProfileId(
  collection: Collection,
  folders: FolderNode[],
  request: RequestItem
): string | undefined {
  if (request.authProfileId) return request.authProfileId
  // Walk folders inside-out (closest ancestor wins).
  for (let i = folders.length - 1; i >= 0; i--) {
    if (folders[i].authProfileId) return folders[i].authProfileId
  }
  return collection.authProfileId
}

export function createOps(adapters: OpsAdapters): Ops {
  const { storage: adapter, http } = adapters
  const secrets = adapters.secrets ?? createEnvSecretsAdapter()
  return {
    async listCollections() {
      const store = await adapter.read()
      return store.config.collections.map(summarizeCollection)
    },

    async listRequests(collectionId) {
      const store = await adapter.read()
      const collection = findCollection(store, collectionId)
      const out: RequestSummary[] = []
      for (const r of walkRequests(collection.children)) {
        out.push(summarizeRequest(collection, r))
      }
      return out
    },

    async getRequest(requestId) {
      const store = await adapter.read()
      const { collection, request } = findRequest(store, requestId)
      return detailRequest(collection, request)
    },

    async createCollection(name) {
      return adapter.mutate((store) => {
        const collection: Collection = {
          id: newId(),
          name: name.trim() || 'New collection',
          children: []
        }
        store.config.collections.push(collection)
        return summarizeCollection(collection)
      })
    },

    async createRequest(input) {
      return adapter.mutate((store) => {
        const collection = findCollection(store, input.collectionId)
        const request: RequestItem = {
          id: newId(),
          name: input.name?.trim() || 'Untitled request',
          method: normalizeMethod(input.method, 'GET'),
          url: input.url ?? '',
          headers: normalizeHeaders(input.headers),
          body: input.body ?? ''
        }
        // New requests land at the collection root. A separate tool
        // (create_request_in_folder, future) can target a nested folder.
        collection.children.push({ kind: 'request', request } as RequestNode)
        return detailRequest(collection, request)
      })
    },

    async updateRequest(requestId, patch) {
      return adapter.mutate((store) => {
        const { collection, request } = findRequest(store, requestId)
        if (patch.name !== undefined) request.name = patch.name
        if (patch.method !== undefined) request.method = normalizeMethod(patch.method, request.method)
        if (patch.url !== undefined) request.url = patch.url
        if (patch.headers !== undefined) request.headers = normalizeHeaders(patch.headers)
        if (patch.body !== undefined) request.body = patch.body
        return detailRequest(collection, request)
      })
    },

    async deleteRequest(requestId) {
      return adapter.mutate((store) => {
        for (const c of store.config.collections) {
          const hit = findRequestInTree(c.children, requestId)
          if (hit) {
            hit.container.splice(hit.index, 1)
            return { deleted: true as const, id: requestId }
          }
        }
        throw new ToolError(`request not found: ${requestId}`)
      })
    },

    async createFolder(input) {
      return adapter.mutate((store) => {
        const collection = findCollection(store, input.collectionId)
        const folder: FolderNode = {
          kind: 'folder',
          id: newId(),
          name: input.name?.trim() || 'New folder',
          children: []
        }
        if (input.parentFolderId) {
          const hit = findFolderInTree(collection.children, input.parentFolderId)
          if (!hit) throw new ToolError(`folder not found: ${input.parentFolderId}`)
          hit.folder.children.push(folder)
        } else {
          collection.children.push(folder)
        }
        return { id: folder.id, name: folder.name }
      })
    },

    async deleteFolder(folderId) {
      return adapter.mutate((store) => {
        for (const c of store.config.collections) {
          const hit = findFolderInTree(c.children, folderId)
          if (hit) {
            hit.container.splice(hit.index, 1)
            return { deleted: true as const, id: folderId }
          }
        }
        throw new ToolError(`folder not found: ${folderId}`)
      })
    },

    async sendSavedRequest(requestId, overrides) {
      const store = await adapter.read()
      const { request, collection, folders } = findRequestWithAncestry(store, requestId)
      // Postman-style header inheritance: collection defaults, then each
      // folder top-down, then the request. Later keys overwrite earlier
      // ones (case-insensitive match on key), which is what every client
      // using this store will expect.
      const baseHeaders = mergeHeadersChain([
        collection.defaultHeaders,
        ...folders.map((f) => f.defaultHeaders),
        request.headers
      ])

      // Auth resolution. Walk the ancestry looking for the closest
      // profile id, look the profile up, then resolve its secret refs
      // via the injected SecretsAdapter. Auth-contributed headers merge
      // on top of the inherited chain so a request-level Authorization
      // header still wins if the user set one explicitly.
      const profileId = resolveEffectiveProfileId(collection, folders, request)
      const profile = profileId
        ? store.config.authProfiles.find((p) => p.id === profileId)
        : undefined
      const auth = await resolveAuthProfile(profile, secrets)
      const mergedHeaders = mergeHeadersChain([auth.headers, baseHeaders])

      const targetUrl = overrides?.url ?? request.url
      const urlWithAuthQuery = applyQueryParams(targetUrl, auth.queryParams)

      const payload = {
        method: request.method,
        url: urlWithAuthQuery,
        headers: overrides?.headers ?? mergedHeaders,
        body: overrides?.body ?? request.body
      }
      const result = await http.send(payload)
      // Record in history so the live feed and persistent log both see it.
      // The mutate runs *after* the HTTP call so we don't hold the file
      // lock during the network round-trip.
      await adapter.mutate((s) => {
        const entry = buildHistoryEntry(
          { ...payload, requestId: request.id, requestName: request.name },
          result
        )
        s.state.history = [entry, ...s.state.history].slice(0, HISTORY_MAX_ENTRIES)
      })
      return result
    },

    async sendAdHoc(payload) {
      const normalized = {
        method: normalizeMethod(payload.method, 'GET'),
        url: payload.url,
        headers: normalizeHeaders(payload.headers),
        body: payload.body ?? ''
      }
      const result = await http.send(normalized)
      await adapter.mutate((s) => {
        const entry = buildHistoryEntry(normalized, result)
        s.state.history = [entry, ...s.state.history].slice(0, HISTORY_MAX_ENTRIES)
      })
      return result
    }
  }
}
