import { CircleAlert, CloudOff, Inbox } from 'lucide-react'
import { useState } from 'react'
import styles from './designV2.module.css'
import { Btn, Card, Segmented } from './primitives'
import { copy, type Lang } from './previewCopy'

/** Reference sheet for the shared V2 patterns: buttons, fields, segmented control and the four
 *  non-happy-path states. Sample content only. */
export function StatesShowcase({ lang }: { lang: Lang }) {
  const t = copy[lang]
  const [seg, setSeg] = useState<'a' | 'b' | 'c'>('a')
  return (
    <Card title={t.statesTitle} hint={t.statesHint}>
      <div className={styles.stack}>
        <div>
          <h3 className={styles.fieldLabel}>{t.buttons}</h3>
          <div className={styles.btnRow}>
            <Btn kind="primary">{t.primary}</Btn>
            <Btn kind="secondary">{t.secondary}</Btn>
            <Btn kind="tertiary">{t.tertiary}</Btn>
            <Btn kind="destructive">{t.destructive}</Btn>
            <Btn kind="primary" disabled>{t.disabled}</Btn>
          </div>
        </div>

        <div className={styles.grid3}>
          <div className={styles.stack}>
            <h3 className={styles.fieldLabel}>{t.fields}</h3>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{t.fieldLabel}</span>
              <input className={styles.input} defaultValue="0412" inputMode="numeric" aria-describedby="dv2-help" />
              <span id="dv2-help" className={styles.help}>{t.fieldHelp}</span>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{t.fieldLabel}</span>
              <input className={`${styles.input} ${styles.inputError}`} defaultValue="9999" aria-invalid="true" aria-describedby="dv2-err" />
              <span id="dv2-err" className={styles.errorText} role="alert">
                <CircleAlert size={14} aria-hidden />
                {t.fieldError}
              </span>
            </label>
          </div>
          <div className={styles.stack}>
            <h3 className={styles.fieldLabel}>{t.segmented}</h3>
            <Segmented
              label={t.segmented}
              value={seg}
              onChange={setSeg}
              options={[
                { key: 'a', label: t.segA },
                { key: 'b', label: t.segB },
                { key: 'c', label: t.segC },
              ]}
            />
          </div>
        </div>

        <div className={styles.statesGrid}>
          <div className={styles.stateCard} role="status" aria-busy="true" aria-label={t.stLoading}>
            <span className={styles.stateTitle}>{t.stLoading}</span>
            <div className={styles.skeleton} />
            <div className={styles.skeleton} style={{ width: '70%' }} />
            <div className={styles.skeleton} style={{ width: '85%' }} />
          </div>
          <div className={styles.stateCard}>
            <Inbox size={24} className={styles.stateIcon} aria-hidden />
            <p className={styles.stateTitle}>{t.stEmpty}</p>
            <p className={styles.stateBody}>{t.stEmptyBody}</p>
            <Btn kind="secondary">{t.clear}</Btn>
          </div>
          <div className={styles.stateCard} role="alert">
            <CircleAlert size={24} style={{ color: 'var(--dv2-dirty)' }} aria-hidden />
            <p className={styles.stateTitle}>{t.stError}</p>
            <p className={styles.stateBody}>{t.stErrorBody}</p>
            <Btn kind="secondary">{t.retry}</Btn>
          </div>
          <div className={styles.stateCard} role="status">
            <CloudOff size={24} style={{ color: 'var(--dv2-pickup)' }} aria-hidden />
            <p className={styles.stateTitle}>{t.stOffline}</p>
            <p className={styles.stateBody}>{t.stOfflineBody}</p>
            <Btn kind="secondary">{t.retry}</Btn>
          </div>
        </div>
      </div>
    </Card>
  )
}
