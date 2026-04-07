// The single contract any storage backend must satisfy.
//
// Everything downstream of the store — the in-app IPC handlers and the MCP
// server — consumes a `StorageAdapter`, not a file path. That means swapping
// in SQLite, a remote HTTP store, or an encrypted keychain store is a matter
// of adding one file; nothing else changes.
//
// Contract notes:
// - `read` must return a structurally valid Store; adapters that encounter a
//   missing or corrupt backing store should return `emptyStore()` rather than
//   throwing, so first-run experiences stay friction-free.
// - `mutate` MUST be atomic relative to any concurrent `read`/`write`/`mutate`
//   on the same backing data. This is the only place inter-process or
//   inter-tab coordination lives, so adapters take responsibility for it.
// - `close` is optional — adapters with network handles or locks can use it
//   to clean up; the filesystem adapter has nothing to do.

import type { Store } from './types.js'

export interface StorageAdapter {
  read(): Promise<Store>
  write(store: Store): Promise<void>
  mutate<T>(mutator: (store: Store) => T | Promise<T>): Promise<T>
  close?(): Promise<void>
  /** Human-readable label for diagnostics, e.g. "filesystem:/path/to/pls-store.json". */
  readonly description: string
}
