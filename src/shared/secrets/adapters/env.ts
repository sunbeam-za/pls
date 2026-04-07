// Environment-variable secrets adapter. The default everywhere — both
// the Electron main process and the standalone MCP server build one of
// these if nothing else is configured. It resolves refs of the form
// `env:VAR_NAME` to `process.env.VAR_NAME`. Unprefixed refs are also
// treated as env var names for convenience.
//
// The Electron main process inherits its env from the user's shell when
// launched from Terminal; launched from Finder it gets a minimal env, so
// users may need a keychain-backed adapter later. For now this is the
// shortest path to having auth work at all.

import type { SecretsAdapter } from '../adapter.js'

export function createEnvSecretsAdapter(): SecretsAdapter {
  return {
    description: 'env',
    async resolve(ref: string): Promise<string | null> {
      if (!ref) return null
      const name = ref.startsWith('env:') ? ref.slice('env:'.length) : ref
      const value = process.env[name]
      return value && value.length > 0 ? value : null
    }
  }
}
