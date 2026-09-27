'use client'

import { useMemo, useState } from 'react'
import { Check, Search, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { engineeringApi, type RepairCode } from '@/lib/api/engineering'

type Props = {
  codeType: RepairCode['code_type']
  category: string
  assetCategoryId?: string
  value?: string
  onChange: (code: RepairCode | null) => void
  label: string
  searchPlaceholder: string
  emptyLabel: string
  clearLabel: string
}

/** A compact, touch-friendly category-first code picker. It intentionally
 * loads only one repair taxonomy slice and never exposes internal code names. */
export function RepairCodePicker({
  codeType, category, assetCategoryId, value, onChange, label,
  searchPlaceholder, emptyLabel, clearLabel,
}: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const query = useQuery({
    queryKey: ['engineering-repair-codes', codeType, category, assetCategoryId],
    queryFn: () => engineeringApi.getRepairCodes({
      type: codeType,
      category,
      asset_category_id: assetCategoryId,
    }),
    staleTime: 5 * 60_000,
  })
  const codes = useMemo(() => query.data?.data ?? [], [query.data?.data])
  const selected = codes.find((code) => code.id === value)
  const options = useMemo(
    () => codes.filter((code) => code.label.toLocaleLowerCase().includes(search.toLocaleLowerCase())).slice(0, 10),
    [codes, search],
  )

  return (
    <div className="relative">
      <label className="mb-1 block text-xs font-medium text-ink2">{label}</label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink3" />
        <input
          value={open ? search : selected?.label ?? search}
          onFocus={() => { setOpen(true); setSearch('') }}
          onChange={(event) => { setOpen(true); setSearch(event.target.value) }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false)
            if (event.key === 'Enter' && options[0]) {
              event.preventDefault()
              onChange(options[0])
              setSearch('')
              setOpen(false)
            }
          }}
          placeholder={searchPlaceholder}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${codeType}-repair-code-options`}
          className="w-full rounded-[var(--r-sm)] border border-line bg-surface py-2 pl-9 pr-9 text-sm text-ink outline-none focus:ring-2 focus:ring-amber-400/50"
        />
        {value && (
          <button
            type="button"
            aria-label={clearLabel}
            onClick={() => { onChange(null); setSearch('') }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink3 hover:bg-surface-2 hover:text-ink"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {open && (
        <div id={`${codeType}-repair-code-options`} role="listbox" className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-[var(--r-md)] border border-line bg-surface p-1 shadow-lg">
          {query.isLoading ? (
            <p className="px-3 py-2 text-sm text-ink3">{emptyLabel}</p>
          ) : options.length ? options.map((code) => (
            <button
              key={code.id}
              type="button"
              role="option"
              aria-selected={code.id === value}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => { onChange(code); setSearch(''); setOpen(false) }}
              className="flex w-full items-center justify-between rounded-[var(--r-sm)] px-3 py-2 text-left text-sm text-ink hover:bg-surface-2"
            >
              <span>{code.label}</span>
              {code.id === value && <Check className="h-4 w-4 text-[var(--ready)]" />}
            </button>
          )) : (
            <p className="px-3 py-2 text-sm text-ink3">{emptyLabel}</p>
          )}
        </div>
      )}
    </div>
  )
}
