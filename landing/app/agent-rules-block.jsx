'use client'

import { useState } from 'react'

// Mirrors src/renderer/src/components/McpHandoff.tsx — same provider tabs,
// same favicon-driven brand tiles. We use DuckDuckGo's icon proxy here
// because the marketing site is static and can't run the main-process
// favicon fetcher the desktop app uses.
const PROVIDERS = [
  { id: 'claude-code', name: 'Claude Code', domain: 'claude.com', filename: 'CLAUDE.md' },
  { id: 'cursor', name: 'Cursor', domain: 'cursor.com', filename: '.cursorrules' },
  { id: 'windsurf', name: 'Windsurf', domain: 'windsurf.com', filename: '.windsurfrules' },
  { id: 'codex', name: 'Codex', domain: 'openai.com', filename: 'AGENTS.md' }
]

function faviconUrl(domain) {
  return `https://icons.duckduckgo.com/ip3/${domain}.ico`
}

export default function AgentRulesBlock({ content }) {
  const [activeId, setActiveId] = useState(PROVIDERS[0].id)
  const [copied, setCopied] = useState(false)
  const active = PROVIDERS.find((p) => p.id === activeId) ?? PROVIDERS[0]

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
    a.download = active.filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="agent-rules">
      <div className="agent-tabs" role="tablist" aria-label="agent provider">
        {PROVIDERS.map((p) => {
          const isActive = p.id === activeId
          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`agent-tab${isActive ? ' is-active' : ''}`}
              onClick={() => setActiveId(p.id)}
            >
              <span className="agent-tab-tile">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={faviconUrl(p.domain)} alt="" width={24} height={24} />
              </span>
              <span className="agent-tab-name">{p.name}</span>
            </button>
          )
        })}
      </div>

      <p className="prose agent-rules-hint">
        drop this into <code>{active.filename}</code> in your project root.
      </p>

      <div className="cta">
        <div className="cta-head">
          <div className="dots">
            <span />
            <span />
            <span />
          </div>
          <span>~/ {active.filename}</span>
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
            download {active.filename} ↓
          </button>
        </div>
      </div>
    </div>
  )
}
