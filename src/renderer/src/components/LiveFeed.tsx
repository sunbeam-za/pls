// Real-time request feed. Two-column layout: a dense list of sends on
// the left, a full detail panel on the right. As new entries stream in
// the detail panel auto-follows the latest unless the user has pinned a
// specific row — so in the common case ("I'm watching Claude drive pls")
// you see the response fly in without touching the mouse.
//
// Style: Stripe Workbench-ish. Dense monospace, thin borders, status
// coloured via a left accent, new entries fade in from the top.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pin, PinOff, Radio, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from '@/components/ui/resizable'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { HistoryEntry } from '../../../preload/index'

interface LiveFeedProps {
  entries: HistoryEntry[]
  /**
   * Hand a replayed entry back to App so it can hydrate the static
   * response viewer + jump to the original request. Called when the
   * user clicks "Open in editor" from the detail panel.
   */
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

function statusTone(status: number, error?: string): string {
  if (error) return 'text-rose-400'
  if (status >= 200 && status < 300) return 'text-emerald-400'
  if (status >= 300 && status < 400) return 'text-sky-400'
  if (status >= 400 && status < 500) return 'text-amber-400'
  if (status >= 500) return 'text-rose-400'
  return 'text-muted-foreground'
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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function tryPretty(body: string): string {
  const t = body.trim()
  if (!t) return body
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    try {
      return JSON.stringify(JSON.parse(t), null, 2)
    } catch {
      return body
    }
  }
  return body
}

function LivePulse(): React.JSX.Element {
  // Two staggered ping rings + a persistent box-shadow pulse. Reads as a
  // confident "recording" indicator rather than a shy blink.
  return (
    <span className="relative flex h-2 w-2 items-center justify-center">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
      <span
        className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40"
        style={{ animationDelay: '400ms' }}
      />
      <span
        className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400"
        style={{ animation: 'liveChipPulse 2s ease-in-out infinite' }}
      />
    </span>
  )
}

export function LiveFeed({ entries, onSelect, newestId }: LiveFeedProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [now, setNow] = useState(() => Date.now())
  // Pin state: when true, the detail panel stays on `pinnedId` regardless
  // of new entries landing. When false, the detail panel auto-follows the
  // most recent entry. Default is auto-follow — that's the whole point
  // of Live mode.
  const [pinnedId, setPinnedId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // One DOM node per row so keyboard navigation can scroll the active
  // entry back into view without querying by id every time.
  const rowRefs = useRef<Map<string, HTMLButtonElement>>(new Map())

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

  // Selection resolution:
  //   - If the user pinned a row, show that row (if it still exists).
  //   - Otherwise follow the first filtered entry, which is the most recent.
  const activeEntry = useMemo(() => {
    if (pinnedId) {
      const pinned = entries.find((e) => e.id === pinnedId)
      if (pinned) return pinned
    }
    return filtered[0] ?? null
  }, [pinnedId, entries, filtered])

  // When the pinned row disappears (cleared, filtered out) fall back to
  // auto-follow rather than showing an empty detail panel.
  useEffect(() => {
    if (pinnedId && !entries.some((e) => e.id === pinnedId)) {
      setPinnedId(null)
    }
  }, [entries, pinnedId])

  // Auto-scroll the list to the top whenever a fresh entry lands and we're
  // not pinned — the new row is the one the user cares about.
  useEffect(() => {
    if (!pinnedId && listRef.current) {
      listRef.current.scrollTop = 0
    }
  }, [newestId, pinnedId])

  // Move the pinned selection forward / backward through the filtered
  // list. Exposes vim-style j/k and arrow keys; Home/End jump to the
  // ends; Escape releases the pin (back to follow-latest).
  const moveSelection = useCallback(
    (delta: number) => {
      if (filtered.length === 0) return
      const currentIdx = pinnedId
        ? filtered.findIndex((e) => e.id === pinnedId)
        : 0 // unpinned = currently showing newest (index 0)
      const nextIdx = Math.max(0, Math.min(filtered.length - 1, (currentIdx < 0 ? 0 : currentIdx) + delta))
      const nextEntry = filtered[nextIdx]
      if (!nextEntry) return
      setPinnedId(nextEntry.id)
      // Defer the scroll until the row is in the DOM with its new active
      // class (one tick is enough — React will have flushed by then).
      requestAnimationFrame(() => {
        rowRefs.current.get(nextEntry.id)?.scrollIntoView({ block: 'nearest' })
      })
    },
    [filtered, pinnedId]
  )

  // Window-level key handler. Suppressed while an input/textarea is
  // focused so typing in the filter box doesn't steal j/k. Only active
  // while LiveFeed is mounted — unmounting removes the listener.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target
      if (target instanceof HTMLElement) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return
      }
      // Ignore shortcuts that already belong to the global registry.
      if (event.metaKey || event.ctrlKey || event.altKey) return

      switch (event.key) {
        case 'ArrowDown':
        case 'j':
          event.preventDefault()
          moveSelection(1)
          break
        case 'ArrowUp':
        case 'k':
          event.preventDefault()
          moveSelection(-1)
          break
        case 'Home':
        case 'g':
          event.preventDefault()
          if (filtered[0]) {
            setPinnedId(filtered[0].id)
            rowRefs.current.get(filtered[0].id)?.scrollIntoView({ block: 'nearest' })
          }
          break
        case 'End':
        case 'G': {
          event.preventDefault()
          const last = filtered[filtered.length - 1]
          if (last) {
            setPinnedId(last.id)
            rowRefs.current.get(last.id)?.scrollIntoView({ block: 'nearest' })
          }
          break
        }
        case 'Escape':
          if (pinnedId) {
            event.preventDefault()
            setPinnedId(null)
          }
          break
        case 'Enter':
          if (activeEntry) {
            event.preventDefault()
            onSelect(activeEntry)
          }
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return (): void => window.removeEventListener('keydown', onKey)
  }, [moveSelection, filtered, pinnedId, activeEntry, onSelect])

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
        <div className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1">
          <LivePulse />
          <span className="text-[10px] font-semibold tracking-wider text-emerald-300 uppercase">
            Live
          </span>
        </div>
        <span className="text-[11px] text-muted-foreground">
          {entries.length} {entries.length === 1 ? 'request' : 'requests'}
        </span>
        {entries.length > 0 && (
          <div className="hidden items-center gap-1 text-[10px] text-muted-foreground lg:flex">
            <Kbd keys={['up']} />
            <Kbd keys={['down']} />
            <span>navigate</span>
            <span className="mx-1 text-border">·</span>
            <Kbd keys={['enter']} />
            <span>open</span>
            <span className="mx-1 text-border">·</span>
            <Kbd keys={['escape']} />
            <span>follow</span>
          </div>
        )}
        {pinnedId && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 gap-1 text-[10px] text-muted-foreground hover:text-foreground"
            onClick={() => setPinnedId(null)}
          >
            <PinOff className="h-3 w-3" />
            Follow latest
          </Button>
        )}
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

      {entries.length === 0 ? (
        <EmptyState hasEntries={false} />
      ) : (
        <ResizablePanelGroup orientation="horizontal" className="flex-1">
          <ResizablePanel defaultSize="45%" minSize="25%">
            <div ref={listRef} className="h-full overflow-auto">
              {filtered.length === 0 ? (
                <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">
                  No matches
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {filtered.map((entry) => {
                    const isNew = entry.id === newestId
                    const isActive = entry.id === activeEntry?.id
                    // The row that's *both* currently-followed and unpinned
                    // is the one the eye should land on — give it the
                    // breathing treatment so Live mode visibly shimmers.
                    const isLiveFollow = isActive && !pinnedId
                    const method = entry.method
                    const status = entry.response.status
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        ref={(el) => {
                          if (el) rowRefs.current.set(entry.id, el)
                          else rowRefs.current.delete(entry.id)
                        }}
                        onClick={() => setPinnedId(entry.id)}
                        className={cn(
                          'group relative flex w-full items-center gap-3 overflow-hidden px-4 py-2 text-left transition',
                          isActive ? 'bg-muted/60' : 'hover:bg-muted/30',
                          isNew && 'animate-[liveFeedEnter_2800ms_ease-out]'
                        )}
                        style={
                          isLiveFollow
                            ? { animation: 'liveFeedBreathe 2.6s ease-in-out infinite' }
                            : undefined
                        }
                      >
                        {/* Sweep sheen — fires once when a brand-new row
                            lands, travels left-to-right. Overlay, pointer-
                            events-none so it doesn't eat clicks. */}
                        {isNew && (
                          <span
                            className="pointer-events-none absolute inset-0 -skew-x-12 bg-gradient-to-r from-transparent via-primary/25 to-transparent"
                            style={{ animation: 'liveFeedSweep 1600ms ease-out 1' }}
                          />
                        )}
                        <span
                          className={cn(
                            'absolute top-0 bottom-0 left-0 w-[2px]',
                            statusAccent(status, entry.response.error),
                            isLiveFollow && 'animate-pulse'
                          )}
                        />
                        <span
                          className={cn(
                            'w-11 shrink-0 font-mono text-[10px] font-bold tracking-wide',
                            METHOD_COLOR[method] ?? 'text-zinc-400'
                          )}
                        >
                          {method}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                          {entry.url || '(no url)'}
                        </span>
                        <span
                          className={cn(
                            'shrink-0 font-mono text-[10px] tabular-nums',
                            statusTone(status, entry.response.error)
                          )}
                        >
                          {status || (entry.response.error ? 'err' : '—')}
                        </span>
                        <span className="w-10 shrink-0 text-right font-mono text-[9px] text-muted-foreground tabular-nums">
                          {formatAgo(entry.sentAt, now)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize="55%" minSize="30%">
            <LiveFeedDetail
              entry={activeEntry}
              pinned={!!pinnedId}
              onPin={() => activeEntry && setPinnedId(activeEntry.id)}
              onUnpin={() => setPinnedId(null)}
              onReplay={() => activeEntry && onSelect(activeEntry)}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  )
}

function LiveFeedDetail({
  entry,
  pinned,
  onPin,
  onUnpin,
  onReplay
}: {
  entry: HistoryEntry | null
  pinned: boolean
  onPin: () => void
  onUnpin: () => void
  onReplay: () => void
}): React.JSX.Element {
  if (!entry) {
    return (
      <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">
        Select a request to see details
      </div>
    )
  }

  const { response } = entry
  const requestHeaders = entry.headers.filter((h) => h.enabled && h.key.trim())

  return (
    <div className="flex h-full flex-col">
      {/* Summary bar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
        <span
          className={cn(
            'font-mono text-[11px] font-bold tracking-wide',
            METHOD_COLOR[entry.method] ?? 'text-zinc-400'
          )}
        >
          {entry.method}
        </span>
        <span className="flex-1 truncate font-mono text-[11px]">{entry.url || '(no url)'}</span>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
          title={pinned ? 'Unpin (follow latest)' : 'Pin this request'}
          onClick={pinned ? onUnpin : onPin}
        >
          {pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
        </Button>
        <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={onReplay}>
          Open in editor
        </Button>
      </div>

      {/* Metadata row */}
      <div className="flex shrink-0 items-center gap-4 border-b border-border px-5 py-2 font-mono text-[10px]">
        <span className={cn('font-semibold', statusTone(response.status, response.error))}>
          {statusLabel(response.status, response.statusText, response.error)}
        </span>
        <span className="text-muted-foreground">{formatDuration(response.durationMs)}</span>
        <span className="text-muted-foreground">{formatSize(response.size)}</span>
        <span className="ml-auto text-muted-foreground">
          {new Date(entry.sentAt).toLocaleTimeString()}
        </span>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-4 p-5">
          {/* Response body first — it's what you want to see in Live mode */}
          <Section label="Response body">
            {response.error ? (
              <div className="rounded border border-rose-500/30 bg-rose-500/5 p-3 font-mono text-[11px] text-rose-300">
                {response.error}
              </div>
            ) : (
              <pre className="max-h-[40vh] overflow-auto rounded border border-border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                {tryPretty(response.bodyPreview) || '(empty)'}
                {response.bodyTruncated && '\n\n… (truncated in history)'}
              </pre>
            )}
          </Section>

          {requestHeaders.length > 0 && (
            <Section label="Request headers">
              <HeaderList headers={requestHeaders.map((h) => [h.key, h.value])} />
            </Section>
          )}

          {entry.body && (
            <Section label="Request body">
              <pre className="max-h-[20vh] overflow-auto rounded border border-border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                {tryPretty(entry.body)}
              </pre>
            </Section>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

function Section({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div>
      <div className="mb-1.5 text-[9px] font-semibold tracking-wider text-muted-foreground uppercase">
        {label}
      </div>
      {children}
    </div>
  )
}

function HeaderList({ headers }: { headers: Array<[string, string]> }): React.JSX.Element {
  return (
    <div className="rounded border border-border bg-muted/20 font-mono text-[10px]">
      {headers.map(([k, v], i) => (
        <div
          key={i}
          className="grid grid-cols-[160px_1fr] gap-3 border-b border-border/50 px-3 py-1.5 last:border-b-0"
        >
          <span className="truncate text-primary">{k}</span>
          <span className="break-all text-foreground">{v}</span>
        </div>
      ))}
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
