import {
  ChevronRight,
  Clock,
  FileDown,
  Folder,
  FolderPlus,
  Link2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Share2,
  Trash2,
  Unlink,
  Upload
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
import type { Collection, FolderNode, RequestItem, TreeNode } from '@/lib/storage'
import { useState } from 'react'
import { McpHandoffButton } from '@/components/McpHandoff'
import { ShortcutTooltip } from '@/components/ShortcutTooltip'

interface SidebarProps {
  collections: Collection[]
  activeRequestId: string | null
  onSelectRequest: (collectionId: string, requestId: string) => void
  onNewCollection: () => void
  onNewRequest: (collectionId: string, parentFolderId?: string) => void
  onNewFolder: (collectionId: string, parentFolderId?: string) => void
  onRenameCollection: (collectionId: string, name: string) => void
  onRenameRequest: (collectionId: string, requestId: string, name: string) => void
  onRenameFolder: (collectionId: string, folderId: string, name: string) => void
  onDeleteCollection: (collectionId: string) => void
  onDeleteRequest: (collectionId: string, requestId: string) => void
  onDeleteFolder: (collectionId: string, folderId: string) => void
  onImportOpenApi: () => void
  onSyncOpenApi: (collectionId: string) => void
  onUnlinkOpenApi: (collectionId: string) => void
  onExportCollection: (collectionId: string) => void
  onImportCollection: () => void
  syncingCollectionId: string | null
  onOpenHistory: () => void
  historyCount: number
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
    onNewFolder,
    onRenameCollection,
    onRenameRequest,
    onRenameFolder,
    onDeleteCollection,
    onDeleteRequest,
    onDeleteFolder,
    onImportOpenApi,
    onSyncOpenApi,
    onUnlinkOpenApi,
    onExportCollection,
    onImportCollection,
    syncingCollectionId,
    onOpenHistory,
    historyCount
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
          <ShortcutTooltip
            label={historyCount ? `History (${historyCount})` : 'History'}
            shortcut="open-history"
          >
            <Button
              variant="ghost"
              size="icon"
              className="relative h-7 w-7"
              onClick={onOpenHistory}
            >
              <Clock className="h-4 w-4" />
              {historyCount > 0 && (
                <span className="pointer-events-none absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
              )}
            </Button>
          </ShortcutTooltip>
          <ShortcutTooltip label="Import shared collection">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onImportCollection}>
              <Upload className="h-4 w-4" />
            </Button>
          </ShortcutTooltip>
          <ShortcutTooltip label="Import OpenAPI" shortcut="import-openapi">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onImportOpenApi}>
              <FileDown className="h-4 w-4" />
            </Button>
          </ShortcutTooltip>
          <ShortcutTooltip label="New collection" shortcut="new-collection">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onNewCollection}>
              <FolderPlus className="h-4 w-4" />
            </Button>
          </ShortcutTooltip>
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
                        <DropdownMenuItem onClick={() => onNewFolder(c.id)}>
                          <FolderPlus className="h-3.5 w-3.5" />
                          New folder
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onExportCollection(c.id)}>
                          <Share2 className="h-3.5 w-3.5" />
                          Share…
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
                    {c.children.length === 0 ? (
                      <div className="px-2 py-1 text-[11px] text-muted-foreground">
                        Empty
                      </div>
                    ) : (
                      <TreeNodeList
                        nodes={c.children}
                        collectionId={c.id}
                        activeRequestId={activeRequestId}
                        editing={editing}
                        setEditing={setEditing}
                        onSelectRequest={onSelectRequest}
                        onRenameRequest={onRenameRequest}
                        onDeleteRequest={onDeleteRequest}
                        onRenameFolder={onRenameFolder}
                        onDeleteFolder={onDeleteFolder}
                        onNewRequest={onNewRequest}
                        onNewFolder={onNewFolder}
                      />
                    )}
                  </div>
                )}
              </div>
              )
            })
          )}
        </div>
      </ScrollArea>
      <div className="shrink-0 border-t border-sidebar-border pt-2">
        <McpHandoffButton />
      </div>
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

// ---------- Tree rendering ----------
// Recursive node list. Each level gets its own indent border, matching
// the collection-level indent so nested folders still read as a tree.

interface TreeNodeListProps {
  nodes: TreeNode[]
  collectionId: string
  activeRequestId: string | null
  editing: string | null
  setEditing: (id: string | null) => void
  onSelectRequest: (collectionId: string, requestId: string) => void
  onRenameRequest: (collectionId: string, requestId: string, name: string) => void
  onDeleteRequest: (collectionId: string, requestId: string) => void
  onRenameFolder: (collectionId: string, folderId: string, name: string) => void
  onDeleteFolder: (collectionId: string, folderId: string) => void
  onNewRequest: (collectionId: string, parentFolderId?: string) => void
  onNewFolder: (collectionId: string, parentFolderId?: string) => void
}

function TreeNodeList(props: TreeNodeListProps): React.JSX.Element {
  return (
    <>
      {props.nodes.map((node) =>
        node.kind === 'folder' ? (
          <FolderRow key={node.id} folder={node} {...props} />
        ) : (
          <RequestRow
            key={node.request.id}
            request={node.request}
            active={node.request.id === props.activeRequestId}
            editing={props.editing === node.request.id}
            onSelect={() => props.onSelectRequest(props.collectionId, node.request.id)}
            onStartRename={() => props.setEditing(node.request.id)}
            onRename={(name) => {
              props.onRenameRequest(props.collectionId, node.request.id, name)
              props.setEditing(null)
            }}
            onCancelRename={() => props.setEditing(null)}
            onDelete={() => props.onDeleteRequest(props.collectionId, node.request.id)}
          />
        )
      )}
    </>
  )
}

function FolderRow({
  folder,
  ...rest
}: TreeNodeListProps & { folder: FolderNode }): React.JSX.Element {
  const [open, setOpen] = useState(true)
  const {
    collectionId,
    editing,
    setEditing,
    onRenameFolder,
    onDeleteFolder,
    onNewRequest,
    onNewFolder
  } = rest
  const isEditing = editing === folder.id

  return (
    <div>
      <div className="group flex items-center gap-1 rounded-md px-2 py-1 hover:bg-sidebar-accent/60">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-1.5 text-left"
        >
          <ChevronRight
            className={cn(
              'h-3 w-3 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-90'
            )}
          />
          <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {isEditing ? (
            <Input
              autoFocus
              defaultValue={folder.name}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                onRenameFolder(collectionId, folder.id, e.target.value || folder.name)
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
              className="flex-1 truncate text-sm font-medium"
              onDoubleClick={(e) => {
                e.stopPropagation()
                setEditing(folder.id)
              }}
            >
              {folder.name}
            </span>
          )}
        </button>
        <div className="flex shrink-0 items-center opacity-0 group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={() => {
              setOpen(true)
              onNewRequest(collectionId, folder.id)
            }}
            title="New request"
          >
            <Plus className="h-3 w-3" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-5 w-5">
                <MoreHorizontal className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setEditing(folder.id)}>Rename</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onNewFolder(collectionId, folder.id)}>
                <FolderPlus className="h-3.5 w-3.5" />
                New folder
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => onDeleteFolder(collectionId, folder.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {open && (
        <div className="ml-3 border-l border-sidebar-border pl-1">
          {folder.children.length === 0 ? (
            <div className="px-2 py-1 text-[10px] text-muted-foreground">Empty</div>
          ) : (
            <TreeNodeList {...rest} nodes={folder.children} />
          )}
        </div>
      )}
    </div>
  )
}
