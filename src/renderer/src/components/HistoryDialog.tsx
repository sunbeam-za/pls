// Chronological feed of every send, newest first. Clicking an entry
// re-hydrates the stored response into the main viewer without re-sending
// (and re-selects the original saved request if it still exists).

import { useMemo, useState } from 'react'
import { Search, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import type { HistoryEntry } from '../../../preload/index'

interface HistoryDialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  entries: HistoryEntry[]
  onReplay: (entry: HistoryEntry) => void
  onClear: () => void
}

const methodColor: Record<string, string> = {
  GET: 'text-emerald-400',
  POST: 'text-sky-400',
  PUT: 'text-amber-400',
  PATCH: 'text-amber-400',
  DELETE: 'text-rose-400',
  HEAD: 'text-zinc-400',
  OPTIONS: 'text-zinc-400'
}

function statusClass(status: number, error?: string): string {
  if (error) return 'text-rose-400'
  if (status >= 200 && status < 300) return 'text-emerald-400'
  if (status >= 300 && status < 400) return 'text-sky-400'
  if (status >= 400 && status < 500) return 'text-amber-400'
  if (status >= 500) return 'text-rose-400'
  return 'text-muted-foreground'
}

function formatAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 10_000) return 'just now'
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

export function HistoryDialog({
  open,
  onOpenChange,
  entries,
  onReplay,
  onClear
}: HistoryDialogProps): React.JSX.Element {
  const [query, setQuery] = useState('')
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Request history</DialogTitle>
          <DialogDescription>
            {entries.length === 0
              ? 'Nothing yet — send a request and it\'ll show up here.'
              : `Last ${entries.length} send${entries.length === 1 ? '' : 's'}. Click to view the response.`}
          </DialogDescription>
        </DialogHeader>

        {entries.length > 0 && (
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by URL, method, or name"
                className="h-8 pl-7 text-xs"
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-rose-400"
              onClick={() => {
                if (confirm('Clear all history?')) onClear()
              }}
            >
              <Trash2 className="h-3 w-3" />
              Clear
            </Button>
          </div>
        )}

        <ScrollArea className="max-h-[60vh]">
          <div className="flex flex-col">
            {filtered.length === 0 && entries.length > 0 && (
              <div className="px-2 py-6 text-center text-xs text-muted-foreground">
                No matches
              </div>
            )}
            {filtered.map((entry) => {
              const { response } = entry
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => onReplay(entry)}
                  className="group flex items-center gap-3 rounded-md border border-transparent px-2 py-2 text-left transition hover:border-border hover:bg-muted/40"
                >
                  <span
                    className={cn(
                      'w-14 shrink-0 text-right font-mono text-[10px] font-semibold',
                      methodColor[entry.method] ?? 'text-muted-foreground'
                    )}
                  >
                    {entry.method}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs">
                      {entry.requestName && (
                        <span className="mr-1.5 text-muted-foreground">{entry.requestName}</span>
                      )}
                      <span className="font-mono text-[11px]">{entry.url || '(no url)'}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span className={statusClass(response.status, response.error)}>
                        {response.error ? 'error' : `${response.status} ${response.statusText}`}
                      </span>
                      <span>·</span>
                      <span>{formatDuration(response.durationMs)}</span>
                      <span>·</span>
                      <span>{formatAgo(entry.sentAt)}</span>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
