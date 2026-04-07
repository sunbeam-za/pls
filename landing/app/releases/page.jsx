import Image from 'next/image'
import Link from 'next/link'

export const metadata = {
  title: 'releases — pls',
  description: 'release history for pls.'
}

// revalidate hourly — github api is rate-limited for unauthenticated requests.
export const revalidate = 3600

async function getReleases() {
  const res = await fetch('https://api.github.com/repos/sunbeam-za/pls/releases', {
    headers: { Accept: 'application/vnd.github+json' },
    next: { revalidate: 3600 }
  })
  if (!res.ok) return []
  return res.json()
}

function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

function pickAssetUrl(assets, match) {
  return assets?.find((a) => match.test(a.name))?.browser_download_url
}

export default async function ReleasesPage() {
  const releases = await getReleases()

  return (
    <main className="page">
      <header className="topbar">
        <span className="brand">
          <Image
            src="/sunbeam-logo.png"
            alt="sunbeam"
            width={22}
            height={22}
            className="brand-mark"
            priority
          />
          “pls” / releases
        </span>
        <span className="meta">
          <Link href="/">← home</Link>
        </span>
      </header>

      <h1 className="tagline">— releases</h1>

      {releases.length === 0 ? (
        <p className="lede">
          no releases yet. grab the source from{' '}
          <a href="https://github.com/sunbeam-za/pls">github</a>.
        </p>
      ) : (
        <ul className="bullets">
          {releases.map((r) => {
            const mac = pickAssetUrl(r.assets, /\.dmg$/i)
            const win = pickAssetUrl(r.assets, /setup\.exe$/i)
            const linux = pickAssetUrl(r.assets, /\.AppImage$/i)
            return (
              <li key={r.id}>
                <b>
                  {r.name || r.tag_name}
                  {r.prerelease ? ' (pre-release)' : ''}
                </b>
                <span>
                  {fmtDate(r.published_at)}
                  {' — '}
                  {mac && <a href={mac}>mac</a>}
                  {mac && (win || linux) && ' · '}
                  {win && <a href={win}>windows</a>}
                  {win && linux && ' · '}
                  {linux && <a href={linux}>linux</a>}
                  {(mac || win || linux) && ' · '}
                  <a href={r.html_url}>notes</a>
                </span>
              </li>
            )
          })}
        </ul>
      )}

      <footer className="foot">
        <span className="brand">
          © 2026 —{' '}
          <Image
            src="/sunbeam-logo.png"
            alt="sunbeam"
            width={16}
            height={16}
            className="brand-mark sm"
          />
          sunbeam
        </span>
      </footer>
    </main>
  )
}
