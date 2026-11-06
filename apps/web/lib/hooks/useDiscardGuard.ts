'use client'

import { useCallback, useEffect, useState } from 'react'

/** Unsaved-changes protection for create drawers.
 *
 *  `requestClose` is what every dismissal path (Escape, backdrop, the X, Cancel) should call. When the form has
 *  unsaved input it asks first instead of throwing the input away; when it is clean it closes immediately. A
 *  successful submit keeps calling the raw `onClose`, because saving is not discarding. */
export function useDiscardGuard(dirty: boolean, onClose: () => void) {
  const [confirming, setConfirming] = useState(false)

  // A clean form (or a reopened one) never keeps a stale prompt.
  useEffect(() => {
    if (!dirty) setConfirming(false)
  }, [dirty])

  const requestClose = useCallback(() => {
    if (dirty) setConfirming(true)
    else onClose()
  }, [dirty, onClose])
  const keepEditing = useCallback(() => setConfirming(false), [])
  const discard = useCallback(() => {
    setConfirming(false)
    onClose()
  }, [onClose])

  return { requestClose, confirming, keepEditing, discard }
}
