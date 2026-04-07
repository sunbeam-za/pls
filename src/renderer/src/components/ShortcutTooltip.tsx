// Thin wrapper around shadcn's Tooltip that renders a label alongside a
// Kbd hint. Used anywhere a control has a shortcut but no room for an
// inline hint — icon buttons, dropdown triggers, etc.
//
// Keeping this as one component means adding a shortcut to any button is
// a one-line change: wrap it and pass the shortcut id.

import * as React from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Kbd } from '@/components/ui/kbd'
import { SHORTCUTS, type ShortcutId } from '@/lib/shortcuts'

interface Props {
  /** Short action label, e.g. "New collection". */
  label: string
  /** Shortcut id from the registry; pulls keys from SHORTCUTS. */
  shortcut?: ShortcutId
  children: React.ReactNode
  /** If the trigger should render inside the tooltip's asChild slot. */
  asChild?: boolean
  side?: 'top' | 'right' | 'bottom' | 'left'
}

export function ShortcutTooltip({
  label,
  shortcut,
  children,
  asChild = true,
  side = 'bottom'
}: Props): React.JSX.Element {
  const def = shortcut ? SHORTCUTS[shortcut] : undefined
  return (
    <Tooltip>
      <TooltipTrigger asChild={asChild}>{children}</TooltipTrigger>
      <TooltipContent side={side} className="flex items-center gap-2 text-[11px]">
        <span>{label}</span>
        {def && <Kbd keys={def.keys} />}
      </TooltipContent>
    </Tooltip>
  )
}
