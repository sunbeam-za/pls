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
import {
  newCollection,
  newRequest,
  type Collection,
  type RequestItem,
  type Store
} from '@/lib/storage'
import type { SendRequestResult } from '../../preload/index'

function App(): React.JSX.Element {
  const [collections, setCollections] = useState<Collection[]>([])
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null)
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null)
  const [response, setResponse] = useState<SendRequestResult | null>(null)
  const [sending, setSending] = useState(false)
  const [loaded, setLoaded] = useState(false)
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
      const store: Store = { collections }
      window.api.writeStore(store).catch((err) => {
        console.error('Failed to save', err)
        toast.error('Failed to save changes')
      })
    }, 250)
    return (): void => {
      if (persistTimer.current) window.clearTimeout(persistTimer.current)
    }
  }, [collections, loaded])

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

  return (
    <TooltipProvider delayDuration={250}>
      <div className="h-screen w-screen overflow-hidden bg-background text-foreground">
        <ResizablePanelGroup orientation="horizontal" className="h-full">
          <ResizablePanel defaultSize={22} minSize={16} maxSize={40}>
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
            />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize={80} minSize={50}>
            <div className="flex h-full flex-col">
              <div
                className="h-[52px] shrink-0 border-b border-border"
                style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
              />
              {activeRequest && activeCollectionId ? (
                <ResizablePanelGroup orientation="vertical" className="flex-1">
                  <ResizablePanel defaultSize={45} minSize={20}>
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
                  <ResizablePanel defaultSize={55} minSize={20}>
                    <div className="flex h-full flex-col">
                      <ResponseViewer result={response} sending={sending} />
                    </div>
                  </ResizablePanel>
                </ResizablePanelGroup>
              ) : (
                <Welcome onNewCollection={handleNewCollection} />
              )}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
        <Toaster theme="dark" />
      </div>
    </TooltipProvider>
  )
}

function Welcome({ onNewCollection }: { onNewCollection: () => void }): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
      <h1 className="bg-gradient-to-br from-foreground to-primary bg-clip-text text-4xl font-bold tracking-tight text-transparent">
        pls
      </h1>
      <p className="text-sm">A tiny, beautiful API client</p>
      <button
        type="button"
        onClick={onNewCollection}
        className="mt-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs hover:border-primary hover:text-foreground"
      >
        Create your first collection
      </button>
    </div>
  )
}

export default App
