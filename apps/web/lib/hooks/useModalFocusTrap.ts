'use client'

import { useEffect, useRef, type RefObject } from 'react'

/* Opener tracking. Restoring focus on close needs the control that opened the modal, but by the time any effect
   runs, React may already have run child effects / autofocus that moved focus into the panel, and Radix dialogs that
   open without a <Trigger> (Ctrl+K, custom events) have nothing to return to. So remember the last element focused
   OUTSIDE any dialog: it is, by construction, whatever the user was on when the dialog opened. A single passive
   document listener; nothing is written during render. */
let lastFocusedOutsideDialog: HTMLElement | null = null
if (typeof document !== 'undefined') {
  document.addEventListener('focusin', (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    if (target.closest('[role="dialog"], [aria-modal="true"]')) return
    lastFocusedOutsideDialog = target
  })
}

/** The element to hand focus back to when a dialog closes (null when there is none or it left the page). */
export function getFocusReturnTarget(): HTMLElement | null {
  return lastFocusedOutsideDialog?.isConnected ? lastFocusedOutsideDialog : null
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function useModalFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onClose?: () => void,
) {
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!active) return

    const modalElement = ref.current
    if (!modalElement) return
    const modal = modalElement as HTMLElement

    // Focus has not moved yet -> the active element is the opener; otherwise use the tracked one.
    const current = document.activeElement
    const previouslyFocused = current instanceof HTMLElement && current !== document.body && !modal.contains(current)
      ? current
      : lastFocusedOutsideDialog
    const focusable = Array.from(
      modal.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    )
    ;(focusable[0] ?? modal).focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        // A nested popover (assignee/room picker, etc.) that already handled its
        // own Escape (closing itself, not the drawer) calls preventDefault() —
        // respect that instead of also closing the drawer underneath it.
        if (event.defaultPrevented) return
        onCloseRef.current?.()
        return
      }

      if (event.key !== 'Tab') return

      const currentFocusable = Array.from(
        modal.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      )
      if (currentFocusable.length === 0) {
        event.preventDefault()
        modal.focus()
        return
      }

      const first = currentFocusable[0]
      const last = currentFocusable[currentFocusable.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [active, ref])
}
