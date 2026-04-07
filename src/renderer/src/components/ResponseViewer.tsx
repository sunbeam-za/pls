import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import type { SendRequestResult } from '../../../preload/index'
import { CodeEditor } from './CodeEditor'

interface ResponseViewerProps {
  result: SendRequestResult | null
  sending: boolean
}

function statusClass(status: number): string {
  if (status >= 200 && status < 300) return 'text-emerald-400'
  if (status >= 300 && status < 400) return 'text-sky-400'
  if (status >= 400 && status < 500) return 'text-amber-400'
  if (status >= 500) return 'text-rose-400'
  return 'text-rose-400'
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

export function ResponseViewer({ result, sending }: ResponseViewerProps): React.JSX.Element {
  if (sending) {
    return (
      <div className="flex flex-1 items-center justify-center border-t border-border bg-card text-sm text-muted-foreground">
        <span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
        Sending request…
      </div>
    )
  }

  if (!result) {
    return (
      <div className="flex flex-1 items-center justify-center border-t border-border bg-card text-xs text-muted-foreground">
        Send a request to see the response
      </div>
    )
  }

  if (result.error) {
    return (
      <div className="flex flex-1 flex-col border-t border-border bg-card">
        <div className="flex items-center gap-3 border-b border-border px-5 py-3 text-xs">
          <span className="rounded-md bg-muted px-2 py-1 font-mono font-bold text-rose-400">
            ERROR
          </span>
          <span className="font-mono text-muted-foreground">{result.durationMs}ms</span>
        </div>
        <div className="flex-1 overflow-auto p-5 font-mono text-xs text-rose-400">
          {result.error}
        </div>
      </div>
    )
  }

  const headerEntries = Object.entries(result.headers)
  const pretty = tryPretty(result.body)

  return (
    <div className="flex flex-1 flex-col border-t border-border bg-card">
      <div className="flex items-center gap-4 border-b border-border px-5 py-3 text-xs">
        <span
          className={cn(
            'rounded-md bg-muted px-2 py-1 font-mono font-bold',
            statusClass(result.status)
          )}
        >
          {result.status} {result.statusText}
        </span>
        <span className="font-mono text-muted-foreground">{result.durationMs}ms</span>
        <span className="font-mono text-muted-foreground">{formatSize(result.size)}</span>
      </div>

      <Tabs defaultValue="body" className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b border-border px-5">
          <TabsList variant="line" className="h-9">
            <TabsTrigger value="body">Body</TabsTrigger>
            <TabsTrigger value="headers">
              Headers
              <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {headerEntries.length}
              </span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="body" className="m-0 flex-1 overflow-hidden p-0">
          <CodeEditor
            value={pretty}
            readOnly
            minHeight="100%"
            maxHeight="100%"
            className="h-full"
          />
        </TabsContent>

        <TabsContent value="headers" className="m-0 flex-1 overflow-auto p-0">
          <div className="px-5 py-3 font-mono text-xs">
            {headerEntries.map(([k, v]) => (
              <div
                key={k}
                className="grid grid-cols-[220px_1fr] gap-4 border-b border-border py-1.5 last:border-b-0"
              >
                <span className="text-primary">{k}</span>
                <span className="break-all text-foreground">{v}</span>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
