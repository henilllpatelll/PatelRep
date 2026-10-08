'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Mail, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { usePeopleLabels } from './usePeopleLabels'

/** One primary action (invite by email) with a small menu for the secondary manual-account path. */
export function PeopleInviteMenu({ onInvite, onCreateManually }: { onInvite: () => void; onCreateManually: () => void }) {
  const { t } = usePeopleLabels()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onPointer); document.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <div ref={ref} className="relative flex" data-i18n-skip="true">
      <Button variant="primary" size="lg" onClick={onInvite} className="rounded-r-none sm:min-h-[36px]">
        <Mail size={16} aria-hidden="true" />
        <span className="sm:hidden">{t('people.invite.short')}</span>
        <span className="hidden sm:inline">{t('people.invite.primary')}</span>
      </Button>
      <Button
        variant="primary"
        size="lg"
        aria-label={t('people.invite.more')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="rounded-l-none border-l border-white/30 px-2.5 sm:min-h-[36px]"
      >
        <ChevronDown size={14} aria-hidden="true" className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-2 w-60 rounded-xl border border-line bg-surface p-1 shadow-lg">
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onInvite() }}
            className="flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-semibold text-ink-2 hover:bg-surface-2"
          >
            <Mail size={16} aria-hidden="true" />{t('people.invite.byEmail')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onCreateManually() }}
            className="flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-semibold text-ink-2 hover:bg-surface-2"
          >
            <UserPlus size={16} aria-hidden="true" />{t('people.invite.manual')}
          </button>
        </div>
      )}
    </div>
  )
}
