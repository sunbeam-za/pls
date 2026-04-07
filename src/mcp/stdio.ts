// pls MCP server (stdio transport).
// Shebang is injected at build time by tsup's banner config.
//
// Exposes the user's saved collections + requests as MCP tools and resources
// so any MCP-capable AI client (Claude Desktop, Claude Code, Cursor, etc.)
// can drive pls's request library.
//
// The store path resolves to the same `pls-store.json` the Electron app uses,
// via env-paths. Concurrent writes are safe — all mutations go through the
// shared `mutateStore` file lock.

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import envPaths from 'env-paths'
import { join } from 'path'
import { z } from 'zod'
import { createHttpAdapter, parseHttpSpecFromEnv } from '../shared/http/index.js'
import { createStorageAdapter, parseStorageSpecFromEnv } from '../shared/store/index.js'
import { countRequests } from '../shared/store/types.js'
import { createOps, ToolError } from '../shared/tools/operations.js'

// Storage resolution order:
//   1. PLS_STORAGE_SPEC (memory, file:/path, or JSON) — the adapter pattern hook.
//   2. PLS_STORE_PATH — legacy shorthand for a filesystem path.
//   3. Default filesystem path under the OS data dir (same as the Electron app).
const paths = envPaths('pls', { suffix: '' })
const storageSpec =
  parseStorageSpecFromEnv(process.env) ??
  ({
    type: 'filesystem',
    path: process.env.PLS_STORE_PATH ?? join(paths.data, 'pls-store.json')
  } as const)
const storage = createStorageAdapter(storageSpec)
// Agents can pin the transport via PLS_HTTP_SPEC — useful for letting an
// MCP client drive a mock transport during CI or rehearsals.
const http = createHttpAdapter(parseHttpSpecFromEnv(process.env) ?? { type: 'fetch' })

const ops = createOps({ storage, http })

const server = new McpServer(
  { name: 'pls', version: '0.1.0' },
  {
    capabilities: { tools: {}, resources: {} },
    instructions:
      'pls is a local API client. Use list_collections / list_requests to discover what the user has saved, get_request to inspect one, and send_saved_request to execute it. Prefer running saved requests over ad-hoc ones — they reflect the user\'s intent.'
  }
)

// ---------- Helpers ----------

const HEADER_SHAPE = z.object({
  key: z.string(),
  value: z.string(),
  enabled: z.boolean().default(true)
})

const METHOD = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])

const textResult = (value: unknown): { content: { type: 'text'; text: string }[] } => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
})

// Every tool handler runs through this so a ToolError comes back to the
// model as a visible error instead of crashing the transport.
async function safe<T>(fn: () => Promise<T>): Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }> {
  try {
    return textResult(await fn())
  } catch (err) {
    const message = err instanceof ToolError || err instanceof Error ? err.message : String(err)
    return { content: [{ type: 'text', text: `error: ${message}` }], isError: true }
  }
}

// ---------- Tools ----------

server.registerTool(
  'list_collections',
  {
    title: 'List collections',
    description: 'List all request collections the user has saved in pls.',
    inputSchema: {}
  },
  async () => safe(() => ops.listCollections())
)

server.registerTool(
  'list_requests',
  {
    title: 'List requests in a collection',
    description: 'List all requests inside a given collection.',
    inputSchema: {
      collectionId: z.string().describe('Collection id from list_collections')
    }
  },
  async ({ collectionId }) => safe(() => ops.listRequests(collectionId))
)

server.registerTool(
  'get_request',
  {
    title: 'Get request',
    description: 'Fetch the full definition of a saved request: method, url, headers, body, and any linked OpenAPI operation.',
    inputSchema: {
      requestId: z.string().describe('Request id from list_requests')
    }
  },
  async ({ requestId }) => safe(() => ops.getRequest(requestId))
)

server.registerTool(
  'create_collection',
  {
    title: 'Create collection',
    description: 'Create a new empty collection.',
    inputSchema: {
      name: z.string().min(1)
    }
  },
  async ({ name }) => safe(() => ops.createCollection(name))
)

server.registerTool(
  'create_folder',
  {
    title: 'Create folder',
    description:
      'Create a folder inside a collection. Optionally nest it inside another folder by passing parentFolderId. Folders group requests and can carry default headers / auth that cascade to their descendants.',
    inputSchema: {
      collectionId: z.string(),
      name: z.string().optional(),
      parentFolderId: z.string().optional()
    }
  },
  async (input) => safe(() => ops.createFolder(input))
)

server.registerTool(
  'delete_folder',
  {
    title: 'Delete folder',
    description: 'Delete a folder and everything inside it. Destructive — the requests inside are gone.',
    inputSchema: {
      folderId: z.string()
    },
    annotations: { destructiveHint: true }
  },
  async ({ folderId }) => safe(() => ops.deleteFolder(folderId))
)

server.registerTool(
  'create_request',
  {
    title: 'Create request',
    description: 'Create a new saved request inside an existing collection.',
    inputSchema: {
      collectionId: z.string(),
      name: z.string().optional(),
      method: METHOD.optional(),
      url: z.string().optional(),
      headers: z.array(HEADER_SHAPE).optional(),
      body: z.string().optional()
    }
  },
  async (input) => safe(() => ops.createRequest(input))
)

server.registerTool(
  'update_request',
  {
    title: 'Update request',
    description: 'Patch fields on an existing saved request. Only supplied fields are changed.',
    inputSchema: {
      requestId: z.string(),
      name: z.string().optional(),
      method: METHOD.optional(),
      url: z.string().optional(),
      headers: z.array(HEADER_SHAPE).optional(),
      body: z.string().optional()
    }
  },
  async ({ requestId, ...patch }) => safe(() => ops.updateRequest(requestId, patch))
)

server.registerTool(
  'delete_request',
  {
    title: 'Delete request',
    description: 'Delete a saved request. Does not touch the rest of the collection.',
    inputSchema: {
      requestId: z.string()
    }
  },
  async ({ requestId }) => safe(() => ops.deleteRequest(requestId))
)

server.registerTool(
  'send_saved_request',
  {
    title: 'Send saved request',
    description:
      'Execute a saved request. Optional overrides let you tweak url/headers/body for this one call without editing the saved version.',
    inputSchema: {
      requestId: z.string(),
      url: z.string().optional(),
      headers: z.array(HEADER_SHAPE).optional(),
      body: z.string().optional()
    },
    annotations: { destructiveHint: true }
  },
  async ({ requestId, url, headers, body }) =>
    safe(() => ops.sendSavedRequest(requestId, { url, headers, body }))
)

server.registerTool(
  'send_ad_hoc_request',
  {
    title: 'Send ad-hoc request',
    description: 'Execute an HTTP request without saving it. Prefer send_saved_request when possible.',
    inputSchema: {
      method: METHOD,
      url: z.string(),
      headers: z.array(HEADER_SHAPE).optional(),
      body: z.string().optional()
    },
    annotations: { destructiveHint: true }
  },
  async (input) => safe(() => ops.sendAdHoc(input))
)

// ---------- Resources ----------
// Each collection is a browsable resource, as is its linked OpenAPI spec.
// Clients that support resource browsing (Claude Desktop) can surface these
// directly in the attach-context picker.

server.registerResource(
  'collection',
  new ResourceTemplate('pls://collections/{collectionId}', {
    list: async () => {
      const store = await storage.read()
      return {
        resources: store.config.collections.map((c) => {
          const n = countRequests(c.children)
          return {
            uri: `pls://collections/${c.id}`,
            name: c.name,
            description: `${n} request${n === 1 ? '' : 's'}${
              c.openapi ? ` · linked to ${c.openapi.specTitle ?? 'OpenAPI spec'}` : ''
            }`,
            mimeType: 'application/json'
          }
        })
      }
    }
  }),
  { description: 'A saved request collection' },
  async (uri, { collectionId }) => {
    const store = await storage.read()
    const id = Array.isArray(collectionId) ? collectionId[0] : collectionId
    const collection = store.config.collections.find((c) => c.id === id)
    if (!collection) throw new Error(`collection not found: ${id}`)
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(collection, null, 2)
        }
      ]
    }
  }
)

server.registerResource(
  'openapi-spec',
  new ResourceTemplate('pls://specs/{collectionId}', {
    list: async () => {
      const store = await storage.read()
      return {
        resources: store.config.collections
          .filter((c) => !!c.openapi)
          .map((c) => ({
            uri: `pls://specs/${c.id}`,
            name: `${c.openapi!.specTitle ?? c.name} (OpenAPI)`,
            description: `OpenAPI spec linked to the "${c.name}" collection`,
            mimeType: 'application/yaml'
          }))
      }
    }
  }),
  { description: 'The raw OpenAPI spec linked to a collection' },
  async (uri, { collectionId }) => {
    const store = await storage.read()
    const id = Array.isArray(collectionId) ? collectionId[0] : collectionId
    const collection = store.config.collections.find((c) => c.id === id)
    if (!collection?.openapi) throw new Error(`no spec linked to collection ${id}`)
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/yaml',
          text: collection.openapi.specText
        }
      ]
    }
  }
)

// ---------- Transport ----------

async function main(): Promise<void> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  // StdioServerTransport keeps stdin open; process lives until the client
  // closes the pipe. No explicit loop needed.
}

main().catch((err) => {
  // Never write to stdout — that's the JSON-RPC channel. Errors go to stderr.
  process.stderr.write(`pls-mcp: fatal ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`)
  process.exit(1)
})
