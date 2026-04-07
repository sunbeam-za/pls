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

// ---------- Config layer ----------
// (Persistent, user-authored, shareable. What you'd check into git.)

export type SecretRef = string

export type AuthType = 'none' | 'bearer' | 'basic' | 'api-key'

export interface AuthProfile {
  id: string
  name: string
  type: AuthType
  config:
    | { type: 'none' }
    | { type: 'bearer'; tokenRef: SecretRef }
    | { type: 'basic'; usernameRef: SecretRef; passwordRef: SecretRef }
    | { type: 'api-key'; in: 'header' | 'query'; name: string; valueRef: SecretRef }
}

export interface RequestItem {
  id: string
  name: string
  method: HttpMethod
  url: string
  headers: HeaderEntry[]
  body: string
  /** Overrides the collection's inherited auth profile. Undefined = inherit. */
  authProfileId?: string
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

export interface FolderNode {
  kind: 'folder'
  id: string
  name: string
  children: TreeNode[]
  defaultHeaders?: HeaderEntry[]
  authProfileId?: string
}

export interface RequestNode {
  kind: 'request'
  request: RequestItem
}

export type TreeNode = FolderNode | RequestNode

export interface Collection {
  id: string
  name: string
  /** Recursive tree of folders and requests. */
  children: TreeNode[]
  /** Headers every request inherits. Merged by key at send time. */
  defaultHeaders?: HeaderEntry[]
  /** Auth profile every request inherits unless it sets its own. */
  authProfileId?: string
  openapi?: OpenApiLink
}

export interface ConfigSlice {
  collections: Collection[]
  authProfiles: AuthProfile[]
}

// ---------- Context layer ----------
// (Per-machine. Shape may be shared, values never exported.)

export interface Environment {
  id: string
  name: string
  variables: Record<string, string>
}

export interface ContextSlice {
  environments: Environment[]
  activeEnvironmentId?: string
}

// ---------- State layer ----------
// (Persisted runtime telemetry; never exported unless explicitly opted in.)

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

export interface StateSlice {
  history: HistoryEntry[]
}

// ---------- Root ----------

export interface Store {
  config: ConfigSlice
  context: ContextSlice
  state: StateSlice
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

export interface CollectionExport {
  pls: 1
  kind: 'collection-export'
  exportedAt: number
  collection: Collection
  authProfiles: AuthProfile[]
  history: HistoryEntry[]
}

export interface ExportCollectionResult {
  ok: boolean
  path?: string
  error?: string
}

export interface ImportCollectionResult {
  ok: boolean
  bundle?: CollectionExport
  error?: string
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
    ipcRenderer.invoke('favicon:get', domain),
  exportCollection: (args: {
    collectionId: string
    defaultName: string
    collection: Collection
    authProfiles: AuthProfile[]
    history: HistoryEntry[]
  }): Promise<ExportCollectionResult> => ipcRenderer.invoke('collection:export', args),
  importCollection: (): Promise<ImportCollectionResult> =>
    ipcRenderer.invoke('collection:import'),
  // Live feed: append our own entry and subscribe to entries written by
  // any process (us, the MCP server, a future sidecar). The subscription
  // returns an unsubscribe fn so callers can clean up on unmount.
  appendHistory: (entry: HistoryEntry): Promise<HistoryEntry[]> =>
    ipcRenderer.invoke('history:append', entry),
  readHistory: (): Promise<HistoryEntry[]> => ipcRenderer.invoke('history:read'),
  onHistoryAppended: (callback: (entries: HistoryEntry[]) => void): (() => void) => {
    const handler = (_event: unknown, entries: HistoryEntry[]): void => callback(entries)
    ipcRenderer.on('history:appended', handler)
    return (): void => {
      ipcRenderer.off('history:appended', handler)
    }
  }
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
