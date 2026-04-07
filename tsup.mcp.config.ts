import { defineConfig } from 'tsup'

// Standalone build for the MCP stdio server. Runs under plain Node, not
// Electron — so we bundle everything except node built-ins and the two
// native-ish deps that should resolve from node_modules at runtime.
export default defineConfig({
  entry: { 'pls-mcp': 'src/mcp/stdio.ts' },
  outDir: 'out/mcp',
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  sourcemap: true,
  splitting: false,
  shims: false,
  banner: { js: '#!/usr/bin/env node' },
  // proper-lockfile pulls in native-ish helpers; keep it external so Node
  // resolves it from node_modules at runtime.
  external: ['proper-lockfile']
})
