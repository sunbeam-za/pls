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
import { RequestEditor } from '@/components/RequestEditor'
import { ResponseViewer } from '@/components/ResponseViewer'
import { OpenApiImportDialog } from '@/components/OpenApiImportDialog'
import { HistoryDialog } from '@/components/HistoryDialog'
import {
  newCollection,
  newRequest,
  type Collection,
  type RequestItem,
  type Store
} from '@/lib/storage'
import { resyncCollection } from '@/lib/openapi'
import type { HistoryEntry, SendRequestResult } from '../../preload/index'

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
  const [collections, setCollections] = useState<Collection[]>([])
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null)
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null)
  const [response, setResponse] = useState<SendRequestResult | null>(null)
  const [sending, setSending] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [syncingCollectionId, setSyncingCollectionId] = useState<string | null>(null)
  const persistTimer = useRef<number | null>(null)

  // Load on mount. Guard against StrictMode double-mount: a stale resolve
  // from the first effect could otherwise stomp state set after the user
  // started interacting (which made "Create collection" appear no-op).
  useEffect(() => {
    let cancelled = false
    window.api
      .readStore()
      .then((store) => {
        if (cancelled) return
        setCollections(store.collections ?? [])
        setHistory(store.history ?? [])
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

  // Debounced persist on change
  useEffect(() => {
    if (!loaded) return
    if (persistTimer.current) window.clearTimeout(persistTimer.current)
    persistTimer.current = window.setTimeout(() => {
      const store: Store = { collections, history }
      window.api.writeStore(store).catch((err) => {
        console.error('Failed to save', err)
        toast.error('Failed to save changes')
      })
    }, 250)
    return (): void => {
      if (persistTimer.current) window.clearTimeout(persistTimer.current)
    }
  }, [collections, history, loaded])

  const activeRequest = useMemo<RequestItem | null>(() => {
    if (!activeRequestId) return null
    for (const c of collections) {
      const r = c.requests.find((x) => x.id === activeRequestId)
      if (r) return r
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
                requests: c.requests.map((r) => (r.id === requestId ? { ...r, ...patch } : r))
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

  const handleNewRequest = useCallback((collectionId: string) => {
    const r = newRequest()
    setCollections((prev) =>
      prev.map((c) => (c.id === collectionId ? { ...c, requests: [...c.requests, r] } : c))
    )
    setActiveCollectionId(collectionId)
    setActiveRequestId(r.id)
    setResponse(null)
  }, [])

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
            : { ...c, requests: c.requests.filter((r) => r.id !== requestId) }
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

  const handleUnlinkOpenApi = useCallback((collectionId: string) => {
    setCollections((prev) =>
      prev.map((c) => {
        if (c.id !== collectionId) return c
        // Drop the spec link from the collection and from each request. The
        // requests themselves stay — users keep all their work.
        return {
          ...c,
          openapi: undefined,
          requests: c.requests.map((r) => ({ ...r, spec: undefined }))
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
      // Snapshot it into history — keep the newest HISTORY_MAX entries only.
      const entry = recordHistoryEntry(activeRequest, res)
      setHistory((prev) => [entry, ...prev].slice(0, HISTORY_MAX))
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
    // If the original request is still around, select it so the editor
    // matches the response the user is looking at.
    if (entry.requestId) {
      for (const c of collections) {
        if (c.requests.some((r) => r.id === entry.requestId)) {
          setActiveCollectionId(c.id)
          setActiveRequestId(entry.requestId)
          break
        }
      }
    }
  }, [collections])

  const handleClearHistory = useCallback(() => {
    setHistory([])
    toast.success('History cleared')
  }, [])

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
              syncingCollectionId={syncingCollectionId}
              onOpenHistory={() => setHistoryOpen(true)}
              historyCount={history.length}
            />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize="78%" minSize="50%">
            <div className="flex h-full flex-col">
              <div
                className="h-[52px] shrink-0 border-b border-border"
                style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
              />
              {activeRequest && activeCollectionId ? (
                <ResizablePanelGroup orientation="vertical" className="flex-1">
                  <ResizablePanel defaultSize="45%" minSize="20%">
                    <div className="h-full overflow-auto">
                      <RequestEditor
                        request={activeRequest}
                        sending={sending}
                        onChange={(r) =>
                          updateRequest(activeCollectionId, activeRequest.id, r)
                        }
                        onSend={handleSend}
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
