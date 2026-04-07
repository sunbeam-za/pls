// Declarative secrets spec → SecretsAdapter factory. Same shape as the
// storage and http factories.

import type { SecretsAdapter } from './adapter.js'
import { createEnvSecretsAdapter } from './adapters/env.js'
import { createMemorySecretsAdapter } from './adapters/memory.js'

export type SecretsSpec =
  | { type: 'env' }
  | { type: 'memory'; values: Record<string, string> }
  | { type: 'custom'; adapter: SecretsAdapter }

export function createSecretsAdapter(spec: SecretsSpec): SecretsAdapter {
  switch (spec.type) {
    case 'env':
      return createEnvSecretsAdapter()
    case 'memory':
      return createMemorySecretsAdapter(spec.values)
    case 'custom':
      return spec.adapter
    default: {
      const _exhaustive: never = spec
      throw new Error(`unknown secrets spec: ${JSON.stringify(_exhaustive)}`)
    }
  }
}

/**
 * Parse a spec from `PLS_SECRETS_SPEC`. Accepts:
 *   - `env`            — the default, just forwards env vars
 *   - `{"type":"..."}` — full JSON spec for anything else
 */
export function parseSecretsSpecFromEnv(env: NodeJS.ProcessEnv): SecretsSpec | null {
  const raw = env.PLS_SECRETS_SPEC
  if (!raw) return null
  const trimmed = raw.trim()
  if (trimmed === 'env') return { type: 'env' }
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed) as SecretsSpec
    } catch (err) {
      throw new Error(
        `PLS_SECRETS_SPEC is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
  throw new Error(`PLS_SECRETS_SPEC has unrecognized shape: ${trimmed}`)
}
