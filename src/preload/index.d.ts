import { ElectronAPI } from '@electron-toolkit/preload'
import type { Store, SendRequestPayload, SendRequestResult } from './index'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      readStore: () => Promise<Store>
      writeStore: (store: Store) => Promise<boolean>
      sendRequest: (payload: SendRequestPayload) => Promise<SendRequestResult>
    }
  }
}
