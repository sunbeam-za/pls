// Real-time request feed. Mounts in the main area when the user toggles
// Live mode. Every entry the main process broadcasts lands here as it
// happens — renderer sends, MCP sends, anything written to state.history
// by any process.
//
// Style: Stripe Workbench-ish. Dense monospace, thin borders, status
// coloured via a left accent, new entries fade in from the top.

import { useEffect, useMemo, useState } from 'react'
import { Radio, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { HistoryEntry } from '../../../preload/index'

interface LiveFeedProps {
  entries: HistoryEntry[]
  onSelect: (entry: HistoryEntry) => void
  /**
   * Most recently appended entry id — used to drive the enter animation
   * for brand-new rows. The feed never animates rows that were already
   * present when the user opened the panel.
   */
  newestId: string | null
}

const METHOD_COLOR: Record<string, string> = {
  GET: 'text-emerald-400',
  POST: 'text-sky-400',
  PUT: 'text-amber-400',
  PATCH: 'text-violet-400',
  DELETE: 'text-rose-400',
  HEAD: 'text-zinc-400',
  OPTIONS: 'text-zinc-400'
}

function statusAccent(status: number, error?: string): string {
  if (error) return 'bg-rose-500'
  if (status >= 200 && status < 300) return 'bg-emerald-500'
  if (status >= 300 && status < 400) return 'bg-sky-500'
  if (status >= 400 && status < 500) return 'bg-amber-500'
  if (status >= 500) return 'bg-rose-500'
  return 'bg-zinc-600'
}

function statusLabel(status: number, statusText: string, error?: string): string {
  if (error) return 'err'
  if (!status) return '—'
  return statusText ? `${status} ${statusText}` : String(status)
}

function formatAgo(ts: number, now: number): string {
  const diff = Math.max(0, now - ts)
  if (diff < 1000) return 'now'
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`
  return `${Math.floor(diff / 86_400_000)}d`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function LivePulse(): React.JSX.Element {
  return (
    <span className="relative flex h-1.5 w-1.5">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
    </span>
  )
}

export function LiveFeed({ entries, onSelect, newestId }: LiveFeedProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [now, setNow] = useState(() => Date.now())

  // Tick once a second so relative timestamps on the feed drift forward
  // without remounting rows. Cheap — one setState per second.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return (): void => window.clearInterval(id)
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return entries
    return entries.filter(
      (e) =>
        e.url.toLowerCase().includes(q) ||
        e.method.toLowerCase().includes(q) ||
        (e.requestName ?? '').toLowerCase().includes(q)
    )
  }, [entries, query])

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <LivePulse />
          <span className="text-[11px] font-semibold tracking-wider text-foreground uppercase">
            Live
          </span>
        </div>
        <span className="text-[11px] text-muted-foreground">
          {entries.length} {entries.length === 1 ? 'request' : 'requests'}
        </span>
        <div className="ml-auto flex items-center">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter URL, method, name…"
              className="h-7 w-64 pl-7 font-mono text-[11px]"
            />
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState hasEntries={entries.length > 0} />
      ) : (
        <ScrollArea className="flex-1">
          <div className="divide-y divide-border/50">
            {filtered.map((entry) => {
              const isNew = entry.id === newestId
              const method = entry.method
              const status = entry.response.status
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => onSelect(entry)}
                  className={cn(
                    'group relative flex w-full items-center gap-4 px-5 py-2.5 text-left transition hover:bg-muted/40',
                    isNew && 'animate-[liveFeedEnter_600ms_ease-out]'
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-0 bottom-0 left-0 w-[2px]',
                      statusAccent(status, entry.response.error)
                    )}
                  />
                  <span
                    className={cn(
                      'w-12 shrink-0 font-mono text-[10px] font-bold tracking-wide',
                      METHOD_COLOR[method] ?? 'text-zinc-400'
                    )}
                  >
                    {method}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                    {entry.url || '(no url)'}
                  </span>
                  <span className="w-24 shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
                    {statusLabel(status, entry.response.statusText, entry.response.error)}
                  </span>
                  <span className="w-14 shrink-0 text-right font-mono text-[10px] text-muted-foreground tabular-nums">
                    {formatDuration(entry.response.durationMs)}
                  </span>
                  <span className="w-10 shrink-0 text-right font-mono text-[10px] text-muted-foreground tabular-nums">
                    {formatAgo(entry.sentAt, now)}
                  </span>
                </button>
              )
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}

function EmptyState({ hasEntries }: { hasEntries: boolean }): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted/40 ring-1 ring-border">
        <Radio className="h-4 w-4" />
      </div>
      <div className="text-sm">
        {hasEntries ? 'No matches' : 'Waiting for the first request'}
      </div>
      {!hasEntries && (
        <div className="max-w-sm px-6 text-center text-[11px]">
          Hit send from the editor, or let an AI client drive pls via MCP — every
          request that runs will stream into this feed in real time.
        </div>
      )}
    </div>
  )
}
