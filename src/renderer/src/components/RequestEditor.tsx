import { forwardRef, useImperativeHandle, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SHORTCUTS } from '@/lib/shortcuts'
import { cn } from '@/lib/utils'
import type { AuthProfile, HttpMethod, RequestItem } from '../../../preload/index'
import { HeadersEditor } from './HeadersEditor'
import { CodeEditor } from './CodeEditor'

/** Imperative handle exposed so the global `focus-url` shortcut can jump
 * straight into the URL bar without threading refs through half the app. */
export interface RequestEditorHandle {
  focusUrl: () => void
}

const methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

const methodColor: Record<HttpMethod, string> = {
  GET: 'text-emerald-400',
  POST: 'text-amber-400',
  PUT: 'text-sky-400',
  PATCH: 'text-violet-400',
  DELETE: 'text-rose-400',
  HEAD: 'text-zinc-400',
  OPTIONS: 'text-zinc-400'
}

interface RequestEditorProps {
  request: RequestItem
  sending: boolean
  onChange: (request: RequestItem) => void
  onSend: () => void
  authProfiles: AuthProfile[]
  /** The effective profile id inherited from the enclosing collection/folder, if any. */
  inheritedAuthProfileId?: string
  onManageAuthProfiles: () => void
}

export const RequestEditor = forwardRef<RequestEditorHandle, RequestEditorProps>(
  function RequestEditor(
    { request, sending, onChange, onSend, authProfiles, inheritedAuthProfileId, onManageAuthProfiles },
    ref
  ): React.JSX.Element {
  const enabledHeaderCount = request.headers.filter((h) => h.enabled && h.key.trim()).length
  const bodyShown = !['GET', 'HEAD'].includes(request.method)
  const urlRef = useRef<HTMLInputElement>(null)
  const hasCustomAuth = request.authProfileId !== undefined

  useImperativeHandle(
    ref,
    () => ({
      focusUrl: (): void => {
        urlRef.current?.focus()
        urlRef.current?.select()
      }
    }),
    []
  )

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-border px-5 py-3">
        <Select
          value={request.method}
          onValueChange={(v) => onChange({ ...request, method: v as HttpMethod })}
        >
          <SelectTrigger
            className={cn(
              'h-9 w-[110px] font-mono text-xs font-bold',
              methodColor[request.method]
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {methods.map((m) => (
              <SelectItem key={m} value={m} className={cn('font-mono font-bold', methodColor[m])}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          ref={urlRef}
          value={request.url}
          onChange={(e) => onChange({ ...request, url: e.target.value })}
          placeholder="https://api.example.com/endpoint"
          className="h-9 flex-1 font-mono text-xs"
        />
        <Button
          onClick={onSend}
          disabled={sending || !request.url}
          className="h-9 gap-2 px-4"
        >
          {sending ? (
            <>
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
              Sending
            </>
          ) : (
            <>
              Send
              <Kbd keys={SHORTCUTS['send-request'].keys} className="text-primary-foreground/80" />
            </>
          )}
        </Button>
      </div>

      <Tabs defaultValue={bodyShown ? 'body' : 'headers'}>
        <div className="border-b border-border px-5">
          <TabsList variant="line" className="h-10">
            <TabsTrigger value="headers">
              Headers
              {enabledHeaderCount > 0 && (
                <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {enabledHeaderCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="auth">
              Auth
              {(hasCustomAuth || inheritedAuthProfileId) && (
                <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
              )}
            </TabsTrigger>
            {bodyShown && (
              <TabsTrigger value="body">
                Body
                {request.body && (
                  <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
                )}
              </TabsTrigger>
            )}
          </TabsList>
        </div>

        <TabsContent value="headers" className="m-0 p-5">
          <HeadersEditor
            headers={request.headers}
            onChange={(headers) => onChange({ ...request, headers })}
          />
        </TabsContent>

        <TabsContent value="auth" className="m-0 p-5">
          <AuthPicker
            value={request.authProfileId}
            hasCustomValue={hasCustomAuth}
            inheritedId={inheritedAuthProfileId}
            profiles={authProfiles}
            onChange={(next) => onChange({ ...request, authProfileId: next })}
            onManage={onManageAuthProfiles}
          />
        </TabsContent>

        {bodyShown && (
          <TabsContent value="body" className="m-0 p-5">
            <CodeEditor
              value={request.body}
              onChange={(body) => onChange({ ...request, body })}
              placeholder='{"key": "value"}'
              minHeight="240px"
            />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
  }
)

// ---------- AuthPicker ----------
// Three states for a request's auth:
//   undefined  → inherit from the collection/folder ancestry
//   'none'     → explicitly override to no auth (wins over inheritance)
//   '<id>'     → explicitly use the named profile
//
// The Select exposes "Inherit" as a sentinel value because HTML selects
// can't bind to undefined. We map it back to undefined on the way out.

const INHERIT = '__inherit__'
const NONE = '__none__'

function AuthPicker({
  value,
  hasCustomValue,
  inheritedId,
  profiles,
  onChange,
  onManage
}: {
  value: string | undefined
  hasCustomValue: boolean
  inheritedId?: string
  profiles: AuthProfile[]
  onChange: (next: string | undefined) => void
  onManage: () => void
}): React.JSX.Element {
  // Distinguish "explicitly cleared" (value === 'none' sentinel → stored as
  // null in the store, but we don't model that — instead we treat undefined
  // as inherit and an id as override). v1 simplification: the picker only
  // supports Inherit / <profile>. An explicit "none" override isn't exposed
  // yet — not a blocker for the typical workflow.
  const selectValue = hasCustomValue ? (value ?? NONE) : INHERIT
  const inheritedProfile = inheritedId
    ? profiles.find((p) => p.id === inheritedId)
    : undefined

  return (
    <div className="max-w-md space-y-3">
      <div className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
        Auth profile
      </div>
      <Select
        value={selectValue}
        onValueChange={(v) => {
          if (v === INHERIT) onChange(undefined)
          else onChange(v)
        }}
      >
        <SelectTrigger className="h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={INHERIT}>
            {inheritedProfile
              ? `Inherit — ${inheritedProfile.name}`
              : 'Inherit (none set by parent)'}
          </SelectItem>
          {profiles.length > 0 && (
            <>
              {profiles.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                  <span className="ml-2 text-[10px] text-muted-foreground">{p.type}</span>
                </SelectItem>
              ))}
            </>
          )}
        </SelectContent>
      </Select>
      <button
        type="button"
        onClick={onManage}
        className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        Manage profiles…
      </button>
      <div className="rounded-md border border-dashed border-border/60 p-3 text-[10px] leading-relaxed text-muted-foreground">
        Profiles reference credentials by name — e.g. <code>env:GITHUB_PAT</code>. The actual
        token is read from your shell env at send time, never stored in the collection. Request
        auth wins over folder auth wins over collection auth.
      </div>
    </div>
  )
}
