// Filesystem-backed storage adapter. This is what `pls` ships with out of
// the box — a single JSON file at a configurable path, protected by an
// advisory file lock so multiple processes (the app + the MCP server + any
// future sidecar) can safely share it.

import { promises as fs } from 'fs'
import { dirname } from 'path'
import lockfile from 'proper-lockfile'
import type { StorageAdapter } from '../adapter.js'
import { emptyStore, normalizeStore, type Store } from '../types.js'

export interface FileSystemAdapterOptions {
  path: string
}

async function ensureFile(path: string): Promise<void> {
  try {
    await fs.access(path)
  } catch {
    await fs.mkdir(dirname(path), { recursive: true })
    await fs.writeFile(path, JSON.stringify(emptyStore(), null, 2), 'utf-8')
  }
}

function parseOrEmpty(raw: string): Store {
  try {
    // normalizeStore handles both the new three-slice shape and the legacy
    // flat `{collections, history}` shape. It also fills in any missing
    // slices, so partial files (e.g. hand-edited) never crash the app.
    return normalizeStore(JSON.parse(raw))
  } catch {
    // Corrupt file — don't crash, let the next write heal it.
    return emptyStore()
  }
}

export function createFileSystemAdapter(options: FileSystemAdapterOptions): StorageAdapter {
  const { path } = options
  const lockOptions = {
    retries: { retries: 10, minTimeout: 20, maxTimeout: 200 },
    stale: 5000
  }

  async function atomicWrite(store: Store): Promise<void> {
    const tmp = path + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(store, null, 2), 'utf-8')
    await fs.rename(tmp, path)
  }

  return {
    description: `filesystem:${path}`,

    async read(): Promise<Store> {
      await ensureFile(path)
      const raw = await fs.readFile(path, 'utf-8')
      return parseOrEmpty(raw)
    },

    async write(store: Store): Promise<void> {
      await ensureFile(path)
      const release = await lockfile.lock(path, lockOptions)
      try {
        await atomicWrite(store)
      } finally {
        await release()
      }
    },

    async mutate<T>(mutator: (store: Store) => T | Promise<T>): Promise<T> {
      await ensureFile(path)
      const release = await lockfile.lock(path, lockOptions)
      try {
        const raw = await fs.readFile(path, 'utf-8')
        const store = parseOrEmpty(raw)
        const result = await mutator(store)
        await atomicWrite(store)
        return result
      } finally {
        await release()
      }
    }
  }
}
