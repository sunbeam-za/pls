// In-memory storage adapter. Primarily useful for tests and for the
// handoff widget's "try without persisting" mode, but also a reference
// implementation that shows how little ceremony a new adapter needs.

import type { StorageAdapter } from '../adapter.js'
import { emptyStore, type Store } from '../types.js'

export function createMemoryAdapter(initial?: Store): StorageAdapter {
  let store: Store = initial ? structuredClone(initial) : emptyStore()
  // A single-slot promise chain serializes mutations without any external
  // locking. Reads don't join the chain — they snapshot whatever the latest
  // settled state is.
  let chain: Promise<unknown> = Promise.resolve()

  const withLock = <T>(fn: () => Promise<T> | T): Promise<T> => {
    const next = chain.then(() => fn())
    // Swallow errors on the chain so one failed mutation doesn't poison
    // later writes — callers still see the rejection on the returned promise.
    chain = next.catch(() => undefined)
    return next
  }

  return {
    description: 'memory',

    async read(): Promise<Store> {
      return structuredClone(store)
    },

    async write(next: Store): Promise<void> {
      await withLock(() => {
        store = structuredClone(next)
      })
    },

    async mutate<T>(mutator: (store: Store) => T | Promise<T>): Promise<T> {
      return withLock(async () => {
        const draft = structuredClone(store)
        const result = await mutator(draft)
        store = draft
        return result
      })
    }
  }
}
