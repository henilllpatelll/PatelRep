'use client'

import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function useModalFocusTrap(
  ref: RefObject<HTMLElement>,
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

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const focusable = Array.from(
      modal.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    )
    ;(focusable[0] ?? modal).focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
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
      previouslyFocused?.focus()
    }
  }, [active, ref])
}
