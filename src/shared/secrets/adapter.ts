// Secrets adapter — the one place that turns a `SecretRef` string into an
// actual credential value. Every auth resolution at send time goes
// through this, so all the security-relevant knobs (where values live,
// how they're read, whether they're cached, what gets logged) are
// concentrated in one file per adapter.
//
// Contract:
// - `resolve(ref)` returns the plain value for a ref, or `null` if the
//   ref is unknown / unreachable / denied. Callers must treat `null` as
//   "skip this header entirely" rather than substituting an empty string.
// - A ref is either a prefixed string like `"env:GITHUB_PAT"` or a plain
//   string (backwards-compat: treated as an env var name). Adapters are
//   free to reject unprefixed refs and require the explicit form.
// - Adapters never throw on unknown refs — the caller can't recover
//   mid-send, so a missing secret should degrade gracefully to "no auth
//   applied" and the UI can surface the warning separately.

export interface SecretsAdapter {
  resolve(ref: string): Promise<string | null>
  /** Human-readable label for diagnostics, e.g. "env" or "keychain". */
  readonly description: string
}
