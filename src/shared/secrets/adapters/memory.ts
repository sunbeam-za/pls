// In-memory secrets adapter — useful for tests and for the handoff
// widget's "try without touching the keychain" demo mode. Pass a map
// of refs to values at construction time.

import type { SecretsAdapter } from '../adapter.js'

export function createMemorySecretsAdapter(values: Record<string, string>): SecretsAdapter {
  return {
    description: 'memory',
    async resolve(ref: string): Promise<string | null> {
      return values[ref] ?? null
    }
  }
}
