import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  Store,
  Collection,
  AuthProfile,
  HistoryEntry,
  SendRequestPayload,
  SendRequestResult,
  LoadSpecResult,
  McpInfo,
  ExportCollectionResult,
  ImportCollectionResult
} from './index'

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
      exportCollection: (args: {
        collectionId: string
        defaultName: string
        collection: Collection
        authProfiles: AuthProfile[]
        history: HistoryEntry[]
      }) => Promise<ExportCollectionResult>
      importCollection: () => Promise<ImportCollectionResult>
    }
  }
}
