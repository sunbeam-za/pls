/* eslint-disable @typescript-eslint/explicit-function-return-type */
// Shared fetcher for the "latest release" data used by the home CTA.
// Revalidates hourly so an unauthenticated GitHub API call per hour is enough.

export async function getLatestRelease() {
  try {
    const res = await fetch('https://api.github.com/repos/sunbeam-za/pls/releases/latest', {
      headers: { Accept: 'application/vnd.github+json' },
      next: { revalidate: 3600 }
    })
    if (!res.ok) return null
    const data = await res.json()
    const dmg = data.assets?.find((a) => /\.dmg$/i.test(a.name))
    return {
      version: data.tag_name || data.name || null,
      downloadUrl: dmg?.browser_download_url || data.html_url || '/releases'
    }
  } catch {
    return null
  }
}
