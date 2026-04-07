import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

export interface HeaderEntry {
  key: string
  value: string
  enabled: boolean
}

export interface RequestItem {
  id: string
  name: string
  method: HttpMethod
  url: string
  headers: HeaderEntry[]
  body: string
}

export interface Collection {
  id: string
  name: string
  requests: RequestItem[]
}

export interface Store {
  collections: Collection[]
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

const api = {
  readStore: (): Promise<Store> => ipcRenderer.invoke('store:read'),
  writeStore: (store: Store): Promise<boolean> => ipcRenderer.invoke('store:write', store),
  sendRequest: (payload: SendRequestPayload): Promise<SendRequestResult> =>
    ipcRenderer.invoke('http:send', payload)
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
