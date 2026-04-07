// The single contract any HTTP transport must satisfy.
//
// Every request pls sends — from the in-app editor, from the MCP server,
// from a future AI tool call — goes through an HttpAdapter. Swapping in a
// proxied transport, an `undici` one with tuned keep-alive, a curl shim
// for mTLS/NTLM, or a mock for offline demos is a one-file change.
//
// Contract notes:
// - `send` must resolve (never reject) on network failures: populate
//   `error` on the result instead. This matches what the UI already
//   expects and keeps the MCP tool surface stable — agents shouldn't
//   have to distinguish between HTTP 500 and DNS failure at the transport
//   layer to decide whether to retry.
// - Adapters own their own timeouts and cancellation. Future adapters can
//   honour an AbortSignal by extending this interface.

import type { SendRequestPayload, SendRequestResult } from './types.js'

export interface HttpAdapter {
  send(payload: SendRequestPayload): Promise<SendRequestResult>
  /** Human-readable label for diagnostics, e.g. "fetch" or "proxy:http://...". */
  readonly description: string
}
