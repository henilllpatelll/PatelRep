'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getNavigationTarget } from '@/lib/settings/unsavedGuard'
import { SettingsConfirmDialog } from './SettingsConfirmDialog'

/**
 * Warns before leaving a page with unsaved edits: the browser prompt for reload / tab close, and an
 * in-app confirmation for link clicks (sidebar, Settings nav, header). Browser Back/Forward is not
 * interceptable in the App Router and falls back to the reload prompt only when leaving the app.
 */
export function UnsavedChangesGuard({ dirty }: { dirty: boolean }) {
  const router = useRouter()
  const [target, setTarget] = useState<string | null>(null)

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return
      const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!anchor) return
      const next = getNavigationTarget({
        href: anchor.getAttribute('href') ?? '',
        currentHref: window.location.href,
        origin: window.location.origin,
        target: anchor.target,
        download: anchor.hasAttribute('download'),
        modifier: event.metaKey || event.ctrlKey || event.shiftKey || event.altKey,
      })
      if (!next) return
      event.preventDefault()
      event.stopPropagation()
      setTarget(next)
    }
    window.addEventListener('beforeunload', warn)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', warn)
      document.removeEventListener('click', onClick, true)
    }
  }, [dirty])

  if (!target) return null
  return (
    <SettingsConfirmDialog
      title="Leave without saving?"
      body={<p>You have unsaved changes on this page. If you leave now they will be lost.</p>}
      confirmLabel="Leave page"
      cancelLabel="Stay and keep editing"
      tone="destructive"
      onCancel={() => setTarget(null)}
      onConfirm={() => { const go = target; setTarget(null); router.push(go) }}
    />
  )
}
