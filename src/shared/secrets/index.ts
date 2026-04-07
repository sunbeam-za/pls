export type { SecretsAdapter } from './adapter.js'
export { createEnvSecretsAdapter } from './adapters/env.js'
export { createMemorySecretsAdapter } from './adapters/memory.js'
export { createSecretsAdapter, parseSecretsSpecFromEnv, type SecretsSpec } from './factory.js'
