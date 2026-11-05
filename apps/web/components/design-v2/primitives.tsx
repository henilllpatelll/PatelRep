import { CircleAlert, CircleCheck, Clock, Flame, Info, Loader, UserRound, Wrench } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import styles from './designV2.module.css'
import type { StatusKey } from './previewCopy'

const STATUS_CLASS: Record<StatusKey, string> = {
  ready: styles.sReady,
  clean: styles.sClean,
  inProgress: styles.sInProgress,
  dirty: styles.sDirty,
  occupied: styles.sOccupied,
  pickup: styles.sPickup,
  outOfOrder: styles.sOutOfOrder,
}

/** Each status has its own icon so the badge never relies on color alone. */
const STATUS_ICON: Record<StatusKey, ComponentType<{ size?: number; 'aria-hidden'?: boolean }>> = {
  ready: CircleCheck,
  clean: CircleCheck,
  inProgress: Loader,
  dirty: Flame,
  occupied: UserRound,
  pickup: CircleAlert,
  outOfOrder: Wrench,
}

export const statusSwatchVar = (key: StatusKey): string =>
  `var(--dv2-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)})`

export function StatusBadge({ status, label }: { status: StatusKey; label: string }) {
  const Icon = STATUS_ICON[status]
  return (
    <span className={`${styles.badge} ${STATUS_CLASS[status]}`}>
      <Icon size={13} aria-hidden />
      {label}
    </span>
  )
}

export type Priority = 'critical' | 'attention' | 'info'
const PRIORITY_CLASS: Record<Priority, string> = {
  critical: styles.pCritical,
  attention: styles.pAttention,
  info: styles.pInfo,
}
const PRIORITY_ICON: Record<Priority, ComponentType<{ size?: number; 'aria-hidden'?: boolean }>> = {
  critical: Flame,
  attention: Clock,
  info: Info,
}

export function PriorityBadge({ priority, label }: { priority: Priority; label: string }) {
  const Icon = PRIORITY_ICON[priority]
  return (
    <span className={`${styles.badge} ${PRIORITY_CLASS[priority]}`}>
      <Icon size={13} aria-hidden />
      {label}
    </span>
  )
}

export function Card({ title, hint, action, children, className }: { title: string; hint?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`${styles.card} ${styles.cardPad} ${className ?? ''}`} aria-label={title}>
      <div className={styles.cardHead}>
        <div>
          <h2 className={styles.cardTitle}>{title}</h2>
          {hint ? <p className={styles.cardHint}>{hint}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export function ProgressRow({ label, value, total, valueText }: { label: string; value: number; total: number; valueText: string }) {
  const pct = total > 0 ? Math.round((Math.min(value, total) / total) * 100) : 0
  return (
    <div className={styles.progressRow}>
      <div className={styles.progressTop}>
        <span>{label}</span>
        <span className={styles.num}>{valueText}</span>
      </div>
      <div
        className={styles.track}
        role="progressbar"
        aria-label={`${label}: ${valueText}`}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={Math.min(value, total)}
      >
        <div className={`${styles.fill} ${value >= total ? styles.fillOk : ''}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export type ButtonKind = 'primary' | 'secondary' | 'tertiary' | 'destructive'
const BUTTON_CLASS: Record<ButtonKind, string> = {
  primary: styles.btnPrimary,
  secondary: styles.btnSecondary,
  tertiary: styles.btnTertiary,
  destructive: styles.btnDestructive,
}

export function Btn({ kind = 'primary', children, disabled, onClick }: { kind?: ButtonKind; children: ReactNode; disabled?: boolean; onClick?: () => void }) {
  return (
    <button type="button" className={`${styles.btn} ${BUTTON_CLASS[kind]}`} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  )
}

export function Segmented<K extends string>({ label, value, options, onChange }: { label: string; value: K; options: ReadonlyArray<{ key: K; label: string }>; onChange: (key: K) => void }) {
  return (
    <div className={styles.segmented} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={o.key === value}
          className={`${styles.segment} ${o.key === value ? styles.segmentActive : ''}`}
          onClick={() => onChange(o.key)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
