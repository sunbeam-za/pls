// Canonical store types, shared by the Electron main process and the
// standalone MCP server. Must match src/preload/index.ts — the renderer
// imports from preload, everything else imports from here.

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

export interface HeaderEntry {
  key: string
  value: string
  enabled: boolean
}

export interface RequestSpecSnapshot {
  method: HttpMethod
  url: string
  headers: HeaderEntry[]
  body: string
}

export interface RequestSpecLink {
  operationId?: string
  specPath: string
  specMethod: HttpMethod
  snapshot: RequestSpecSnapshot
}

export interface RequestItem {
  id: string
  name: string
  method: HttpMethod
  url: string
  headers: HeaderEntry[]
  body: string
  spec?: RequestSpecLink
}

export type OpenApiSourceType = 'url' | 'file' | 'text'

export interface OpenApiLink {
  sourceType: OpenApiSourceType
  sourceLocation?: string
  specText: string
  specHash: string
  lastSyncedAt: number
  specTitle?: string
  baseUrl?: string
}

export interface Collection {
  id: string
  name: string
  requests: RequestItem[]
  openapi?: OpenApiLink
}

/**
 * One entry per successful OR failed send. Stored at the store root, not
 * per-collection, so the UI can show a flat chronological feed regardless
 * of where the request came from (saved request, ad-hoc, or MCP-driven).
 */
export interface HistoryEntry {
  id: string
  /** Unix ms when the request was sent. */
  sentAt: number
  /** Optional link back to the saved request, if there was one. */
  requestId?: string
  requestName?: string
  method: HttpMethod
  url: string
  headers: HeaderEntry[]
  body: string
  /** Result snapshot. Body is truncated at write time — see HISTORY_BODY_MAX. */
  response: {
    ok: boolean
    status: number
    statusText: string
    durationMs: number
    size: number
    error?: string
    bodyPreview: string
    bodyTruncated: boolean
  }
}

export const HISTORY_MAX_ENTRIES = 200
/** How many bytes of response body we persist per history entry. */
export const HISTORY_BODY_MAX = 64 * 1024

export interface Store {
  collections: Collection[]
  history?: HistoryEntry[]
}

export const emptyStore = (): Store => ({ collections: [], history: [] })

export const newId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
