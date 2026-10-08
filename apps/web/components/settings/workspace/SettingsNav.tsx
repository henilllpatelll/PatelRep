'use client'

import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  SETTINGS_GROUPS, getSettingsHref, nextListIndex, searchSettings,
  type SettingsDestination, type SettingsSearchResult,
} from '@/lib/settings/navigation'
import { SETTINGS_ICONS } from './settingsIcons'

const ITEM_ATTR = 'data-settings-nav-item'

function focusItem(container: HTMLElement | null, index: number) {
  const items = container?.querySelectorAll<HTMLElement>(`[${ITEM_ATTR}]`)
  items?.[index]?.focus()
}

/** Arrow / Home / End movement between links in a list; ArrowUp on the first item returns to `onExitUp`. */
function handleListKey(event: KeyboardEvent<HTMLElement>, container: HTMLElement | null, onExitUp?: () => void) {
  const items = Array.from(container?.querySelectorAll<HTMLElement>(`[${ITEM_ATTR}]`) ?? [])
  const current = items.indexOf(event.target as HTMLElement)
  if (current < 0) return
  if (event.key === 'ArrowUp' && current === 0 && onExitUp) {
    event.preventDefault()
    onExitUp()
    return
  }
  const next = nextListIndex(current, event.key, items.length)
  if (next === null) return
  event.preventDefault()
  items[next]?.focus()
}

/**
 * Settings navigation: a search field above grouped destinations. While a query is present the
 * grouped list is replaced by search results. Planned destinations render as disabled, labelled rows.
 * One instance serves every breakpoint — the layout decides when it is visible.
 */
export function SettingsNav({
  destinations, activeId, role, onNavigate,
}: {
  destinations: SettingsDestination[]
  activeId: string | undefined
  role: string | null | undefined
  /** Called after a link is chosen so a collapsed mobile menu can close. */
  onNavigate?: () => void
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const statusId = useId()
  const [query, setQuery] = useState('')

  const results: SettingsSearchResult[] = useMemo(() => searchSettings(query, role), [query, role])
  const searching = query.trim().length > 0

  function clear() {
    setQuery('')
    inputRef.current?.focus()
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape' && query) {
      event.preventDefault()
      setQuery('')
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusItem(listRef.current, 0)
    } else if (event.key === 'Enter' && searching && results[0]) {
      event.preventDefault()
      router.push(results[0].href)
      setQuery('')
      onNavigate?.()
    }
  }

  function choose() {
    setQuery('')
    onNavigate?.()
  }

  return (
    <div className="space-y-4">
      <div role="search" className="relative">
        <label htmlFor={`${statusId}-q`} className="sr-only">Search settings</label>
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden="true" />
        <input
          ref={inputRef}
          id={`${statusId}-q`}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder="Search settings"
          autoComplete="off"
          aria-describedby={statusId}
          className="h-11 w-full rounded-[var(--r-md)] border border-line bg-surface pl-9 pr-9 text-sm text-ink placeholder:text-ink-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] lg:h-9 [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear search"
            className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-ink-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] lg:h-7 lg:w-7"
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>

      <p id={statusId} role="status" aria-live="polite" className={searching ? 'px-1 text-xs text-ink-3' : 'sr-only'}>
        {searching ? (results.length === 0 ? 'No matching settings' : `${results.length} ${results.length === 1 ? 'result' : 'results'}`) : ''}
      </p>

      <div ref={listRef} onKeyDown={(event) => handleListKey(event, listRef.current, searching ? () => inputRef.current?.focus() : undefined)}>
        {searching ? (
          results.length === 0 ? (
            <div className="rounded-[var(--r-md)] border border-dashed border-line px-4 py-6 text-center">
              <p className="text-sm font-medium text-ink">No settings match “{query.trim()}”</p>
              <p className="mt-1 text-[13px] text-ink-3">Try a broader word like “room”, “billing” or “checklist”.</p>
              <button type="button" onClick={clear} className="mt-3 min-h-[44px] text-[13px] font-semibold text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] lg:min-h-[32px]">
                Clear search
              </button>
            </div>
          ) : (
            <ul className="space-y-1" aria-label="Search results">
              {results.map((result) => {
                const dest = destinations.find((d) => d.id === result.destinationId)
                const Icon = dest ? SETTINGS_ICONS[dest.icon] : null
                return (
                  <li key={result.id}>
                    <Link
                      href={result.href}
                      onClick={choose}
                      {...{ [ITEM_ATTR]: '' }}
                      className="flex min-h-[44px] items-start gap-2.5 rounded-[var(--r-md)] px-2.5 py-2 text-sm text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] lg:min-h-0"
                    >
                      {Icon && <Icon size={16} className="mt-0.5 shrink-0 text-ink-3" aria-hidden="true" />}
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-ink">{result.label}</span>
                        {result.label !== result.destinationLabel && (
                          <span className="block truncate text-xs text-ink-3">in {result.destinationLabel}</span>
                        )}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )
        ) : (
          <nav aria-label="Settings" className="space-y-5">
            {SETTINGS_GROUPS.map((group) => {
              const items = destinations.filter((d) => d.group === group.id)
              if (items.length === 0) return null
              const labelId = `${statusId}-g-${group.id}`
              return (
                <div key={group.id}>
                  <p id={labelId} className="mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">{group.label}</p>
                  <ul aria-labelledby={labelId} className="space-y-0.5">
                    {items.map((item) => {
                      const Icon = SETTINGS_ICONS[item.icon]
                      const active = item.id === activeId
                      const href = getSettingsHref(item)
                      const base = 'flex min-h-[44px] items-center gap-2.5 rounded-[var(--r-md)] px-2.5 py-2 text-sm transition-colors lg:min-h-[36px]'
                      return (
                        <li key={item.id}>
                          {href ? (
                            <Link
                              href={href}
                              onClick={onNavigate}
                              aria-current={active ? 'page' : undefined}
                              {...{ [ITEM_ATTR]: '' }}
                              className={cn(
                                base,
                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]',
                                active
                                  ? 'bg-[var(--accent-soft)] font-medium text-[var(--accent)]'
                                  : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
                              )}
                            >
                              <Icon size={16} className="shrink-0" aria-hidden="true" />
                              <span className="min-w-0 truncate">{item.label}</span>
                            </Link>
                          ) : (
                            <span aria-disabled="true" className={cn(base, 'cursor-not-allowed text-ink-3')}>
                              <Icon size={16} className="shrink-0" aria-hidden="true" />
                              <span className="min-w-0 flex-1 truncate">{item.label}</span>
                              <span className="rounded-full border border-line px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-ink-3">Soon</span>
                            </span>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })}
          </nav>
        )}
      </div>
    </div>
  )
}
