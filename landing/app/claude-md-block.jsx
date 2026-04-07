'use client'

import { useState } from 'react'

export default function ClaudeMdBlock({ content }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  function download() {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'CLAUDE.md'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="cta claude-md">
      <div className="cta-head">
        <div className="dots">
          <span />
          <span />
          <span />
        </div>
        <span>~/ CLAUDE.md</span>
        <span>⌘</span>
      </div>
      <pre className="claude-md-body">{content}</pre>
      <div className="cta-actions">
        <button type="button" className="btn-primary" onClick={copy}>
          <span>{copied ? 'copied' : 'copy'}</span>
          <span className="kbd-group">
            <kbd>⌘</kbd>
            <kbd>C</kbd>
          </span>
        </button>
        <button type="button" className="btn-ghost" onClick={download}>
          download CLAUDE.md ↓
        </button>
      </div>
    </div>
  )
}
