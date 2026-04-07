// Tool-shaped operations over the store + HTTP. Pure async functions, no
// Electron, no MCP SDK. Both the in-app assistant (later) and the MCP server
// wrap these. Both the storage and the HTTP transport are injected via
// adapters, so the same tool surface works against a file + fetch, a
// memory store + mock transport, or anything in between.

import type { HttpAdapter } from '../http/adapter.js'
import type { SendRequestResult } from '../http/types.js'
import type { StorageAdapter } from '../store/adapter.js'
import type { Collection, HeaderEntry, HttpMethod, RequestItem, Store } from '../store/types.js'
import { newId } from '../store/types.js'

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
  requestCount: c.requests.length,
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
  for (const c of store.collections) {
    const r = c.requests.find((x) => x.id === requestId)
    if (r) return { collection: c, request: r }
  }
  throw new ToolError(`request not found: ${requestId}`)
}

function findCollection(store: Store, collectionId: string): Collection {
  const c = store.collections.find((x) => x.id === collectionId)
  if (!c) throw new ToolError(`collection not found: ${collectionId}`)
  return c
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
}

export function createOps(adapters: OpsAdapters): Ops {
  const { storage: adapter, http } = adapters
  return {
    async listCollections() {
      const store = await adapter.read()
      return store.collections.map(summarizeCollection)
    },

    async listRequests(collectionId) {
      const store = await adapter.read()
      const collection = findCollection(store, collectionId)
      return collection.requests.map((r) => summarizeRequest(collection, r))
    },

    async getRequest(requestId) {
      const store = await adapter.read()
      const { collection, request } = findRequest(store, requestId)
      return detailRequest(collection, request)
    },

    async createCollection(name) {
      return adapter.mutate((store) => {
        const collection: Collection = { id: newId(), name: name.trim() || 'New collection', requests: [] }
        store.collections.push(collection)
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
        collection.requests.push(request)
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
        for (const c of store.collections) {
          const idx = c.requests.findIndex((r) => r.id === requestId)
          if (idx >= 0) {
            c.requests.splice(idx, 1)
            return { deleted: true as const, id: requestId }
          }
        }
        throw new ToolError(`request not found: ${requestId}`)
      })
    },

    async sendSavedRequest(requestId, overrides) {
      const store = await adapter.read()
      const { request } = findRequest(store, requestId)
      return http.send({
        method: request.method,
        url: overrides?.url ?? request.url,
        headers: overrides?.headers ?? request.headers,
        body: overrides?.body ?? request.body
      })
    },

    async sendAdHoc(payload) {
      return http.send({
        method: normalizeMethod(payload.method, 'GET'),
        url: payload.url,
        headers: normalizeHeaders(payload.headers),
        body: payload.body ?? ''
      })
    }
  }
}
