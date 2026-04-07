// Canonical store types, shared by the Electron main process, the
// standalone MCP server, and the renderer (via preload re-export).
//
// The store is split into three lifetime layers:
//
//   config   — user-authored, persistent, shareable (what you'd commit)
//   context  — per-machine, persistent, values never exported
//              (secrets, active environment)
//   state    — persisted runtime telemetry (history, UI prefs)
//
// The rule: config is what you'd check into git, context is what you'd put
// in .env, state is what you'd lose on quit. Every field has to answer that
// question before it lands somewhere.

// ---------- Primitives ----------

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

export interface HeaderEntry {
  key: string
  value: string
  enabled: boolean
}

// ---------- Config layer ----------

/**
 * Where a secret value lives. The value itself is never in config — the
 * config only holds a *reference* to where the value should be looked up,
 * so the same exported collection can run anywhere the same refs resolve.
 *
 * Format: `"<kind>:<id>"` — e.g. `"env:GITHUB_PAT"` or `"keychain:pls.github"`.
 * The resolver (a SecretsAdapter, added later) maps refs to values.
 */
export type SecretRef = string

export type AuthType = 'none' | 'bearer' | 'basic' | 'api-key'

export interface AuthProfile {
  id: string
  name: string
  type: AuthType
  /**
   * Shape varies by type. All fields that hold credentials are `SecretRef`
   * strings, never raw values, so a profile is safe to export.
   */
  config:
    | { type: 'none' }
    | { type: 'bearer'; tokenRef: SecretRef }
    | { type: 'basic'; usernameRef: SecretRef; passwordRef: SecretRef }
    | { type: 'api-key'; in: 'header' | 'query'; name: string; valueRef: SecretRef }
}

/**
 * Snapshot of the canonical values an OpenAPI operation produced for a
 * request. Used for 3-way merges on resync: any field the user hasn't
 * touched (i.e. still equals the snapshot) is updated to the new spec
 * value; fields the user edited are preserved.
 */
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

/**
 * A folder inside a collection. Folders can contain other folders, so
 * nesting is arbitrary. Each folder can contribute its own defaultHeaders
 * and authProfileId, which cascade to every descendant request unless
 * that request (or a closer folder) overrides.
 */
export interface FolderNode {
  kind: 'folder'
  id: string
  name: string
  children: TreeNode[]
  defaultHeaders?: HeaderEntry[]
  authProfileId?: string
}

/**
 * A request inside a collection tree. We wrap the request in a node
 * envelope rather than adding a `kind` field to RequestItem so that the
 * request payload itself stays clean and portable — the envelope is
 * purely a tree-structure concern.
 */
export interface RequestNode {
  kind: 'request'
  request: RequestItem
}

export type TreeNode = FolderNode | RequestNode

export interface Collection {
  id: string
  name: string
  /**
   * Tree of folders and requests in the order the user wants to see them.
   * Replaces the legacy flat `requests` array — still honoured on read
   * via migration, never written.
   */
  children: TreeNode[]
  /**
   * Headers every request in this collection inherits. Merged by key at
   * send time — a request header with the same key wins. Folders can
   * layer their own headers on top; a request header wins over both.
   */
  defaultHeaders?: HeaderEntry[]
  /** Auth profile every request inherits unless it sets its own. */
  authProfileId?: string
  /** Present when generated from an OpenAPI spec. */
  openapi?: OpenApiLink
}

// ---------- Tree helpers ----------
// These walk the TreeNode tree recursively. They live here (in types.ts)
// because they're the primitive operations every consumer — renderer,
// shared tools, MCP server — needs and they have zero dependencies.

export function* walkRequests(nodes: TreeNode[]): Generator<RequestItem> {
  for (const node of nodes) {
    if (node.kind === 'request') {
      yield node.request
    } else {
      yield* walkRequests(node.children)
    }
  }
}

export function countRequests(nodes: TreeNode[]): number {
  let n = 0
  for (const _ of walkRequests(nodes)) n++
  return n
}

/**
 * Find a request by id. Returns the request + the array that holds it
 * and the index, so callers can mutate in place.
 */
export function findRequestInTree(
  nodes: TreeNode[],
  requestId: string
): { request: RequestItem; container: TreeNode[]; index: number } | null {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (node.kind === 'request' && node.request.id === requestId) {
      return { request: node.request, container: nodes, index: i }
    }
    if (node.kind === 'folder') {
      const hit = findRequestInTree(node.children, requestId)
      if (hit) return hit
    }
  }
  return null
}

export function findFolderInTree(
  nodes: TreeNode[],
  folderId: string
): { folder: FolderNode; container: TreeNode[]; index: number } | null {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (node.kind === 'folder') {
      if (node.id === folderId) return { folder: node, container: nodes, index: i }
      const hit = findFolderInTree(node.children, folderId)
      if (hit) return hit
    }
  }
  return null
}

/**
 * The chain of folders from the collection root to a given request, in
 * top-down order. Used by the send-time inheritance merger to collect
 * default headers / auth profiles from every ancestor.
 */
export function findRequestAncestry(
  nodes: TreeNode[],
  requestId: string,
  trail: FolderNode[] = []
): { request: RequestItem; folders: FolderNode[] } | null {
  for (const node of nodes) {
    if (node.kind === 'request' && node.request.id === requestId) {
      return { request: node.request, folders: [...trail] }
    }
    if (node.kind === 'folder') {
      const hit = findRequestAncestry(node.children, requestId, [...trail, node])
      if (hit) return hit
    }
  }
  return null
}

export interface ConfigSlice {
  collections: Collection[]
  authProfiles: AuthProfile[]
}

// ---------- Context layer ----------

/**
 * A bag of variables keyed by name. Resolved in URLs, headers, and bodies
 * via `{{name}}` substitution at send time. One environment is "active" at
 * a time (e.g. dev / staging / prod).
 */
export interface Environment {
  id: string
  name: string
  /**
   * Variable values. For plain values this is a string. For sensitive
   * values, use the `SecretRef` string form (e.g. `"env:GITHUB_PAT"`) and
   * the secrets adapter will resolve it at send time.
   */
  variables: Record<string, string>
}

export interface ContextSlice {
  environments: Environment[]
  activeEnvironmentId?: string
}

// ---------- State layer ----------

/**
 * One entry per send, successful or failed. Part of `state` because it's
 * runtime telemetry — persisted for UX (you want your history back after
 * a restart) but never included in config exports unless the user opts in.
 */
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

export const HISTORY_MAX_ENTRIES = 200
export const HISTORY_BODY_MAX = 64 * 1024

export interface StateSlice {
  history: HistoryEntry[]
}

// ---------- Root ----------

export interface Store {
  config: ConfigSlice
  context: ContextSlice
  state: StateSlice
}

export const emptyStore = (): Store => ({
  config: { collections: [], authProfiles: [] },
  context: { environments: [], activeEnvironmentId: undefined },
  state: { history: [] }
})

export const newId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

// ---------- Migration ----------

/**
 * Legacy shape from pls <= 0.1.0: a flat `{ collections, history? }` object
 * at the root. We promote it into the new three-slice shape on first read
 * and persist the migrated form so subsequent reads are cheap. No data is
 * lost — fields we didn't track before (auth profiles, environments) are
 * initialised empty.
 */
interface LegacyStore {
  collections?: Collection[]
  history?: HistoryEntry[]
}

export function isLegacyStore(value: unknown): value is LegacyStore {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  // A legacy store has `collections` at the root and no `config` slice.
  if ('config' in obj) return false
  return 'collections' in obj
}

export function migrateLegacyStore(legacy: LegacyStore): Store {
  return {
    config: {
      collections: (Array.isArray(legacy.collections) ? legacy.collections : []).map(
        upgradeCollection
      ),
      authProfiles: []
    },
    context: {
      environments: [],
      activeEnvironmentId: undefined
    },
    state: {
      history: Array.isArray(legacy.history) ? legacy.history : []
    }
  }
}

/**
 * Upgrade a collection from the flat `requests` shape to the `children`
 * tree. Runs on every read so a file that only contains flat legacy
 * collections gets migrated transparently on first open. If the collection
 * already has `children`, it's left alone.
 */
function upgradeCollection(raw: unknown): Collection {
  if (!raw || typeof raw !== 'object') {
    return { id: newId(), name: 'New collection', children: [] }
  }
  const legacy = raw as Collection & { requests?: RequestItem[] }
  if (Array.isArray(legacy.children)) {
    // Already new shape.
    return { ...legacy, children: legacy.children }
  }
  const requests = Array.isArray(legacy.requests) ? legacy.requests : []
  return {
    ...legacy,
    children: requests.map((r) => ({ kind: 'request', request: r }) as RequestNode)
  }
}

/**
 * Accepts anything and returns a well-formed `Store`. Handles:
 *   - legacy `{ collections, history? }` shape → migrated
 *   - new `{ config, context, state }` shape → filled in if partial
 *   - garbage → `emptyStore()`
 */
export function normalizeStore(value: unknown): Store {
  if (isLegacyStore(value)) return migrateLegacyStore(value)
  if (!value || typeof value !== 'object') return emptyStore()
  const obj = value as Partial<Store>
  return {
    config: {
      // Run every collection through the upgrader so a mixed store (new
      // slices at the root, legacy flat collections underneath) still
      // gets its request arrays promoted into children trees.
      collections: (obj.config?.collections ?? []).map((c) => upgradeCollection(c)),
      authProfiles: obj.config?.authProfiles ?? []
    },
    context: {
      environments: obj.context?.environments ?? [],
      activeEnvironmentId: obj.context?.activeEnvironmentId
    },
    state: {
      history: obj.state?.history ?? []
    }
  }
}
