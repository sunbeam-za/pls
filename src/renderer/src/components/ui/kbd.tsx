// shadcn doesn't ship a <Kbd> component officially, but the convention is a
// small, bordered, muted-background tag. One component used everywhere we
// want to expose a shortcut: buttons, tooltips, dialog rows, menu items.
//
// Pass an array of keys and they're rendered as individual chips separated
// by hair-thin gaps. Cmd/Ctrl and other modifiers get their native glyphs.

import * as React from 'react'
import { cn } from '@/lib/utils'

export type KbdKey =
  | 'mod' // ⌘ on mac, Ctrl elsewhere
  | 'shift'
  | 'alt'
  | 'ctrl'
  | 'enter'
  | 'escape'
  | 'tab'
  | 'backspace'
  | 'space'
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'slash'
  | (string & {}) // any literal character ("a", "/", "?", ...)

// Detect once per module load. Navigator.platform is deprecated but still
// present in every Chromium (and therefore Electron) build we target.
const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)

const GLYPHS: Record<string, string> = {
  mod: IS_MAC ? '⌘' : 'Ctrl',
  shift: '⇧',
  alt: IS_MAC ? '⌥' : 'Alt',
  ctrl: IS_MAC ? '⌃' : 'Ctrl',
  enter: '⏎',
  escape: 'Esc',
  tab: '⇥',
  backspace: '⌫',
  space: '␣',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  slash: '/'
}

export function formatKey(key: KbdKey): string {
  return GLYPHS[key] ?? key.toUpperCase()
}

export function Kbd({
  keys,
  className
}: {
  keys: KbdKey[]
  className?: string
}): React.JSX.Element {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)}>
      {keys.map((k, i) => (
        <kbd
          key={i}
          className="inline-flex h-4 min-w-4 items-center justify-center rounded border border-border/60 bg-muted/60 px-1 font-sans text-[10px] leading-none font-medium text-muted-foreground"
        >
          {formatKey(k)}
        </kbd>
      ))}
    </span>
  )
}
