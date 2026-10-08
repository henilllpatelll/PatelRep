'use client'

import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import type { DrawerView } from '@/lib/people/peopleDrawers'

export type Notice = { tone: 'success' | 'warning' | 'error'; text: string }

/** What every drawer view receives from the host. */
export interface ViewCommon {
  /** Pinned footer element inside the drawer; views portal their actions into it. */
  footerEl: HTMLElement | null
  /** Tell the host there is unsaved work (`credentials` = a one-time password is on screen). */
  onDirty: (dirty: boolean, kind?: 'form' | 'credentials') => void
  onView: (v: DrawerView) => void
  /** Back to the previous view (or close when there is none). Goes through the unsaved-changes guard. */
  onBack: () => void
  onClose: () => void
  notify: (n: Notice) => void
}

export function FooterPortal({ el, children }: { el: HTMLElement | null; children: ReactNode }) {
  return el ? createPortal(children, el) : null
}

/** Move focus to the first field the user has to fix, so errors are not just visual. */
export function focusFirstInvalid(root: HTMLElement | null) {
  root?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
}
