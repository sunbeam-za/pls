// Single registry for every keyboard shortcut in the app. Each entry owns
// its display metadata (so the Kbd component can render a consistent hint
// anywhere) and its handler is wired at the App level via useShortcuts.
//
// Keeping this in one file means adding a new shortcut is a one-liner: add
// an entry here, consume it where the button lives, bind the handler once
// in App.tsx. No ad-hoc `window.addEventListener` code scattered around.

import type { KbdKey } from '@/components/ui/kbd'

export type ShortcutId =
  | 'send-request'
  | 'new-request'
  | 'new-collection'
  | 'import-openapi'
  | 'focus-url'
  | 'open-history'
  | 'open-ai-handoff'
  | 'focus-sidebar-search'

export interface ShortcutDef {
  id: ShortcutId
  keys: KbdKey[]
  description: string
}

// The order here is the order shortcuts show up in any "shortcut cheatsheet"
// we might add later (hinted at by `⌘?`). Group by functional area.
export const SHORTCUTS: Record<ShortcutId, ShortcutDef> = {
  'send-request': {
    id: 'send-request',
    keys: ['mod', 'enter'],
    description: 'Send request'
  },
  'new-request': {
    id: 'new-request',
    keys: ['mod', 'n'],
    description: 'New request'
  },
  'new-collection': {
    id: 'new-collection',
    keys: ['mod', 'shift', 'n'],
    description: 'New collection'
  },
  'import-openapi': {
    id: 'import-openapi',
    keys: ['mod', 'o'],
    description: 'Import OpenAPI spec'
  },
  'focus-url': {
    id: 'focus-url',
    keys: ['mod', 'l'],
    description: 'Focus URL bar'
  },
  'open-history': {
    id: 'open-history',
    keys: ['mod', 'shift', 'h'],
    description: 'Open history'
  },
  'open-ai-handoff': {
    id: 'open-ai-handoff',
    keys: ['mod', 'shift', 'a'],
    description: 'Connect your AI'
  },
  'focus-sidebar-search': {
    id: 'focus-sidebar-search',
    keys: ['mod', 'f'],
    description: 'Filter requests'
  }
}

// Used by useShortcuts to match a keyboard event against the registry.
// Matches on lowercased key name; handles both `mod` → meta on mac and ctrl
// elsewhere, and expects `shift`/`alt`/`ctrl` to be explicit when required.
export function matchEvent(
  event: KeyboardEvent,
  keys: KbdKey[]
): boolean {
  const need = new Set(keys)
  const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform)

  const wantMod = need.has('mod')
  const wantShift = need.has('shift')
  const wantAlt = need.has('alt')
  const wantCtrl = need.has('ctrl')

  // `mod` maps to meta on mac, ctrl elsewhere. We check the modifier state
  // *exactly* so `mod+n` doesn't accidentally fire on `mod+shift+n`.
  if (wantMod) {
    if (isMac ? !event.metaKey : !event.ctrlKey) return false
  } else {
    if (isMac ? event.metaKey : event.ctrlKey) return false
  }
  if (wantShift !== event.shiftKey) return false
  if (wantAlt !== event.altKey) return false
  if (wantCtrl && !event.ctrlKey) return false

  // The non-modifier key is whichever one isn't in the modifier set.
  const nonModifier = keys.find(
    (k) => k !== 'mod' && k !== 'shift' && k !== 'alt' && k !== 'ctrl'
  )
  if (!nonModifier) return true

  const expected = keyEventName(nonModifier)
  return event.key.toLowerCase() === expected
}

function keyEventName(k: KbdKey): string {
  switch (k) {
    case 'enter':
      return 'enter'
    case 'escape':
      return 'escape'
    case 'tab':
      return 'tab'
    case 'backspace':
      return 'backspace'
    case 'space':
      return ' '
    case 'up':
      return 'arrowup'
    case 'down':
      return 'arrowdown'
    case 'left':
      return 'arrowleft'
    case 'right':
      return 'arrowright'
    case 'slash':
      return '/'
    default:
      return k.toLowerCase()
  }
}
