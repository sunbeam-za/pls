import { app, shell, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

// Set the app name as early as possible so the macOS menu and dock show "pls"
// (in dev, electron defaults this to "Electron").
app.setName('pls')

// ---------- Storage ----------
// Single JSON file in userData with all collections + requests.
// Simple, atomic, no migrations needed for v0.

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

interface RequestItem {
  id: string
  name: string
  method: HttpMethod
  url: string
  headers: { key: string; value: string; enabled: boolean }[]
  body: string
}

// Collection shape is structurally compatible with the renderer's richer type
// (`openapi` + `spec` fields). The main process never needs to inspect those,
// so we keep it loose here and let renderer own the full types.
interface Collection {
  id: string
  name: string
  requests: RequestItem[]
  [key: string]: unknown
}

interface Store {
  collections: Collection[]
}

const storePath = (): string => join(app.getPath('userData'), 'pls-store.json')

async function readStore(): Promise<Store> {
  try {
    const raw = await fs.readFile(storePath(), 'utf-8')
    return JSON.parse(raw) as Store
  } catch {
    return { collections: [] }
  }
}

async function writeStore(store: Store): Promise<void> {
  const path = storePath()
  const tmp = path + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), 'utf-8')
  await fs.rename(tmp, path)
}

// ---------- HTTP ----------

interface SendRequestPayload {
  method: HttpMethod
  url: string
  headers: { key: string; value: string; enabled: boolean }[]
  body: string
}

interface SendRequestResult {
  ok: boolean
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
  durationMs: number
  size: number
  error?: string
}

async function sendRequest(payload: SendRequestPayload): Promise<SendRequestResult> {
  const start = Date.now()
  try {
    const headers = new Headers()
    for (const h of payload.headers) {
      if (h.enabled && h.key.trim()) headers.set(h.key, h.value)
    }
    const init: RequestInit = { method: payload.method, headers }
    if (payload.body && !['GET', 'HEAD'].includes(payload.method)) {
      init.body = payload.body
    }
    const res = await fetch(payload.url, init)
    const text = await res.text()
    const respHeaders: Record<string, string> = {}
    res.headers.forEach((v, k) => (respHeaders[k] = v))
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      headers: respHeaders,
      body: text,
      durationMs: Date.now() - start,
      size: new TextEncoder().encode(text).length
    }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      statusText: '',
      headers: {},
      body: '',
      durationMs: Date.now() - start,
      size: 0,
      error: err instanceof Error ? err.message : String(err)
    }
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
  ipcMain.handle('http:send', async (_e, payload: SendRequestPayload) => sendRequest(payload))
  ipcMain.handle('openapi:loadFromUrl', async (_e, url: string) => loadSpecFromUrl(url))
  ipcMain.handle('openapi:loadFromFile', async () => loadSpecFromFile())

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
