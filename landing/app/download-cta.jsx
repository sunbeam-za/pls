'use client'

import { useEffect } from 'react'

export default function DownloadCTA({ href, version, label = 'download for mac' }) {
  useEffect(() => {
    function onKey(e) {
      const mod = e.metaKey || e.ctrlKey
      if (mod && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault()
        window.location.href = href
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [href])

  return (
    <a className="btn-primary" href={href}>
      <span>
        {label}
        {version ? <span className="btn-version">{version}</span> : null}
      </span>
      <span className="kbd-group" aria-label="keyboard shortcut command D">
        <kbd>⌘</kbd>
        <kbd>D</kbd>
      </span>
    </a>
  )
}
