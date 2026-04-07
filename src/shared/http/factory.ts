// Declarative HTTP spec → HttpAdapter factory. Same pattern as the storage
// factory: entry points build an adapter from a spec, they never reach into
// a specific adapter module. Adding a new transport is two lines here plus
// one file under ./adapters.

import type { HttpAdapter } from './adapter.js'
import { createFetchAdapter } from './adapters/fetch.js'
import { createMockAdapter } from './adapters/mock.js'

export type HttpSpec =
  | { type: 'fetch' }
  | { type: 'mock' }
  | { type: 'custom'; adapter: HttpAdapter }

export function createHttpAdapter(spec: HttpSpec): HttpAdapter {
  switch (spec.type) {
    case 'fetch':
      return createFetchAdapter()
    case 'mock':
      return createMockAdapter()
    case 'custom':
      return spec.adapter
    default: {
      const _exhaustive: never = spec
      throw new Error(`unknown http spec: ${JSON.stringify(_exhaustive)}`)
    }
  }
}

/**
 * Parse a spec from `PLS_HTTP_SPEC`. Accepts:
 *
 * - `PLS_HTTP_SPEC=fetch` — default
 * - `PLS_HTTP_SPEC=mock` — deterministic offline mode
 * - `PLS_HTTP_SPEC={"type":"..."}` — full JSON spec for anything exotic
 */
export function parseHttpSpecFromEnv(env: NodeJS.ProcessEnv): HttpSpec | null {
  const raw = env.PLS_HTTP_SPEC
  if (!raw) return null
  const trimmed = raw.trim()
  if (trimmed === 'fetch') return { type: 'fetch' }
  if (trimmed === 'mock') return { type: 'mock' }
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed) as HttpSpec
    } catch (err) {
      throw new Error(
        `PLS_HTTP_SPEC is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
  throw new Error(`PLS_HTTP_SPEC has unrecognized shape: ${trimmed}`)
}
