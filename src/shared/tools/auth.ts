// Resolve an auth profile into the headers and query parameters that
// should be applied to a request at send time. Pure async function over
// a SecretsAdapter — no I/O beyond what the adapter itself does.
//
// If any referenced secret fails to resolve we *skip* that part of the
// auth rather than applying an empty string, so the request still goes
// out, the receiving endpoint rejects it with a visible 401, and the
// user sees the problem without pls silently lying about what it sent.

import type { SecretsAdapter } from '../secrets/adapter.js'
import type { AuthProfile, HeaderEntry } from '../store/types.js'

export interface ResolvedAuth {
  headers: HeaderEntry[]
  queryParams: Record<string, string>
  /** Refs that couldn't be resolved — surfaced in the warning banner. */
  missingRefs: string[]
}

const EMPTY: ResolvedAuth = { headers: [], queryParams: {}, missingRefs: [] }

export async function resolveAuthProfile(
  profile: AuthProfile | undefined,
  secrets: SecretsAdapter
): Promise<ResolvedAuth> {
  if (!profile || profile.type === 'none') return EMPTY

  const missingRefs: string[] = []

  const lookup = async (ref: string): Promise<string | null> => {
    const value = await secrets.resolve(ref)
    if (value === null) missingRefs.push(ref)
    return value
  }

  switch (profile.config.type) {
    case 'none':
      return EMPTY

    case 'bearer': {
      const token = await lookup(profile.config.tokenRef)
      if (!token) return { ...EMPTY, missingRefs }
      return {
        headers: [{ key: 'Authorization', value: `Bearer ${token}`, enabled: true }],
        queryParams: {},
        missingRefs
      }
    }

    case 'basic': {
      const [user, pass] = await Promise.all([
        lookup(profile.config.usernameRef),
        lookup(profile.config.passwordRef)
      ])
      if (!user || !pass) return { ...EMPTY, missingRefs }
      // Electron's renderer and Node both expose btoa; we use the
      // portable Buffer path so this module stays environment-agnostic.
      const encoded =
        typeof Buffer !== 'undefined'
          ? Buffer.from(`${user}:${pass}`).toString('base64')
          : btoa(`${user}:${pass}`)
      return {
        headers: [{ key: 'Authorization', value: `Basic ${encoded}`, enabled: true }],
        queryParams: {},
        missingRefs
      }
    }

    case 'api-key': {
      const value = await lookup(profile.config.valueRef)
      if (!value) return { ...EMPTY, missingRefs }
      if (profile.config.in === 'header') {
        return {
          headers: [{ key: profile.config.name, value, enabled: true }],
          queryParams: {},
          missingRefs
        }
      }
      return {
        headers: [],
        queryParams: { [profile.config.name]: value },
        missingRefs
      }
    }

    default: {
      const _exhaustive: never = profile.config
      void _exhaustive
      return EMPTY
    }
  }
}

/**
 * Append resolved query parameters to a URL. Preserves existing query
 * params and avoids double-encoding by going through URL/URLSearchParams.
 */
export function applyQueryParams(url: string, params: Record<string, string>): string {
  if (Object.keys(params).length === 0) return url
  try {
    const parsed = new URL(url)
    for (const [k, v] of Object.entries(params)) {
      parsed.searchParams.append(k, v)
    }
    return parsed.toString()
  } catch {
    // Non-absolute URL — fall back to a manual join. Not perfect but
    // it's the 1% case where the user typed a relative path.
    const separator = url.includes('?') ? '&' : '?'
    const qs = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&')
    return `${url}${separator}${qs}`
  }
}
