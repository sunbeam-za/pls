import type { HeaderEntry, HttpMethod } from '../store/types.js'

export interface SendRequestPayload {
  method: HttpMethod
  url: string
  headers: HeaderEntry[]
  body: string
}

export interface SendRequestResult {
  ok: boolean
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
  durationMs: number
  size: number
  error?: string
}
