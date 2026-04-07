# pls-app

An Electron application with React and TypeScript

## MCP server

`pls` ships a Model Context Protocol server that exposes your saved
collections and requests as tools + resources to any MCP client
(Claude Desktop, Claude Code, Cursor, Windsurf, …). It reads and writes
the same `pls-store.json` the app uses; writes are serialized with a file
lock so the app and the server can run at the same time.

Build it (happens automatically as part of `npm run build`):

```bash
npm run build:mcp
```

Run it directly for testing:

```bash
npm run mcp
# or: node out/mcp/pls-mcp.mjs
```

### Claude Desktop

Add this to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "pls": {
      "command": "node",
      "args": ["/absolute/path/to/pls/out/mcp/pls-mcp.mjs"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add pls -- node /absolute/path/to/pls/out/mcp/pls-mcp.mjs
```

### Tools exposed

`list_collections`, `list_requests`, `get_request`, `create_collection`,
`create_request`, `update_request`, `delete_request`, `send_saved_request`,
`send_ad_hoc_request`. Each saved collection is also browsable as a
`pls://collections/{id}` resource; linked OpenAPI specs show up under
`pls://specs/{id}`.


## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```
