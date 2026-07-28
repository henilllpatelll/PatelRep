'use client'

import * as RadixToast from '@radix-ui/react-toast'
import { CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

type ToastTone = 'ready' | 'alert' | 'info'
interface ToastItem { id: string; tone: ToastTone; message: string }

type Listener = (toasts: ToastItem[]) => void
let toasts: ToastItem[] = []
const listeners = new Set<Listener>()

function emit() {
  listeners.forEach((listener) => listener(toasts))
}

function pushToast(tone: ToastTone, message: string) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  toasts = [...toasts, { id, tone, message }]
  emit()
}

function dismissToast(id: string) {
  toasts = toasts.filter((toast) => toast.id !== id)
  emit()
}

/** Fire-and-forget toast API. Pass already-translated strings — the caller owns i18n. */
export function useToast() {
  return {
    success: (message: string) => pushToast('ready', message),
    error: (message: string) => pushToast('alert', message),
    info: (message: string) => pushToast('info', message),
  }
}

const TONE_STYLES: Record<ToastTone, string> = {
  ready: 'border-[var(--ready-line)] bg-[var(--ready-soft)] text-[var(--ready)]',
  alert: 'border-[var(--alert-line)] bg-[var(--alert-soft)] text-[var(--alert)]',
  info: 'border-[var(--info-line)] bg-[var(--info-soft)] text-[var(--info)]',
}

const TONE_ICONS: Record<ToastTone, typeof CheckCircle2> = {
  ready: CheckCircle2,
  alert: XCircle,
  info: Info,
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([])

  useEffect(() => {
    listeners.add(setItems)
    return () => {
      listeners.delete(setItems)
    }
  }, [])

  return (
    <RadixToast.Provider swipeDirection="right" duration={3500}>
      {items.map((item) => {
        const Icon = TONE_ICONS[item.tone]
        return (
          <RadixToast.Root
            key={item.id}
            onOpenChange={(open) => {
              if (!open) dismissToast(item.id)
            }}
            className={cn(
              'flex items-start gap-2.5 rounded-[var(--r-lg)] border px-3.5 py-3 shadow-pop',
              'data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)]',
              'data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)]',
              TONE_STYLES[item.tone]
            )}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <RadixToast.Description className="flex-1 text-[13px] font-medium leading-snug text-ink">
              {item.message}
            </RadixToast.Description>
            <RadixToast.Close
              className="shrink-0 text-ink3 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40 rounded"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </RadixToast.Close>
          </RadixToast.Root>
        )
      })}
      <RadixToast.Viewport className="fixed bottom-4 right-4 z-[100] flex w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-2 outline-none" />
    </RadixToast.Provider>
  )
}
