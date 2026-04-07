import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from '@/components/ui/resizable'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { toast } from 'sonner'
import { Sidebar } from '@/components/Sidebar'
import { RequestEditor, type RequestEditorHandle } from '@/components/RequestEditor'
import { ResponseViewer } from '@/components/ResponseViewer'
import { OpenApiImportDialog } from '@/components/OpenApiImportDialog'
import { HistoryDialog } from '@/components/HistoryDialog'
import { AuthProfilesDialog } from '@/components/AuthProfilesDialog'
import { LiveFeed } from '@/components/LiveFeed'
import { Button } from '@/components/ui/button'
import { Radio } from 'lucide-react'
import { useShortcuts } from '@/hooks/useShortcuts'
import { cn } from '@/lib/utils'
import {
  newCollection,
  newRequest,
  type Collection,
  type RequestItem,
  type Store
} from '@/lib/storage'
import { resyncCollection } from '@/lib/openapi'
import type {
  AuthProfile,
  Environment,
  FolderNode,
  HistoryEntry,
  RequestNode,
  SendRequestResult,
  TreeNode
} from '../../preload/index'

// ---------- Tree helpers (renderer-local copies) ----------
// Mirrors the helpers in src/shared/store/types.ts. Kept here so the
// renderer bundle doesn't have to reach into shared code it doesn't
// otherwise need. Small enough that duplication is cheaper than wiring.

function* walkRequestsTree(nodes: TreeNode[]): Generator<RequestItem> {
  for (const node of nodes) {
    if (node.kind === 'request') yield node.request
    else yield* walkRequestsTree(node.children)
  }
}

function mapRequestsTree(
  nodes: TreeNode[],
  fn: (r: RequestItem) => RequestItem
): TreeNode[] {
  return nodes.map((node) => {
    if (node.kind === 'request') return { kind: 'request', request: fn(node.request) }
    return { ...node, children: mapRequestsTree(node.children, fn) }
  })
}

function filterRequestsTree(
  nodes: TreeNode[],
  keep: (r: RequestItem) => boolean
): TreeNode[] {
  const out: TreeNode[] = []
  for (const node of nodes) {
    if (node.kind === 'request') {
      if (keep(node.request)) out.push(node)
    } else {
      out.push({ ...node, children: filterRequestsTree(node.children, keep) })
    }
  }
  return out
}

function treeContainsRequest(nodes: TreeNode[], requestId: string): boolean {
  for (const node of nodes) {
    if (node.kind === 'request') {
      if (node.request.id === requestId) return true
    } else if (treeContainsRequest(node.children, requestId)) {
      return true
    }
  }
  return false
}

function appendToFolder(
  nodes: TreeNode[],
  folderId: string,
  child: TreeNode
): TreeNode[] {
  return nodes.map((node) => {
    if (node.kind !== 'folder') return node
    if (node.id === folderId) return { ...node, children: [...node.children, child] }
    return { ...node, children: appendToFolder(node.children, folderId, child) }
  })
}

function renameFolderInTree(
  nodes: TreeNode[],
  folderId: string,
  name: string
): TreeNode[] {
  return nodes.map((node) => {
    if (node.kind !== 'folder') return node
    if (node.id === folderId) return { ...node, name }
    return { ...node, children: renameFolderInTree(node.children, folderId, name) }
  })
}

function removeFolderFromTree(nodes: TreeNode[], folderId: string): TreeNode[] {
  const out: TreeNode[] = []
  for (const node of nodes) {
    if (node.kind !== 'folder') {
      out.push(node)
      continue
    }
    if (node.id === folderId) continue
    out.push({ ...node, children: removeFolderFromTree(node.children, folderId) })
  }
  return out
}

const HISTORY_MAX = 200
const HISTORY_BODY_MAX = 64 * 1024

const recordHistoryEntry = (
  request: RequestItem,
  result: SendRequestResult
): HistoryEntry => {
  const body = result.body ?? ''
  const truncated = body.length > HISTORY_BODY_MAX
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    sentAt: Date.now(),
    requestId: request.id,
    requestName: request.name,
    method: request.method,
    url: request.url,
    headers: request.headers,
    body: request.body,
    response: {
      ok: result.ok,
      status: result.status,
      statusText: result.statusText,
      durationMs: result.durationMs,
      size: result.size,
      error: result.error,
      bodyPreview: truncated ? body.slice(0, HISTORY_BODY_MAX) : body,
      bodyTruncated: truncated
    }
  }
}

function App(): React.JSX.Element {
  // Three separate slices mirror the persisted Store shape. Keeping them
  // as independent useState calls means the rest of the component tree
  // doesn't have to learn about the slice boundary — it just consumes
  // `collections`, `history`, etc. as before.
  const [collections, setCollections] = useState<Collection[]>([])
  const [authProfiles, setAuthProfiles] = useState<AuthProfile[]>([])
  const [environments, setEnvironments] = useState<Environment[]>([])
  const [activeEnvironmentId, setActiveEnvironmentId] = useState<string | undefined>(undefined)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null)
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null)
  const [response, setResponse] = useState<SendRequestResult | null>(null)
  const [sending, setSending] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [authProfilesOpen, setAuthProfilesOpen] = useState(false)
  const [syncingCollectionId, setSyncingCollectionId] = useState<string | null>(null)
  const [liveMode, setLiveMode] = useState(false)
  const [newestHistoryId, setNewestHistoryId] = useState<string | null>(null)
  const persistTimer = useRef<number | null>(null)
  const requestEditorRef = useRef<RequestEditorHandle>(null)

  // Load on mount. Guard against StrictMode double-mount: a stale resolve
  // from the first effect could otherwise stomp state set after the user
  // started interacting (which made "Create collection" appear no-op).
  useEffect(() => {
    let cancelled = false
    window.api
      .readStore()
      .then((store) => {
        if (cancelled) return
        setCollections(store.config.collections)
        setAuthProfiles(store.config.authProfiles)
        setEnvironments(store.context.environments)
        setActiveEnvironmentId(store.context.activeEnvironmentId)
        setHistory(store.state.history)
        setLoaded(true)
      })
      .catch((err) => {
        if (cancelled) return
        console.error('Failed to load store', err)
        setLoaded(true)
      })
    return (): void => {
      cancelled = true
    }
  }, [])

  // Debounced persist on change. We persist config + context only —
  // history is owned by main and flows through the history:append IPC,
  // so excluding it here prevents our writes from clobbering an append
  // that arrived between reads. The `state` slice is still included so
  // the store file stays shape-correct; the history field on disk is
  // updated by main's appendHistoryEntry path.
  useEffect(() => {
    if (!loaded) return
    if (persistTimer.current) window.clearTimeout(persistTimer.current)
    persistTimer.current = window.setTimeout(async () => {
      try {
        // Read the current on-disk history so we don't stomp entries MCP
        // wrote between our last render and this persist.
        const freshHistory = await window.api.readHistory()
        const store: Store = {
          config: { collections, authProfiles },
          context: { environments, activeEnvironmentId },
          state: { history: freshHistory }
        }
        await window.api.writeStore(store)
      } catch (err) {
        console.error('Failed to save', err)
        toast.error('Failed to save changes')
      }
    }, 250)
    return (): void => {
      if (persistTimer.current) window.clearTimeout(persistTimer.current)
    }
  }, [collections, authProfiles, environments, activeEnvironmentId, loaded])

  // Subscribe to the live history broadcast. Any entry written by main
  // (ours via appendHistory, MCP's via the fs watcher) gets pushed here
  // and merged into the local feed. De-duplicated by id so repeated
  // broadcasts are harmless.
  useEffect(() => {
    const unsubscribe = window.api.onHistoryAppended((entries) => {
      setHistory((prev) => {
        const seen = new Set(prev.map((h) => h.id))
        const fresh = entries.filter((e) => !seen.has(e.id))
        if (fresh.length === 0) return prev
        // The most recent broadcast wins the "newest" marker for the
        // LiveFeed animation.
        setNewestHistoryId(fresh[0].id)
        return [...fresh, ...prev].slice(0, HISTORY_MAX)
      })
    })
    return unsubscribe
  }, [])

  const activeRequest = useMemo<RequestItem | null>(() => {
    if (!activeRequestId) return null
    for (const c of collections) {
      for (const r of walkRequestsTree(c.children)) {
        if (r.id === activeRequestId) return r
      }
    }
    return null
  }, [collections, activeRequestId])

  const updateRequest = useCallback(
    (collectionId: string, requestId: string, patch: Partial<RequestItem>) => {
      setCollections((prev) =>
        prev.map((c) =>
          c.id !== collectionId
            ? c
            : {
                ...c,
                children: mapRequestsTree(c.children, (r) =>
                  r.id === requestId ? { ...r, ...patch } : r
                )
              }
        )
      )
    },
    []
  )

  const handleNewCollection = useCallback(() => {
    const c = newCollection()
    setCollections((prev) => [...prev, c])
  }, [])

  const handleNewRequest = useCallback(
    (collectionId: string, parentFolderId?: string) => {
      const r = newRequest()
      const node: RequestNode = { kind: 'request', request: r }
      setCollections((prev) =>
        prev.map((c) => {
          if (c.id !== collectionId) return c
          if (!parentFolderId) return { ...c, children: [...c.children, node] }
          return { ...c, children: appendToFolder(c.children, parentFolderId, node) }
        })
      )
      setActiveCollectionId(collectionId)
      setActiveRequestId(r.id)
      setResponse(null)
    },
    []
  )

  const handleNewFolder = useCallback(
    (collectionId: string, parentFolderId?: string) => {
      const folder: FolderNode = {
        kind: 'folder',
        id: `${Date.now().toString(36)}-fld`,
        name: 'New folder',
        children: []
      }
      setCollections((prev) =>
        prev.map((c) => {
          if (c.id !== collectionId) return c
          if (!parentFolderId) return { ...c, children: [...c.children, folder] }
          return { ...c, children: appendToFolder(c.children, parentFolderId, folder) }
        })
      )
    },
    []
  )

  const handleRenameFolder = useCallback(
    (collectionId: string, folderId: string, name: string) => {
      setCollections((prev) =>
        prev.map((c) =>
          c.id !== collectionId
            ? c
            : { ...c, children: renameFolderInTree(c.children, folderId, name) }
        )
      )
    },
    []
  )

  const handleDeleteFolder = useCallback(
    (collectionId: string, folderId: string) => {
      setCollections((prev) =>
        prev.map((c) =>
          c.id !== collectionId
            ? c
            : { ...c, children: removeFolderFromTree(c.children, folderId) }
        )
      )
    },
    []
  )

  const handleSelectRequest = useCallback((collectionId: string, requestId: string) => {
    setActiveCollectionId(collectionId)
    setActiveRequestId(requestId)
    setResponse(null)
  }, [])

  const handleRenameCollection = useCallback((collectionId: string, name: string) => {
    setCollections((prev) => prev.map((c) => (c.id === collectionId ? { ...c, name } : c)))
  }, [])

  const handleRenameRequest = useCallback(
    (collectionId: string, requestId: string, name: string) => {
      updateRequest(collectionId, requestId, { name })
    },
    [updateRequest]
  )

  const handleDeleteCollection = useCallback(
    (collectionId: string) => {
      setCollections((prev) => prev.filter((c) => c.id !== collectionId))
      if (activeCollectionId === collectionId) {
        setActiveCollectionId(null)
        setActiveRequestId(null)
        setResponse(null)
      }
    },
    [activeCollectionId]
  )

  const handleDeleteRequest = useCallback(
    (collectionId: string, requestId: string) => {
      setCollections((prev) =>
        prev.map((c) =>
          c.id !== collectionId
            ? c
            : { ...c, children: filterRequestsTree(c.children, (r) => r.id !== requestId) }
        )
      )
      if (activeRequestId === requestId) {
        setActiveRequestId(null)
        setResponse(null)
      }
    },
    [activeRequestId]
  )

  const handleImportOpenApi = useCallback(() => setImportOpen(true), [])

  const handleOpenApiImported = useCallback(
    (collection: Collection, operationCount: number) => {
      setCollections((prev) => [...prev, collection])
      toast.success(
        `Imported "${collection.name}" — ${operationCount} ${
          operationCount === 1 ? 'request' : 'requests'
        }`
      )
    },
    []
  )

  const handleSyncOpenApi = useCallback(
    async (collectionId: string) => {
      const target = collections.find((c) => c.id === collectionId)
      if (!target?.openapi) return
      const link = target.openapi
      if (link.sourceType !== 'url' && link.sourceType !== 'file') {
        toast.error("Can't re-sync a pasted spec — re-import via URL or File")
        return
      }
      setSyncingCollectionId(collectionId)
      try {
        const result =
          link.sourceType === 'url' && link.sourceLocation
            ? await window.api.loadSpecFromUrl(link.sourceLocation)
            : await window.api.loadSpecFromFile()
        if (!result.ok || !result.text) {
          toast.error(result.error ?? 'Failed to load spec')
          return
        }
        const sync = await resyncCollection(target, result.text)
        setCollections((prev) => prev.map((c) => (c.id === collectionId ? sync.collection : c)))
        // Succinct summary of what actually moved.
        const parts = [
          sync.added && `${sync.added} added`,
          sync.updated && `${sync.updated} updated`,
          sync.removed && `${sync.removed} orphaned`,
          sync.conflicts && `${sync.conflicts} kept local`
        ].filter(Boolean) as string[]
        if (parts.length === 0) {
          toast.success('Spec is up to date')
        } else {
          toast.success(`Synced: ${parts.join(', ')}`)
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      } finally {
        setSyncingCollectionId(null)
      }
    },
    [collections]
  )

  // Export a single collection as a shareable JSON bundle. The bundle is
  // strictly config-layer data: the collection, any auth profiles it
  // references (profile definitions only — never resolved secret values),
  // and any history entries scoped to the collection's request ids. The
  // receiver's context (environments, secrets) has to be provided on
  // their side.
  const handleExportCollection = useCallback(
    async (collectionId: string) => {
      const collection = collections.find((c) => c.id === collectionId)
      if (!collection) return
      const requestIds = new Set<string>()
      const referencedProfileIds = new Set<string>()
      if (collection.authProfileId) referencedProfileIds.add(collection.authProfileId)
      for (const r of walkRequestsTree(collection.children)) {
        requestIds.add(r.id)
        if (r.authProfileId) referencedProfileIds.add(r.authProfileId)
      }
      const scopedHistory = history.filter((h) => h.requestId && requestIds.has(h.requestId))
      const scopedProfiles = authProfiles.filter((p) => referencedProfileIds.has(p.id))
      const result = await window.api.exportCollection({
        collectionId,
        defaultName: collection.name,
        collection,
        authProfiles: scopedProfiles,
        history: scopedHistory
      })
      if (result.ok && result.path) {
        toast.success(`Exported to ${result.path.split('/').pop()}`)
      } else if (result.error && result.error !== 'cancelled') {
        toast.error(result.error)
      }
    },
    [collections, authProfiles, history]
  )

  // Pull in a bundle someone else exported. Incoming collection gets a
  // fresh id; any auth profiles referenced by the collection are merged
  // into our config (matching by id so a second import of the same bundle
  // is idempotent). History entries piggyback but request ids stay intact
  // so they still link back.
  const handleImportCollectionFromFile = useCallback(async () => {
    const result = await window.api.importCollection()
    if (!result.ok || !result.bundle) {
      if (result.error && result.error !== 'cancelled') toast.error(result.error)
      return
    }
    const { collection, history: incomingHistory, authProfiles: incomingProfiles } = result.bundle
    const rehomed: Collection = { ...collection, id: `${Date.now().toString(36)}-imp` }
    setCollections((prev) => [...prev, rehomed])
    if (incomingProfiles?.length) {
      setAuthProfiles((prev) => {
        const existing = new Set(prev.map((p) => p.id))
        return [...prev, ...incomingProfiles.filter((p) => !existing.has(p.id))]
      })
    }
    if (incomingHistory?.length) {
      setHistory((prev) => [...incomingHistory, ...prev].slice(0, HISTORY_MAX))
    }
    const importedCount = [...walkRequestsTree(rehomed.children)].length
    toast.success(
      `Imported "${rehomed.name}" — ${importedCount} request${importedCount === 1 ? '' : 's'}${
        incomingHistory?.length ? `, ${incomingHistory.length} history entries` : ''
      }`
    )
  }, [])

  const handleUnlinkOpenApi = useCallback((collectionId: string) => {
    setCollections((prev) =>
      prev.map((c) => {
        if (c.id !== collectionId) return c
        // Drop the spec link from the collection and from each request. The
        // requests themselves stay — users keep all their work.
        return {
          ...c,
          openapi: undefined,
          children: mapRequestsTree(c.children, (r) => ({ ...r, spec: undefined }))
        }
      })
    )
    toast.success('Unlinked from spec')
  }, [])

  const handleSend = useCallback(async () => {
    if (!activeRequest || !activeCollectionId) return
    setSending(true)
    setResponse(null)
    try {
      const res = await window.api.sendRequest({
        method: activeRequest.method,
        url: activeRequest.url,
        headers: activeRequest.headers,
        body: activeRequest.body
      })
      setResponse(res)
      // Append via main. Main broadcasts to every window (including us)
      // and the onHistoryAppended subscription folds it into local state.
      const entry = recordHistoryEntry(activeRequest, res)
      window.api.appendHistory(entry).catch((err) => {
        console.error('failed to append history', err)
      })
      if (res.error) {
        toast.error(res.error)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.error(message)
    } finally {
      setSending(false)
    }
  }, [activeRequest, activeCollectionId])

  // Replay a past send: reconstruct the SendRequestResult shape from the
  // history snapshot and push it into the response viewer. Doesn't re-send.
  const handleReplayHistory = useCallback((entry: HistoryEntry) => {
    const result: SendRequestResult = {
      ok: entry.response.ok,
      status: entry.response.status,
      statusText: entry.response.statusText,
      headers: {},
      body: entry.response.bodyPreview + (entry.response.bodyTruncated ? '\n\n… (truncated in history)' : ''),
      durationMs: entry.response.durationMs,
      size: entry.response.size,
      error: entry.response.error
    }
    setResponse(result)
    setHistoryOpen(false)
    // Selecting from the feed drops us back into the editor view — the
    // response we just hydrated is what we want to show.
    setLiveMode(false)
    // If the original request is still around, select it so the editor
    // matches the response the user is looking at.
    if (entry.requestId) {
      const reqId = entry.requestId
      for (const c of collections) {
        if (treeContainsRequest(c.children, reqId)) {
          setActiveCollectionId(c.id)
          setActiveRequestId(reqId)
          break
        }
      }
    }
  }, [collections])

  const handleClearHistory = useCallback(() => {
    setHistory([])
    toast.success('History cleared')
  }, [])

  // One hook at the App level wires every global shortcut. Handlers live
  // here so they can close over the in-app state. The ones that need an
  // active request (send, focus URL) early-return if nothing's selected.
  useShortcuts({
    'send-request': () => {
      if (activeRequest) handleSend()
    },
    'new-request': () => {
      const collectionId = activeCollectionId ?? collections[0]?.id
      if (collectionId) handleNewRequest(collectionId)
    },
    'new-collection': () => {
      handleNewCollection()
    },
    'import-openapi': () => {
      handleImportOpenApi()
    },
    'focus-url': () => {
      requestEditorRef.current?.focusUrl()
    },
    'open-history': () => {
      setHistoryOpen(true)
    },
    'focus-sidebar-search': () => {
      // The sidebar filter input doesn't exist yet — land it with folders.
      // Leaving the handler registered is harmless; it's a no-op until then.
    },
    'open-ai-handoff': () => {
      // The handoff dialog is owned by McpHandoffButton in the sidebar
      // footer. We'll expose a programmatic open in a follow-up round;
      // for now, a no-op keeps the registry happy.
    }
  })

  return (
    <TooltipProvider delayDuration={250}>
      <div className="h-screen w-screen overflow-hidden bg-background text-foreground">
        <ResizablePanelGroup orientation="horizontal" className="h-full">
          <ResizablePanel defaultSize="22%" minSize="16%" maxSize="40%">
            <Sidebar
              collections={collections}
              activeRequestId={activeRequestId}
              onSelectRequest={handleSelectRequest}
              onNewCollection={handleNewCollection}
              onNewRequest={handleNewRequest}
              onRenameCollection={handleRenameCollection}
              onRenameRequest={handleRenameRequest}
              onDeleteCollection={handleDeleteCollection}
              onDeleteRequest={handleDeleteRequest}
              onImportOpenApi={handleImportOpenApi}
              onSyncOpenApi={handleSyncOpenApi}
              onUnlinkOpenApi={handleUnlinkOpenApi}
              onExportCollection={handleExportCollection}
              onImportCollection={handleImportCollectionFromFile}
              onNewFolder={handleNewFolder}
              onRenameFolder={handleRenameFolder}
              onDeleteFolder={handleDeleteFolder}
              syncingCollectionId={syncingCollectionId}
              onOpenHistory={() => setHistoryOpen(true)}
              historyCount={history.length}
              onOpenAuthProfiles={() => setAuthProfilesOpen(true)}
              authProfileCount={authProfiles.length}
            />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize="78%" minSize="50%">
            <div className="flex h-full flex-col">
              <div
                className="relative h-[52px] shrink-0 border-b border-border"
                style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
              >
                <div
                  className="absolute top-1/2 right-4 flex -translate-y-1/2 items-center gap-1"
                  style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                >
                  <Button
                    variant={liveMode ? 'default' : 'ghost'}
                    size="sm"
                    className={cn(
                      'h-7 gap-1.5 px-2.5 text-[11px] font-medium',
                      liveMode && 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/20'
                    )}
                    onClick={() => setLiveMode((v) => !v)}
                  >
                    {liveMode && (
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      </span>
                    )}
                    {!liveMode && <Radio className="h-3 w-3" />}
                    Live
                  </Button>
                </div>
              </div>
              {liveMode ? (
                <LiveFeed
                  entries={history}
                  newestId={newestHistoryId}
                  onSelect={handleReplayHistory}
                />
              ) : activeRequest && activeCollectionId ? (
                <ResizablePanelGroup orientation="vertical" className="flex-1">
                  <ResizablePanel defaultSize="45%" minSize="20%">
                    <div className="h-full overflow-auto">
                      <RequestEditor
                        ref={requestEditorRef}
                        request={activeRequest}
                        sending={sending}
                        onChange={(r) =>
                          updateRequest(activeCollectionId, activeRequest.id, r)
                        }
                        onSend={handleSend}
                        authProfiles={authProfiles}
                        inheritedAuthProfileId={
                          collections.find((c) => c.id === activeCollectionId)?.authProfileId
                        }
                        onManageAuthProfiles={() => setAuthProfilesOpen(true)}
                      />
                    </div>
                  </ResizablePanel>
                  <ResizableHandle />
                  <ResizablePanel defaultSize="55%" minSize="20%">
                    <div className="flex h-full flex-col">
                      <ResponseViewer result={response} sending={sending} />
                    </div>
                  </ResizablePanel>
                </ResizablePanelGroup>
              ) : (
                <Welcome
                  onNewCollection={handleNewCollection}
                  onImportOpenApi={handleImportOpenApi}
                />
              )}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
        <OpenApiImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          onImported={handleOpenApiImported}
        />
        <HistoryDialog
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          entries={history}
          onReplay={handleReplayHistory}
          onClear={handleClearHistory}
        />
        <AuthProfilesDialog
          open={authProfilesOpen}
          onOpenChange={setAuthProfilesOpen}
          profiles={authProfiles}
          onChange={setAuthProfiles}
        />
        <Toaster theme="dark" />
      </div>
    </TooltipProvider>
  )
}

function Welcome({
  onNewCollection,
  onImportOpenApi
}: {
  onNewCollection: () => void
  onImportOpenApi: () => void
}): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
      <h1 className="bg-gradient-to-br from-foreground to-primary bg-clip-text text-4xl font-bold tracking-tight text-transparent">
        pls
      </h1>
      <p className="text-sm">A tiny, beautiful API client</p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={onNewCollection}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-xs hover:border-primary hover:text-foreground"
        >
          Create a collection
        </button>
        <button
          type="button"
          onClick={onImportOpenApi}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-xs hover:border-primary hover:text-foreground"
        >
          Import OpenAPI spec
        </button>
      </div>
    </div>
  )
}

export default App
