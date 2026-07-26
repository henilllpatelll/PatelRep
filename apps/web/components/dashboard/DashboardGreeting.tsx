'use client'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

type GreetingKey = 'dashboard.greeting.morning' | 'dashboard.greeting.afternoon' | 'dashboard.greeting.evening'

interface DashboardGreetingProps {
  name: string
  hotelName?: string
  className?: string
}

/** The sanctioned role-dashboard header — spacing matches PageHeader's eyebrow/title/subtitle. */
export function DashboardGreeting({ name, hotelName, className }: DashboardGreetingProps) {
  const { t, i18n } = useTranslation()
  const [greetingKey, setGreetingKey] = useState<GreetingKey>('dashboard.greeting.morning')

  useEffect(() => {
    const hour = new Date().getHours()
    setGreetingKey(
      hour < 12 ? 'dashboard.greeting.morning' : hour < 18 ? 'dashboard.greeting.afternoon' : 'dashboard.greeting.evening'
    )
  }, [])

  return (
    <div className={cn('pb-0', className)}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink3 mb-2" suppressHydrationWarning>
        {new Date().toLocaleDateString(i18n.language === 'es' ? 'es-US' : 'en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        })}
      </p>
      <h1 className="font-display text-[34px] font-normal italic tracking-[-0.5px] leading-[1.1] text-ink">
        {t(greetingKey)}, {name}.
      </h1>
      {hotelName && <p className="mt-2 text-[14px] text-ink2 max-w-[640px] leading-[1.45]">{hotelName}</p>}
    </div>
  )
}
