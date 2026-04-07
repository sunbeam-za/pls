// Binds a map of shortcut handlers to window-level keydown once. The
// handlers object is read via a ref so App.tsx can re-render without
// tearing down the listener.
//
// Shortcuts are suppressed while the user is typing in an input/textarea
// /contenteditable — EXCEPT for `mod`-prefixed ones, which should still
// fire (otherwise Cmd+Enter to send wouldn't work from the URL bar).

import { useEffect, useRef } from 'react'
import { SHORTCUTS, matchEvent, type ShortcutId } from '@/lib/shortcuts'

export type ShortcutHandlers = Partial<Record<ShortcutId, (event: KeyboardEvent) => void>>

function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  // CodeMirror mounts a .cm-content contenteditable — covered above — but
  // dialog/dropdown command inputs are plain inputs, also covered above.
  return false
}

export function useShortcuts(handlers: ShortcutHandlers): void {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const inInput = isTextInput(event.target)
      for (const def of Object.values(SHORTCUTS)) {
        if (!matchEvent(event, def.keys)) continue
        const needsMod = def.keys.includes('mod')
        // Let plain-key shortcuts pass through while typing; require a mod
        // modifier to intercept anything while an input has focus.
        if (inInput && !needsMod) continue
        const handler = handlersRef.current[def.id]
        if (!handler) continue
        event.preventDefault()
        event.stopPropagation()
        handler(event)
        return
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return (): void => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
