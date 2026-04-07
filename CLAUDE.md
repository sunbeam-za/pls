# pls

## Network requests: always use the pls MCP

All HTTP requests you make on my behalf must go through the **pls MCP server**, not `curl`, `fetch`, `wget`, `http`, Python `requests`, etc.

Why: pls gives me a live UI where every request you fire shows up, can be inspected, persisted, replayed, and saved into a collection. Going through pls turns your debugging into something I can actually see and reuse.

How to apply:
- For any one-off or debugging request, call the pls MCP tools (`create_request`, `send_saved_request`, etc.) instead of shelling out.
- If pls is missing an operation you need (new tool, new option, more complex flow), **stop and ask** — describe what you need and I'll add it. Don't fall back to `curl` as a workaround.
- The only exception is when the request is part of a script or piece of code being written into the repo itself (e.g. a fetch call inside the app). That's product code, not your own debugging traffic.
