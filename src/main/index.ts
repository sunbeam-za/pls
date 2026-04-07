import { app, shell, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import {
  createStorageAdapter,
  parseStorageSpecFromEnv,
  type HistoryEntry,
  type StorageAdapter,
  type Store
} from '../shared/store'
import {
  createHttpAdapter,
  parseHttpSpecFromEnv,
  type HttpAdapter,
  type SendRequestPayload,
  type SendRequestResult
} from '../shared/http'

// Set the app name as early as possible so the macOS menu and dock show "pls"
// (in dev, electron defaults this to "Electron").
app.setName('pls')

// ---------- Storage ----------
// Storage is pluggable. By default the app uses a filesystem adapter at
// userData/pls-store.json — the same file the standalone MCP server reads.
// Setting PLS_STORAGE_SPEC at launch swaps in any other adapter the factory
// knows about (memory, a custom one, etc.), which is handy for tests and
// ephemeral demo sessions.

const defaultStorePath = (): string => join(app.getPath('userData'), 'pls-store.json')

let _storage: StorageAdapter | null = null
const storage = (): StorageAdapter => {
  if (_storage) return _storage
  const fromEnv = parseStorageSpecFromEnv(process.env)
  _storage = createStorageAdapter(fromEnv ?? { type: 'filesystem', path: defaultStorePath() })
  return _storage
}

let _http: HttpAdapter | null = null
const http = (): HttpAdapter => {
  if (_http) return _http
  _http = createHttpAdapter(parseHttpSpecFromEnv(process.env) ?? { type: 'fetch' })
  return _http
}

const readStore = (): Promise<Store> => storage().read()
const writeStore = (store: Store): Promise<void> => storage().write(store)

// ---------- History live feed ----------
// The renderer and the MCP server both append to state.history, but only
// the renderer has UI. When MCP writes land on disk, the main process
// spots them via fs.watch and broadcasts the new entries to every open
// window so the live feed can render them in real time.
//
// We broadcast *only new entries* rather than the whole store to keep the
// IPC payload small and to avoid clobbering any in-flight renderer edits
// to config/context slices.

let _lastHistoryIds = new Set<string>()

function broadcastHistoryAppended(entries: HistoryEntry[]): void {
  if (entries.length === 0) return
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('history:appended', entries)
  }
}

async function appendHistoryEntry(entry: HistoryEntry): Promise<HistoryEntry[]> {
  const fresh = await storage().mutate((store) => {
    store.state.history = [entry, ...store.state.history].slice(0, 200)
    _lastHistoryIds = new Set(store.state.history.map((h) => h.id))
    return [entry]
  })
  broadcastHistoryAppended(fresh)
  return fresh
}

/**
 * Diff the current on-disk history against the last snapshot we saw and
 * return any entries that weren't there before. Called after fs.watch
 * fires — if something external (MCP server in another process) appended,
 * we pick it up here and forward to the renderer.
 */
async function detectNewHistoryEntries(): Promise<HistoryEntry[]> {
  const store = await readStore()
  const fresh: HistoryEntry[] = []
  for (const entry of store.state.history) {
    if (!_lastHistoryIds.has(entry.id)) fresh.push(entry)
  }
  _lastHistoryIds = new Set(store.state.history.map((h) => h.id))
  return fresh
}

let _watchDebounce: NodeJS.Timeout | null = null
let _watcher: import('fs').FSWatcher | null = null

function startStoreWatcher(): void {
  const path = defaultStorePath()
  // fs.watch on a file on macOS uses kqueue which breaks when we rename
  // the tmp file over the original (that's how we write atomically). So
  // we watch the containing directory and filter by basename instead.
  const dir = require('path').dirname(path)
  const basename = require('path').basename(path)
  try {
    _watcher = require('fs').watch(dir, { persistent: false }, (_event: string, filename: string | null) => {
      if (filename !== basename) return
      // Debounce: a single atomic write can fire multiple events because
      // we use tmp → rename. Collapse them before re-reading.
      if (_watchDebounce) clearTimeout(_watchDebounce)
      _watchDebounce = setTimeout(() => {
        detectNewHistoryEntries()
          .then((newEntries) => {
            if (newEntries.length > 0) broadcastHistoryAppended(newEntries)
          })
          .catch((err) => console.error('store watcher diff failed', err))
      }, 100)
    })
  } catch (err) {
    console.error('failed to start store watcher', err)
  }
}

// Prime the last-seen id set so the first fs.watch event after launch
// doesn't broadcast everything already in the file as "new".
async function primeHistorySnapshot(): Promise<void> {
  try {
    const store = await readStore()
    _lastHistoryIds = new Set(store.state.history.map((h) => h.id))
  } catch {
    // Ignore — next mutate will recover.
  }
}

// ---------- MCP handoff ----------
// The handoff widget in the renderer needs to tell the user how to wire
// pls into their AI client. That snippet requires an absolute path to the
// bundled MCP server binary. Resolving it lives here because only the main
// process has a reliable view of `app.getAppPath()` / `process.resourcesPath`.

interface McpInfo {
  command: string
  args: string[]
  /** True if the bundled MCP server file actually exists on disk right now. */
  ready: boolean
  /** Which well-known AI clients seem to be installed. */
  installed: { claudeDesktop: boolean; cursor: boolean; claudeCode: boolean }
}

function resolveMcpEntry(): string {
  // In dev, `npm run dev` doesn't rebuild the MCP server; users run
  // `npm run build:mcp` once. Point at the repo's `out/mcp/pls-mcp.mjs`.
  if (is.dev) {
    return join(app.getAppPath(), 'out', 'mcp', 'pls-mcp.mjs')
  }
  // Packaged: the MCP build lives inside the asar alongside the main bundle,
  // but Node can't execute from inside asar, so electron-builder must unpack
  // it. We point at resourcesPath/app.asar.unpacked/out/mcp/pls-mcp.mjs as
  // the eventual target — see electron-builder `asarUnpack` config.
  return join(process.resourcesPath, 'app.asar.unpacked', 'out', 'mcp', 'pls-mcp.mjs')
}

// ---------- Favicon fetcher ----------
// The renderer's CSP blocks remote images (img-src 'self' data:), and
// relaxing it feels worse than just proxying through main. We fetch each
// vendor's own favicon directly, cache per session, and ship back a data
// URL — which does pass the CSP. One-off per domain; no network calls
// after the first successful fetch.

const faviconCache = new Map<string, string>()

async function fetchFavicon(domain: string): Promise<string | null> {
  const cached = faviconCache.get(domain)
  if (cached !== undefined) return cached
  // Try a few common paths before giving up — some sites don't serve
  // /favicon.ico but do have the high-res Apple touch icon or a /favicon.png.
  const candidates = [
    `https://${domain}/favicon.ico`,
    `https://${domain}/favicon.png`,
    `https://${domain}/apple-touch-icon.png`
  ]
  for (const url of candidates) {
    try {
      const res = await fetch(url, { redirect: 'follow' })
      if (!res.ok) continue
      const contentType = res.headers.get('content-type') ?? 'image/x-icon'
      // Reject HTML error pages masquerading as 200s.
      if (contentType.includes('text/html')) continue
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length === 0) continue
      const dataUrl = `data:${contentType};base64,${buf.toString('base64')}`
      faviconCache.set(domain, dataUrl)
      return dataUrl
    } catch {
      // Try the next candidate.
    }
  }
  faviconCache.set(domain, '') // negative cache to avoid retries this session
  return null
}

async function getMcpInfo(): Promise<McpInfo> {
  const entry = resolveMcpEntry()
  let ready = false
  try {
    await fs.access(entry)
    ready = true
  } catch {
    ready = false
  }
  const home = app.getPath('home')
  const exists = async (p: string): Promise<boolean> => {
    try {
      await fs.access(p)
      return true
    } catch {
      return false
    }
  }
  // Best-effort detection. False negatives are fine — we always show the
  // manual instructions too.
  const [claudeDesktop, cursor, claudeCode] = await Promise.all([
    exists(join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')),
    exists('/Applications/Cursor.app'),
    // Claude Code CLI — presence of the user config dir is a decent signal.
    exists(join(home, '.claude'))
  ])
  // Always report plain `node` as the command: the external AI client runs
  // the server in its own process, and Electron's embedded Node isn't on
  // PATH as `node`. Users need a system Node install.
  return {
    command: 'node',
    args: [entry],
    ready,
    installed: { claudeDesktop, cursor, claudeCode }
  }
}

// ---------- OpenAPI spec loading ----------
// Parsing + diffing lives in the renderer (`src/renderer/src/lib/openapi.ts`).
// The main process only handles I/O the renderer can't do itself: fetching
// from arbitrary URLs (bypassing CORS) and reading local files via a dialog.

interface LoadSpecResult {
  ok: boolean
  text?: string
  sourceType?: 'url' | 'file'
  sourceLocation?: string
  error?: string
}

async function loadSpecFromUrl(url: string): Promise<LoadSpecResult> {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json, application/yaml, */*' } })
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status} ${res.statusText}` }
    }
    const text = await res.text()
    return { ok: true, text, sourceType: 'url', sourceLocation: url }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function loadSpecFromFile(): Promise<LoadSpecResult> {
  const result = await dialog.showOpenDialog({
    title: 'Import OpenAPI spec',
    properties: ['openFile'],
    filters: [
      { name: 'OpenAPI', extensions: ['json', 'yaml', 'yml'] },
      { name: 'All files', extensions: ['*'] }
    ]
  })
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, error: 'cancelled' }
  }
  const path = result.filePaths[0]
  try {
    const text = await fs.readFile(path, 'utf-8')
    return { ok: true, text, sourceType: 'file', sourceLocation: path }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ---------- Collection share/export ----------
// A "collection export" is a self-contained JSON bundle: the collection
// itself + any history entries that reference requests inside it. Another
// dev can drop this file into pls and get the same saved requests plus
// the sender's run history, all in one go. Keep the format flat and boring
// so it's easy to hand-edit or diff in git.

const EXPORT_FORMAT_VERSION = 1 as const

interface CollectionExport {
  pls: typeof EXPORT_FORMAT_VERSION
  kind: 'collection-export'
  exportedAt: number
  /** The config slice relevant to the collection. */
  collection: unknown
  /** Any auth profiles the collection references. Definitions only — no secrets. */
  authProfiles: unknown[]
  /** Optional history scoped to this collection's requests. */
  history: unknown[]
}

interface ExportResult {
  ok: boolean
  path?: string
  error?: string
}

async function exportCollection(
  collectionId: string,
  defaultName: string,
  payload: { collection: unknown; authProfiles: unknown[]; history: unknown[] }
): Promise<ExportResult> {
  const result = await dialog.showSaveDialog({
    title: 'Export collection',
    defaultPath: `${defaultName || 'collection'}.pls.json`,
    filters: [{ name: 'pls export', extensions: ['json'] }]
  })
  if (result.canceled || !result.filePath) {
    return { ok: false, error: 'cancelled' }
  }
  const bundle: CollectionExport = {
    pls: EXPORT_FORMAT_VERSION,
    kind: 'collection-export',
    exportedAt: Date.now(),
    collection: payload.collection,
    authProfiles: payload.authProfiles,
    history: payload.history
  }
  try {
    await fs.writeFile(result.filePath, JSON.stringify(bundle, null, 2), 'utf-8')
    return { ok: true, path: result.filePath }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  // collectionId is passed through for future telemetry — unused today.
  void collectionId
}

interface ImportResult {
  ok: boolean
  bundle?: CollectionExport
  error?: string
}

async function importCollection(): Promise<ImportResult> {
  const result = await dialog.showOpenDialog({
    title: 'Import collection',
    properties: ['openFile'],
    filters: [
      { name: 'pls export', extensions: ['json'] },
      { name: 'All files', extensions: ['*'] }
    ]
  })
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, error: 'cancelled' }
  }
  try {
    const text = await fs.readFile(result.filePaths[0], 'utf-8')
    const parsed = JSON.parse(text) as CollectionExport
    if (parsed.kind !== 'collection-export' || typeof parsed.pls !== 'number') {
      return { ok: false, error: 'Not a pls collection export' }
    }
    return { ok: true, bundle: parsed }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ---------- Window ----------

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0b0b0e',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.pls.app')

  // In dev, the dock icon is Electron's default. Override it on macOS.
  if (process.platform === 'darwin' && app.dock) {
    try {
      app.dock.setIcon(icon)
    } catch (err) {
      console.error('Failed to set dock icon', err)
    }
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle('store:read', async () => readStore())
  ipcMain.handle('store:write', async (_e, store: Store) => {
    await writeStore(store)
    return true
  })
  ipcMain.handle('http:send', async (_e, payload: SendRequestPayload): Promise<SendRequestResult> =>
    http().send(payload)
  )
  ipcMain.handle('openapi:loadFromUrl', async (_e, url: string) => loadSpecFromUrl(url))
  ipcMain.handle('openapi:loadFromFile', async () => loadSpecFromFile())
  ipcMain.handle(
    'collection:export',
    async (
      _e,
      args: {
        collectionId: string
        defaultName: string
        collection: unknown
        authProfiles: unknown[]
        history: unknown[]
      }
    ) =>
      exportCollection(args.collectionId, args.defaultName, {
        collection: args.collection,
        authProfiles: args.authProfiles,
        history: args.history
      })
  )
  ipcMain.handle('collection:import', async () => importCollection())
  ipcMain.handle('mcp:info', async (): Promise<McpInfo> => getMcpInfo())
  ipcMain.handle('favicon:get', async (_e, domain: string): Promise<string | null> =>
    fetchFavicon(domain)
  )
  // Live feed plumbing. The renderer appends through this IPC instead of
  // persisting history via writeStore, so MCP writes (arriving via
  // fs.watch) and renderer writes never race on the same slice.
  ipcMain.handle('history:append', async (_e, entry: HistoryEntry): Promise<HistoryEntry[]> =>
    appendHistoryEntry(entry)
  )
  ipcMain.handle('history:read', async (): Promise<HistoryEntry[]> => {
    const store = await readStore()
    return store.state.history
  })

  // Start watching the store file for external appends (MCP server).
  primeHistorySnapshot().then(startStoreWatcher)

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  if (_watcher) {
    try {
      _watcher.close()
    } catch {
      // Watcher close errors are fatal for nobody — swallow.
    }
    _watcher = null
  }
})
