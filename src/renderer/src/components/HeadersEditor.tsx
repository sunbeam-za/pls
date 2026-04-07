import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { HeaderEntry } from '../../../preload/index'

interface HeadersEditorProps {
  headers: HeaderEntry[]
  onChange: (headers: HeaderEntry[]) => void
}

export function HeadersEditor({ headers, onChange }: HeadersEditorProps): React.JSX.Element {
  const update = (i: number, patch: Partial<HeaderEntry>): void => {
    const next = headers.slice()
    next[i] = { ...next[i], ...patch }
    onChange(next)
  }
  const add = (): void => onChange([...headers, { key: '', value: '', enabled: true }])
  const remove = (i: number): void => onChange(headers.filter((_, idx) => idx !== i))

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="grid grid-cols-[36px_1fr_1.5fr_36px] items-center border-b border-border bg-muted/40 px-3 py-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
          <span />
          <span>Key</span>
          <span>Value</span>
          <span />
        </div>
        {headers.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            No headers
          </div>
        ) : (
          headers.map((h, i) => (
            <div
              key={i}
              className={cn(
                'grid grid-cols-[36px_1fr_1.5fr_36px] items-center border-b border-border last:border-b-0',
                !h.enabled && 'opacity-50'
              )}
            >
              <div className="flex items-center justify-center">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-primary"
                  checked={h.enabled}
                  onChange={(e) => update(i, { enabled: e.target.checked })}
                />
              </div>
              <Input
                value={h.key}
                onChange={(e) => update(i, { key: e.target.value })}
                placeholder="Header"
                className="h-9 rounded-none border-0 border-l border-border font-mono text-xs focus-visible:ring-0"
              />
              <Input
                value={h.value}
                onChange={(e) => update(i, { value: e.target.value })}
                placeholder="Value"
                className="h-9 rounded-none border-0 border-l border-border font-mono text-xs focus-visible:ring-0"
              />
              <div className="flex items-center justify-center border-l border-border">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => remove(i)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
      <Button variant="outline" size="sm" className="h-8" onClick={add}>
        <Plus className="mr-1 h-3.5 w-3.5" />
        Add header
      </Button>
    </div>
  )
}
