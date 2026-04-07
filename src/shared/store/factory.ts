// Turn a declarative "storage spec" into a StorageAdapter.
//
// The spec is the single extension point for plugging in alternate backends.
// Every entry point that needs a store (the Electron main process, the MCP
// stdio server, tests) builds an adapter by calling this factory — they
// never reach into a specific adapter module directly. Adding a new backend
// is a two-step change: drop a file in ./adapters, extend the discriminated
// union here.

import type { StorageAdapter } from './adapter.js'
import { createFileSystemAdapter } from './adapters/filesystem.js'
import { createMemoryAdapter } from './adapters/memory.js'
import type { Store } from './types.js'

export type StorageSpec =
  | { type: 'filesystem'; path: string }
  | { type: 'memory'; initial?: Store }
  /**
   * Pre-constructed adapter. Lets callers hand in something exotic
   * (SQLite, HTTP, a test double) without teaching the factory about it.
   */
  | { type: 'custom'; adapter: StorageAdapter }

export function createStorageAdapter(spec: StorageSpec): StorageAdapter {
  switch (spec.type) {
    case 'filesystem':
      return createFileSystemAdapter({ path: spec.path })
    case 'memory':
      return createMemoryAdapter(spec.initial)
    case 'custom':
      return spec.adapter
    default: {
      const _exhaustive: never = spec
      throw new Error(`unknown storage spec: ${JSON.stringify(_exhaustive)}`)
    }
  }
}

/**
 * Parse a spec from an environment variable (used by the MCP stdio entry
 * and any future CLI). Supports three shapes for convenience:
 *
 * - `PLS_STORAGE_SPEC={"type":"memory"}` — full JSON spec
 * - `PLS_STORAGE_SPEC=memory` — shorthand for `{type: "memory"}`
 * - `PLS_STORAGE_SPEC=file:/some/path.json` — shorthand for a filesystem spec
 *
 * Returns null when the env var is missing so the caller can fall back to
 * its own default (usually a filesystem path under the OS data dir).
 */
export function parseStorageSpecFromEnv(env: NodeJS.ProcessEnv): StorageSpec | null {
  const raw = env.PLS_STORAGE_SPEC
  if (!raw) return null
  const trimmed = raw.trim()
  if (trimmed === 'memory') return { type: 'memory' }
  if (trimmed.startsWith('file:')) {
    return { type: 'filesystem', path: trimmed.slice('file:'.length) }
  }
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as StorageSpec
      return parsed
    } catch (err) {
      throw new Error(
        `PLS_STORAGE_SPEC is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
  throw new Error(`PLS_STORAGE_SPEC has unrecognized shape: ${trimmed}`)
}
