// Little "connect your AI" widget. Lives in the sidebar footer.
//
// Favicons are fetched via the main process (which has no CSP) — see
// `fetchFavicon` in src/main/index.ts. Each vendor's own /favicon.ico is
// tried first, then /favicon.png, then /apple-touch-icon.png. Results are
// cached in the main process for the lifetime of the app, so there's only
// ever one network call per domain.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Copy, Sparkles, Star, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import type { McpInfo } from '../../../preload/index'

interface ClientDef {
  id: 'claude-desktop' | 'claude-code' | 'cursor' | 'windsurf'
  name: string
  blurb: string
  /** Domain pls will fetch `/favicon.ico` from (via the main process). */
  domain: string
  format: 'json' | 'shell'
  render: (info: McpInfo) => string
  installedKey?: keyof McpInfo['installed']
}

const jsonSnippet = (info: McpInfo): string =>
  JSON.stringify(
    {
      mcpServers: {
        pls: { command: info.command, args: info.args }
      }
    },
    null,
    2
  )

const CLIENTS: ClientDef[] = [
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    blurb: '~/Library/Application Support/Claude/claude_desktop_config.json',
    domain: 'claude.ai',
    format: 'json',
    installedKey: 'claudeDesktop',
    render: jsonSnippet
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    blurb: 'Run in any terminal',
    domain: 'claude.com',
    format: 'shell',
    installedKey: 'claudeCode',
    render: (info) => `claude mcp add pls -- ${info.command} ${info.args.join(' ')}`
  },
  {
    id: 'cursor',
    name: 'Cursor',
    blurb: '~/.cursor/mcp.json',
    domain: 'cursor.com',
    format: 'json',
    installedKey: 'cursor',
    render: jsonSnippet
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    blurb: '~/.codeium/windsurf/mcp_config.json',
    domain: 'windsurf.com',
    format: 'json',
    render: jsonSnippet
  }
]

// Module-level cache so reopening the dialog (or switching tiles) never
// causes a fetch flash. `null` means "tried and failed" — we render a
// letter fallback in that case.
const faviconCache = new Map<string, string | null>()

function BrandTile({
  client,
  active
}: {
  client: ClientDef
  active: boolean
}): React.JSX.Element {
  const [dataUrl, setDataUrl] = useState<string | null | undefined>(() =>
    faviconCache.get(client.domain)
  )

  useEffect(() => {
    if (faviconCache.has(client.domain)) return
    let cancelled = false
    window.api
      .getFavicon(client.domain)
      .then((result) => {
        if (cancelled) return
        faviconCache.set(client.domain, result)
        setDataUrl(result)
      })
      .catch(() => {
        if (cancelled) return
        faviconCache.set(client.domain, null)
        setDataUrl(null)
      })
    return (): void => {
      cancelled = true
    }
  }, [client.domain])

  return (
    <div
      className={cn(
        'flex h-10 w-10 items-center justify-center overflow-hidden rounded-md ring-1 transition',
        active
          ? 'bg-background ring-primary/60'
          : 'bg-background ring-white/10'
      )}
    >
      {dataUrl ? (
        <img
          src={dataUrl}
          alt={client.name}
          draggable={false}
          className="h-7 w-7 object-contain"
        />
      ) : dataUrl === null ? (
        // Network failed — show the vendor's first letter.
        <span className="text-sm font-semibold text-muted-foreground">
          {client.name.charAt(0)}
        </span>
      ) : (
        // Still loading — empty slot, no spinner (it settles in <100ms).
        <span className="h-5 w-5" />
      )}
    </div>
  )
}

export function McpHandoffButton(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<McpInfo | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    window.api.mcpInfo().then((result) => {
      if (!cancelled) setInfo(result)
    })
    return (): void => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    let cancelled = false
    window.api.mcpInfo().then((result) => {
      if (!cancelled) setInfo(result)
    })
    return (): void => {
      cancelled = true
    }
  }, [])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group mx-3 mb-3 flex items-center gap-2.5 rounded-lg border border-sidebar-border bg-sidebar-accent/40 px-3 py-2 text-left transition hover:border-primary/60 hover:bg-sidebar-accent"
      >
        <div className="relative shrink-0">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-primary/20 to-primary/5 text-primary ring-1 ring-primary/30">
            <Star className="h-3.5 w-3.5 fill-current" />
          </div>
          <span
            className={cn(
              'absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full ring-2 ring-sidebar',
              info?.ready ? 'bg-emerald-400' : 'bg-amber-400'
            )}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-semibold tracking-tight">
            Connect your AI
          </div>
          <div className="truncate text-[10px] text-muted-foreground">
            {info?.ready ? 'MCP server ready' : 'Claude · Cursor · Windsurf'}
          </div>
        </div>
      </button>
      <HandoffDialog open={open} onOpenChange={setOpen} info={info} />
    </>
  )
}

function HandoffDialog({
  open,
  onOpenChange,
  info
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  info: McpInfo | null
}): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<ClientDef['id']>('claude-desktop')
  const selected = useMemo(() => CLIENTS.find((c) => c.id === selectedId)!, [selectedId])
  const snippet = useMemo(() => (info ? selected.render(info) : ''), [info, selected])
  const [copied, setCopied] = useState(false)

  const copy = useCallback(async () => {
    if (!snippet) return
    await navigator.clipboard.writeText(snippet)
    setCopied(true)
    toast.success(`${selected.name} config copied`)
    setTimeout(() => setCopied(false), 1600)
  }, [snippet, selected])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        overflow-hidden on the content + min-w-0 on each section is what
        keeps long JSON paths from stretching the dialog wider than max-w-xl.
        Without min-w-0, flex children refuse to shrink below their
        intrinsic content size — which is exactly the bug we had before.
      */}
      <DialogContent className="max-w-xl gap-4 overflow-hidden">
        <DialogHeader className="min-w-0 space-y-1">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            Connect your AI
          </DialogTitle>
          <DialogDescription className="text-xs">
            Pick a client and paste the snippet. Your AI can then list, read, and run your saved requests.
          </DialogDescription>
        </DialogHeader>

        {info && !info.ready && (
          <div className="flex min-w-0 items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-[11px]">
            <X className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
            <div className="min-w-0">
              <div className="font-medium text-amber-200">MCP server not built</div>
              <div className="mt-0.5 text-muted-foreground">
                Run <code className="rounded bg-muted px-1 py-0.5">npm run build:mcp</code> to generate it.
              </div>
            </div>
          </div>
        )}

        <div className="grid min-w-0 grid-cols-4 gap-2">
          {CLIENTS.map((client) => {
            const active = client.id === selectedId
            const installed = client.installedKey && info?.installed[client.installedKey]
            return (
              <button
                key={client.id}
                type="button"
                onClick={() => setSelectedId(client.id)}
                className={cn(
                  'group relative flex min-w-0 flex-col items-center gap-2 rounded-lg border p-2.5 text-center transition',
                  active
                    ? 'border-primary/60 bg-primary/5'
                    : 'border-border bg-card/50 hover:border-border/80 hover:bg-card'
                )}
              >
                <BrandTile client={client} active={active} />
                <div
                  className={cn(
                    'truncate text-[11px] leading-none font-medium',
                    active ? 'text-foreground' : 'text-muted-foreground'
                  )}
                >
                  {client.name}
                </div>
                {installed && (
                  <span
                    title="Detected on this machine"
                    className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-emerald-400 ring-2 ring-background"
                  />
                )}
              </button>
            )
          })}
        </div>

        <div className="min-w-0 space-y-1.5">
          <div className="flex min-w-0 items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="truncate">{selected.blurb}</span>
            <span className="shrink-0 tabular-nums">{selected.format === 'shell' ? 'shell' : 'json'}</span>
          </div>
          <div className="group relative min-w-0">
            {/* overflow-x-auto is the horizontal half; overflow-y lands in max-h. */}
            <pre className="max-h-48 w-full overflow-auto rounded-md border border-border bg-muted/30 p-3 pr-11 text-[11px] leading-relaxed font-mono whitespace-pre">
              {snippet || '…'}
            </pre>
            <Button
              size="icon"
              variant="ghost"
              onClick={copy}
              disabled={!info}
              title={copied ? 'Copied' : 'Copy snippet'}
              className="absolute top-1.5 right-1.5 h-7 w-7 bg-background/60 opacity-0 backdrop-blur transition group-hover:opacity-100 focus-visible:opacity-100"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>

        <div className="min-w-0 truncate text-[10px] text-muted-foreground">
          9 tools exposed · collections and OpenAPI specs also available as <code>pls://</code> resources.
        </div>
      </DialogContent>
    </Dialog>
  )
}
