// The default HTTP adapter — uses the platform `fetch`. Identical behaviour
// to the original `sendHttp` helper; this is the reference implementation
// and the shape every other adapter mirrors.

import type { HttpAdapter } from '../adapter.js'
import type { SendRequestPayload, SendRequestResult } from '../types.js'

export function createFetchAdapter(): HttpAdapter {
  return {
    description: 'fetch',
    async send(payload: SendRequestPayload): Promise<SendRequestResult> {
      const start = Date.now()
      try {
        const headers = new Headers()
        for (const h of payload.headers) {
          if (h.enabled && h.key.trim()) headers.set(h.key, h.value)
        }
        const init: RequestInit = { method: payload.method, headers }
        if (payload.body && !['GET', 'HEAD'].includes(payload.method)) {
          init.body = payload.body
        }
        const res = await fetch(payload.url, init)
        const text = await res.text()
        const respHeaders: Record<string, string> = {}
        res.headers.forEach((v, k) => (respHeaders[k] = v))
        return {
          ok: res.ok,
          status: res.status,
          statusText: res.statusText,
          headers: respHeaders,
          body: text,
          durationMs: Date.now() - start,
          size: new TextEncoder().encode(text).length
        }
      } catch (err) {
        return {
          ok: false,
          status: 0,
          statusText: '',
          headers: {},
          body: '',
          durationMs: Date.now() - start,
          size: 0,
          error: err instanceof Error ? err.message : String(err)
        }
      }
    }
  }
}
