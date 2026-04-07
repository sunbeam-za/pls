import { useCallback, useState } from 'react'
import { FileUp, Link2, FileText } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { collectionFromSpec, OpenApiParseError } from '@/lib/openapi'
import type { Collection } from '@/lib/storage'
import type { OpenApiSourceType } from '../../../preload/index'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with a fully-built collection when import succeeds. */
  onImported: (collection: Collection, operationCount: number) => void
}

type Tab = 'url' | 'file' | 'text'

export function OpenApiImportDialog({ open, onOpenChange, onImported }: Props): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('url')
  const [url, setUrl] = useState('')
  const [pastedText, setPastedText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = useCallback(() => {
    setUrl('')
    setPastedText('')
    setError(null)
    setBusy(false)
    setTab('url')
  }, [])

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) reset()
      onOpenChange(next)
    },
    [onOpenChange, reset]
  )

  const runImport = useCallback(
    async (text: string, sourceType: OpenApiSourceType, sourceLocation: string | undefined) => {
      setBusy(true)
      setError(null)
      try {
        const { collection, operationCount } = await collectionFromSpec(
          text,
          sourceType,
          sourceLocation
        )
        if (operationCount === 0) {
          setError('No operations found in spec')
          return
        }
        onImported(collection, operationCount)
        handleOpenChange(false)
      } catch (err) {
        const message =
          err instanceof OpenApiParseError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err)
        setError(message)
      } finally {
        setBusy(false)
      }
    },
    [onImported, handleOpenChange]
  )

  const handleUrlImport = useCallback(async () => {
    if (!url.trim()) {
      setError('Enter a URL')
      return
    }
    setBusy(true)
    setError(null)
    const result = await window.api.loadSpecFromUrl(url.trim())
    if (!result.ok || !result.text) {
      setError(result.error ?? 'Failed to fetch spec')
      setBusy(false)
      return
    }
    await runImport(result.text, 'url', result.sourceLocation ?? url.trim())
  }, [url, runImport])

  const handleFileImport = useCallback(async () => {
    setBusy(true)
    setError(null)
    const result = await window.api.loadSpecFromFile()
    if (!result.ok || !result.text) {
      if (result.error && result.error !== 'cancelled') setError(result.error)
      setBusy(false)
      return
    }
    await runImport(result.text, 'file', result.sourceLocation)
  }, [runImport])

  const handleTextImport = useCallback(async () => {
    if (!pastedText.trim()) {
      setError('Paste a spec')
      return
    }
    await runImport(pastedText, 'text', undefined)
  }, [pastedText, runImport])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import from OpenAPI</DialogTitle>
          <DialogDescription>
            Create a collection from an OpenAPI 3.x or Swagger 2.0 document (JSON or YAML).
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="url">
              <Link2 className="mr-1 h-3.5 w-3.5" />
              URL
            </TabsTrigger>
            <TabsTrigger value="file">
              <FileUp className="mr-1 h-3.5 w-3.5" />
              File
            </TabsTrigger>
            <TabsTrigger value="text">
              <FileText className="mr-1 h-3.5 w-3.5" />
              Paste
            </TabsTrigger>
          </TabsList>

          <TabsContent value="url" className="mt-3 space-y-2">
            <Input
              placeholder="https://api.example.com/openapi.json"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !busy) handleUrlImport()
              }}
              disabled={busy}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              The URL is remembered so you can re-sync later.
            </p>
          </TabsContent>

          <TabsContent value="file" className="mt-3 space-y-2">
            <Button
              variant="outline"
              onClick={handleFileImport}
              disabled={busy}
              className="w-full"
            >
              <FileUp className="mr-1 h-3.5 w-3.5" />
              Choose file…
            </Button>
            <p className="text-xs text-muted-foreground">
              The file path is remembered so you can re-sync later.
            </p>
          </TabsContent>

          <TabsContent value="text" className="mt-3 space-y-2">
            <textarea
              placeholder="Paste your OpenAPI spec here"
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              disabled={busy}
              className="h-48 w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <p className="text-xs text-muted-foreground">
              Pasted specs can't be re-synced — use URL or File for that.
            </p>
          </TabsContent>
        </Tabs>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        <DialogFooter showCloseButton>
          {tab === 'url' && (
            <Button onClick={handleUrlImport} disabled={busy || !url.trim()}>
              {busy ? 'Importing…' : 'Import'}
            </Button>
          )}
          {tab === 'text' && (
            <Button onClick={handleTextImport} disabled={busy || !pastedText.trim()}>
              {busy ? 'Importing…' : 'Import'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
