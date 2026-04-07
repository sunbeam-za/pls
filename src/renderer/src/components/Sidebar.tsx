import {
  ChevronRight,
  FileDown,
  FolderPlus,
  Link2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Trash2,
  Unlink
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { Collection, RequestItem } from '@/lib/storage'
import { useState } from 'react'

interface SidebarProps {
  collections: Collection[]
  activeRequestId: string | null
  onSelectRequest: (collectionId: string, requestId: string) => void
  onNewCollection: () => void
  onNewRequest: (collectionId: string) => void
  onRenameCollection: (collectionId: string, name: string) => void
  onRenameRequest: (collectionId: string, requestId: string, name: string) => void
  onDeleteCollection: (collectionId: string) => void
  onDeleteRequest: (collectionId: string, requestId: string) => void
  onImportOpenApi: () => void
  onSyncOpenApi: (collectionId: string) => void
  onUnlinkOpenApi: (collectionId: string) => void
  syncingCollectionId: string | null
}

function formatSyncTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

const methodColor: Record<string, string> = {
  GET: 'text-emerald-400',
  POST: 'text-amber-400',
  PUT: 'text-sky-400',
  PATCH: 'text-violet-400',
  DELETE: 'text-rose-400',
  HEAD: 'text-zinc-400',
  OPTIONS: 'text-zinc-400'
}

export function Sidebar(props: SidebarProps): React.JSX.Element {
  const {
    collections,
    activeRequestId,
    onSelectRequest,
    onNewCollection,
    onNewRequest,
    onRenameCollection,
    onRenameRequest,
    onDeleteCollection,
    onDeleteRequest,
    onImportOpenApi,
    onSyncOpenApi,
    onUnlinkOpenApi,
    syncingCollectionId
  } = props

  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [editing, setEditing] = useState<string | null>(null)

  const toggle = (id: string): void => setOpen((s) => ({ ...s, [id]: !(s[id] ?? true) }))
  const isOpen = (id: string): boolean => open[id] ?? true

  return (
    <div className="flex h-full flex-col bg-sidebar">
      {/* Drag region for the title bar */}
      <div
        className="flex h-[52px] shrink-0 items-center justify-between border-b border-sidebar-border pr-2 pl-20"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-1.5 rounded-full bg-primary" />
          <span className="text-sm font-semibold tracking-tight">pls</span>
        </div>
        <div
          className="flex items-center gap-0.5"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onImportOpenApi}
            title="Import from OpenAPI"
          >
            <FileDown className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onNewCollection}
            title="New collection"
          >
            <FolderPlus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
          Collections
        </span>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-2 pb-4">
          {collections.length === 0 ? (
            <div className="px-3 py-12 text-center">
              <p className="text-xs text-muted-foreground">No collections yet</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 h-7"
                onClick={onNewCollection}
              >
                <FolderPlus className="mr-1 h-3 w-3" />
                New collection
              </Button>
            </div>
          ) : (
            collections.map((c) => {
              const linked = c.openapi
              const syncing = syncingCollectionId === c.id
              // Only specs with a remembered source (URL or file path) can be
              // re-synced. Pasted specs are a one-shot import.
              const canResync = Boolean(
                linked && (linked.sourceType === 'url' || linked.sourceType === 'file')
              )
              return (
              <div key={c.id} className="mb-1">
                <div className="group flex items-center gap-1 rounded-md px-2 py-1 hover:bg-sidebar-accent">
                  <button
                    type="button"
                    onClick={() => toggle(c.id)}
                    className="flex flex-1 items-center gap-1.5 text-left"
                  >
                    <ChevronRight
                      className={cn(
                        'h-3 w-3 shrink-0 text-muted-foreground transition-transform',
                        isOpen(c.id) && 'rotate-90'
                      )}
                    />
                    {editing === c.id ? (
                      <Input
                        autoFocus
                        defaultValue={c.name}
                        onBlur={(e) => {
                          onRenameCollection(c.id, e.target.value || c.name)
                          setEditing(null)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                          if (e.key === 'Escape') setEditing(null)
                        }}
                        className="h-6 px-1.5 py-0 text-sm"
                      />
                    ) : (
                      <span
                        className="flex flex-1 items-center gap-1.5 truncate text-sm font-medium"
                        onDoubleClick={() => setEditing(c.id)}
                      >
                        <span className="truncate">{c.name}</span>
                        {linked && (
                          <span
                            title={`Linked to OpenAPI spec${
                              linked.sourceLocation ? `: ${linked.sourceLocation}` : ''
                            }\nLast synced ${formatSyncTime(linked.lastSyncedAt)}`}
                            className="inline-flex shrink-0 items-center text-primary/70"
                          >
                            <Link2 className="h-3 w-3" />
                          </span>
                        )}
                      </span>
                    )}
                  </button>
                  <div className="flex shrink-0 items-center opacity-0 group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => {
                        setOpen((s) => ({ ...s, [c.id]: true }))
                        onNewRequest(c.id)
                      }}
                      title="New request"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6">
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setEditing(c.id)}>
                          Rename
                        </DropdownMenuItem>
                        {linked && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              disabled={!canResync || syncing}
                              onClick={() => onSyncOpenApi(c.id)}
                            >
                              <RefreshCw
                                className={cn('h-3.5 w-3.5', syncing && 'animate-spin')}
                              />
                              {syncing ? 'Syncing…' : 'Sync with spec'}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onUnlinkOpenApi(c.id)}>
                              <Unlink className="h-3.5 w-3.5" />
                              Unlink from spec
                            </DropdownMenuItem>
                          </>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => onDeleteCollection(c.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                {isOpen(c.id) && (
                  <div className="ml-3.5 border-l border-sidebar-border pl-1">
                    {c.requests.length === 0 ? (
                      <div className="px-2 py-1 text-[11px] text-muted-foreground">
                        No requests
                      </div>
                    ) : (
                      c.requests.map((r) => (
                        <RequestRow
                          key={r.id}
                          request={r}
                          active={r.id === activeRequestId}
                          editing={editing === r.id}
                          onSelect={() => onSelectRequest(c.id, r.id)}
                          onStartRename={() => setEditing(r.id)}
                          onRename={(name) => {
                            onRenameRequest(c.id, r.id, name)
                            setEditing(null)
                          }}
                          onCancelRename={() => setEditing(null)}
                          onDelete={() => onDeleteRequest(c.id, r.id)}
                        />
                      ))
                    )}
                  </div>
                )}
              </div>
              )
            })
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

interface RequestRowProps {
  request: RequestItem
  active: boolean
  editing: boolean
  onSelect: () => void
  onStartRename: () => void
  onRename: (name: string) => void
  onCancelRename: () => void
  onDelete: () => void
}

function RequestRow(props: RequestRowProps): React.JSX.Element {
  const { request, active, editing, onSelect, onStartRename, onRename, onCancelRename, onDelete } =
    props

  return (
    <div
      className={cn(
        'group relative flex items-center gap-2 rounded-md px-2 py-1 cursor-pointer',
        active ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/60'
      )}
      onClick={onSelect}
    >
      {active && (
        <div className="absolute top-1.5 bottom-1.5 -left-[5px] w-0.5 rounded-full bg-primary" />
      )}
      <span
        className={cn(
          'w-9 shrink-0 text-right font-mono text-[9px] font-bold tracking-wide',
          methodColor[request.method] ?? 'text-zinc-400'
        )}
      >
        {request.method}
      </span>
      {editing ? (
        <Input
          autoFocus
          defaultValue={request.name}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => onRename(e.target.value || request.name)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') onCancelRename()
          }}
          className="h-6 px-1.5 py-0 text-sm"
        />
      ) : (
        <span
          className="flex-1 truncate text-sm"
          onDoubleClick={(e) => {
            e.stopPropagation()
            onStartRename()
          }}
        >
          {request.name}
        </span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation()
              onStartRename()
            }}
          >
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
