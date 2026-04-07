// Manager for auth profiles. Create, edit, delete — profiles are pure
// config, so every mutation just calls `onChange` with the new array and
// App.tsx persists it through the regular debounced writeStore path.
//
// The profile editor holds a SecretRef (a string like "env:GITHUB_PAT")
// rather than a raw value. Plain text fields are fine for v1 because
// secret values never live in config — they live in whatever backend
// the SecretsAdapter resolves to (env-vars today, keychain later).

import { useMemo, useState } from 'react'
import { KeyRound, Plus, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { AuthProfile } from '../../../preload/index'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  profiles: AuthProfile[]
  onChange: (next: AuthProfile[]) => void
}

const newProfile = (): AuthProfile => ({
  id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
  name: 'New profile',
  type: 'bearer',
  config: { type: 'bearer', tokenRef: 'env:' }
})

export function AuthProfilesDialog({
  open,
  onOpenChange,
  profiles,
  onChange
}: Props): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = useMemo(() => profiles.find((p) => p.id === selectedId) ?? null, [
    profiles,
    selectedId
  ])

  const addProfile = (): void => {
    const p = newProfile()
    onChange([...profiles, p])
    setSelectedId(p.id)
  }

  const updateProfile = (next: AuthProfile): void => {
    onChange(profiles.map((p) => (p.id === next.id ? next : p)))
  }

  const deleteProfile = (id: string): void => {
    onChange(profiles.filter((p) => p.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" />
            Auth profiles
          </DialogTitle>
          <DialogDescription className="text-xs">
            Reusable auth credentials referenced by collections and requests. Values live in your
            shell env (or a future secrets backend) — the profile only stores the reference, so
            sharing a collection never leaks a token.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[220px_1fr] gap-3">
          {/* Profile list */}
          <div className="flex flex-col gap-1 border-r border-border pr-3">
            {profiles.length === 0 && (
              <div className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-[11px] text-muted-foreground">
                No profiles yet
              </div>
            )}
            {profiles.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedId(p.id)}
                className={cn(
                  'group flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition',
                  p.id === selectedId
                    ? 'bg-sidebar-accent text-foreground'
                    : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground'
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{p.name || 'Untitled'}</div>
                  <div className="truncate text-[10px] text-muted-foreground">{p.type}</div>
                </div>
              </button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              onClick={addProfile}
              className="mt-1 h-7 justify-start gap-1.5 text-[11px] text-muted-foreground"
            >
              <Plus className="h-3 w-3" />
              New profile
            </Button>
          </div>

          {/* Editor */}
          <div>
            {selected ? (
              <ProfileEditor
                profile={selected}
                onChange={updateProfile}
                onDelete={() => deleteProfile(selected.id)}
              />
            ) : (
              <div className="flex h-full items-center justify-center py-16 text-[11px] text-muted-foreground">
                {profiles.length === 0 ? 'Create a profile to get started' : 'Select a profile'}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ProfileEditor({
  profile,
  onChange,
  onDelete
}: {
  profile: AuthProfile
  onChange: (next: AuthProfile) => void
  onDelete: () => void
}): React.JSX.Element {
  const patch = (fields: Partial<AuthProfile>): void => onChange({ ...profile, ...fields })

  const changeType = (type: AuthProfile['type']): void => {
    // When changing type we also have to swap the config shape.
    let config: AuthProfile['config']
    switch (type) {
      case 'none':
        config = { type: 'none' }
        break
      case 'bearer':
        config = { type: 'bearer', tokenRef: 'env:' }
        break
      case 'basic':
        config = { type: 'basic', usernameRef: 'env:', passwordRef: 'env:' }
        break
      case 'api-key':
        config = { type: 'api-key', in: 'header', name: 'X-API-Key', valueRef: 'env:' }
        break
    }
    onChange({ ...profile, type, config })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <Label className="text-[10px] tracking-wider text-muted-foreground uppercase">
            Name
          </Label>
          <Input
            value={profile.name}
            onChange={(e) => patch({ name: e.target.value })}
            className="mt-1 h-8 text-sm"
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-rose-400"
          onClick={onDelete}
          title="Delete profile"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div>
        <Label className="text-[10px] tracking-wider text-muted-foreground uppercase">
          Type
        </Label>
        <Select value={profile.type} onValueChange={(v) => changeType(v as AuthProfile['type'])}>
          <SelectTrigger className="mt-1 h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            <SelectItem value="bearer">Bearer token</SelectItem>
            <SelectItem value="basic">Basic auth</SelectItem>
            <SelectItem value="api-key">API key</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {profile.config.type === 'bearer' && (
        <RefField
          label="Token ref"
          hint="e.g. env:GITHUB_PAT"
          value={profile.config.tokenRef}
          onChange={(v) => patch({ config: { type: 'bearer', tokenRef: v } })}
        />
      )}

      {profile.config.type === 'basic' && (
        <>
          <RefField
            label="Username ref"
            hint="e.g. env:API_USER"
            value={profile.config.usernameRef}
            onChange={(v) =>
              profile.config.type === 'basic' &&
              patch({
                config: { ...profile.config, usernameRef: v }
              })
            }
          />
          <RefField
            label="Password ref"
            hint="e.g. env:API_PASS"
            value={profile.config.passwordRef}
            onChange={(v) =>
              profile.config.type === 'basic' &&
              patch({
                config: { ...profile.config, passwordRef: v }
              })
            }
          />
        </>
      )}

      {profile.config.type === 'api-key' && (
        <>
          <div>
            <Label className="text-[10px] tracking-wider text-muted-foreground uppercase">
              Send in
            </Label>
            <Select
              value={profile.config.in}
              onValueChange={(v) =>
                profile.config.type === 'api-key' &&
                patch({ config: { ...profile.config, in: v as 'header' | 'query' } })
              }
            >
              <SelectTrigger className="mt-1 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="header">Header</SelectItem>
                <SelectItem value="query">Query parameter</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] tracking-wider text-muted-foreground uppercase">
              {profile.config.in === 'header' ? 'Header name' : 'Query param name'}
            </Label>
            <Input
              value={profile.config.name}
              onChange={(e) =>
                profile.config.type === 'api-key' &&
                patch({ config: { ...profile.config, name: e.target.value } })
              }
              className="mt-1 h-8 font-mono text-xs"
            />
          </div>
          <RefField
            label="Value ref"
            hint="e.g. env:OPENAI_API_KEY"
            value={profile.config.valueRef}
            onChange={(v) =>
              profile.config.type === 'api-key' &&
              patch({ config: { ...profile.config, valueRef: v } })
            }
          />
        </>
      )}

      {profile.config.type === 'none' && (
        <div className="rounded-md border border-dashed border-border/60 p-3 text-[11px] text-muted-foreground">
          No credentials — pls won't attach any auth when using this profile.
        </div>
      )}
    </div>
  )
}

function RefField({
  label,
  hint,
  value,
  onChange
}: {
  label: string
  hint: string
  value: string
  onChange: (v: string) => void
}): React.JSX.Element {
  return (
    <div>
      <Label className="text-[10px] tracking-wider text-muted-foreground uppercase">{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={hint}
        className="mt-1 h-8 font-mono text-xs"
      />
      <div className="mt-1 text-[10px] text-muted-foreground">
        References a secret via <code>env:NAME</code> (shell env var) or any prefix your
        SecretsAdapter knows about. The raw value is never stored in the profile.
      </div>
    </div>
  )
}
