// A mock HTTP adapter — deterministic, offline, handy for tests and for
// the handoff widget's "try without touching the network" mode.
//
// Pass a `handler` to return a custom result per request; otherwise every
// send resolves to a 200 OK with an echoed JSON body.

import type { HttpAdapter } from '../adapter.js'
import type { SendRequestPayload, SendRequestResult } from '../types.js'

export interface MockAdapterOptions {
  handler?: (payload: SendRequestPayload) => SendRequestResult | Promise<SendRequestResult>
}

export function createMockAdapter(options: MockAdapterOptions = {}): HttpAdapter {
  return {
    description: 'mock',
    async send(payload: SendRequestPayload): Promise<SendRequestResult> {
      if (options.handler) {
        return options.handler(payload)
      }
      const body = JSON.stringify({ mock: true, received: payload }, null, 2)
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body,
        durationMs: 0,
        size: new TextEncoder().encode(body).length
      }
    }
  }
}
