import { ElectronAPI } from '@electron-toolkit/preload'
import type { Store, SendRequestPayload, SendRequestResult, LoadSpecResult, McpInfo } from './index'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      readStore: () => Promise<Store>
      writeStore: (store: Store) => Promise<boolean>
      sendRequest: (payload: SendRequestPayload) => Promise<SendRequestResult>
      loadSpecFromUrl: (url: string) => Promise<LoadSpecResult>
      loadSpecFromFile: () => Promise<LoadSpecResult>
      mcpInfo: () => Promise<McpInfo>
      getFavicon: (domain: string) => Promise<string | null>
    }
  }
}
