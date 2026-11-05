'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import styles from './designV2.module.css'

export interface DrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  closeLabel: string
  /** `right` is the detail drawer (records, forms). `left` is the navigation drawer on small screens. */
  side?: 'right' | 'left'
  /** Inline CSS variables so the portal (which renders outside the preview root) keeps the V2 theme. */
  themeVars: CSSProperties
  children: ReactNode
  footer?: ReactNode
}

/** V2 drawer foundation (web). Radix Dialog supplies the focus trap, Escape-to-close, scroll lock,
 *  aria-modal and focus return; V2 supplies the surface. One drawer = one task: detail views and
 *  short forms. Do not stack drawers; confirmations are a centered dialog, not a second drawer.
 *  The slide animation is disabled under prefers-reduced-motion (see designV2.module.css). */
export function Drawer({ open, onOpenChange, title, closeLabel, side = 'right', themeVars, children, footer }: DrawerProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} style={themeVars} />
        <Dialog.Content
          className={`${styles.drawer} ${side === 'left' ? styles.drawerLeft : styles.drawerRight}`}
          style={themeVars}
          aria-describedby={undefined}
        >
          <div className={styles.drawerHead}>
            <Dialog.Title className={styles.drawerTitle}>{title}</Dialog.Title>
            <Dialog.Close className={styles.iconButton} aria-label={closeLabel} style={side === 'left' ? { color: 'inherit' } : undefined}>
              <X size={20} aria-hidden="true" />
            </Dialog.Close>
          </div>
          <div className={styles.drawerBody}>{children}</div>
          {footer ? <div className={styles.drawerFoot}>{footer}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
