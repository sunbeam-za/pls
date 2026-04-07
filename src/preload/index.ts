import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

export interface HeaderEntry {
  key: string
  value: string
  enabled: boolean
}

/**
 * Snapshot of the canonical values an OpenAPI operation produced for a request.
 * Used for 3-way merges on resync: any field the user hasn't touched (i.e. still
 * equals the snapshot) is updated to the new spec value; fields the user edited
 * are preserved.
 */
export interface RequestSpecSnapshot {
  method: HttpMethod
  url: string
  headers: HeaderEntry[]
  body: string
}

export interface RequestSpecLink {
  /** operationId if the spec provided one — preferred identity key. */
  operationId?: string
  /** Templated path, e.g. "/users/{id}". Used as fallback identity. */
  specPath: string
  specMethod: HttpMethod
  /** Canonical values at last sync — used for drift detection. */
  snapshot: RequestSpecSnapshot
}

export interface RequestItem {
  id: string
  name: string
  method: HttpMethod
  url: string
  headers: HeaderEntry[]
  body: string
  /** Present when this request was generated from an OpenAPI operation. */
  spec?: RequestSpecLink
}

export type OpenApiSourceType = 'url' | 'file' | 'text'

export interface OpenApiLink {
  sourceType: OpenApiSourceType
  /** URL or absolute file path. Absent for 'text' sources. */
  sourceLocation?: string
  /** Raw spec text as last synced. Kept so we can re-parse/diff offline. */
  specText: string
  specHash: string
  lastSyncedAt: number
  /** Title from info.title (what we used to name the collection). */
  specTitle?: string
  /** Chosen base URL (first `servers[].url`), used when building request URLs. */
  baseUrl?: string
}

export interface Collection {
  id: string
  name: string
  requests: RequestItem[]
  /** Present when this collection was generated from an OpenAPI spec. */
  openapi?: OpenApiLink
}

export interface HistoryEntry {
  id: string
  sentAt: number
  requestId?: string
  requestName?: string
  method: HttpMethod
  url: string
  headers: HeaderEntry[]
  body: string
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

export interface Store {
  collections: Collection[]
  history?: HistoryEntry[]
}

export interface LoadSpecResult {
  ok: boolean
  text?: string
  sourceType?: OpenApiSourceType
  sourceLocation?: string
  error?: string
}

export interface SendRequestPayload {
  method: HttpMethod
  url: string
  headers: HeaderEntry[]
  body: string
}

export interface SendRequestResult {
  ok: boolean
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
  durationMs: number
  size: number
  error?: string
}

export interface McpInfo {
  command: string
  args: string[]
  ready: boolean
  installed: { claudeDesktop: boolean; cursor: boolean; claudeCode: boolean }
}

const api = {
  readStore: (): Promise<Store> => ipcRenderer.invoke('store:read'),
  writeStore: (store: Store): Promise<boolean> => ipcRenderer.invoke('store:write', store),
  sendRequest: (payload: SendRequestPayload): Promise<SendRequestResult> =>
    ipcRenderer.invoke('http:send', payload),
  loadSpecFromUrl: (url: string): Promise<LoadSpecResult> =>
    ipcRenderer.invoke('openapi:loadFromUrl', url),
  loadSpecFromFile: (): Promise<LoadSpecResult> => ipcRenderer.invoke('openapi:loadFromFile'),
  mcpInfo: (): Promise<McpInfo> => ipcRenderer.invoke('mcp:info'),
  getFavicon: (domain: string): Promise<string | null> =>
    ipcRenderer.invoke('favicon:get', domain)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
