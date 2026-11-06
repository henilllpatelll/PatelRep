'use client'

import {
  Bell,
  BedDouble,
  Building2,
  CalendarDays,
  ChartColumn,
  ChevronDown,
  CircleCheck,
  LayoutDashboard,
  ListChecks,
  Menu,
  Search,
  Settings,
  Sparkles,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { useMemo, useState, type CSSProperties } from 'react'
import { designV2CssVars, type ModeV2 } from '@/lib/design/designV2Tokens'
import { Drawer } from './Drawer'
import styles from './designV2.module.css'
import { Btn, Card, PriorityBadge, ProgressRow, Segmented, statusSwatchVar, type Priority } from './primitives'
import { copy, kpiSample, readinessCounts, teamSample, type Lang, type StatusKey } from './previewCopy'
import { StatesShowcase } from './StatesShowcase'

const NAV: ReadonlyArray<{ key: keyof (typeof copy)['en']['nav']; icon: LucideIcon }> = [
  { key: 'dashboard', icon: LayoutDashboard },
  { key: 'housekeeping', icon: BedDouble },
  { key: 'engineering', icon: Wrench },
  { key: 'tasks', icon: ListChecks },
  { key: 'scheduling', icon: CalendarDays },
  { key: 'reports', icon: ChartColumn },
  { key: 'staff', icon: Users },
  { key: 'settings', icon: Settings },
]

const KPI_ICON: Record<(typeof kpiSample)[number]['icon'], LucideIcon> = {
  bed: BedDouble,
  check: CircleCheck,
  wrench: Wrench,
  people: Users,
  bell: Bell,
}

const STATUS_ORDER: StatusKey[] = ['ready', 'clean', 'inProgress', 'dirty', 'occupied', 'pickup', 'outOfOrder']

/** Reference composition for the V2 manager dashboard. Visual only: every control is inert or
 *  local state, all figures are the invented sample data in previewCopy.ts, and it is reachable
 *  only through the flagged /design-v2-preview route. It is NOT the production dashboard. */
export function DashboardPreview() {
  const [mode, setMode] = useState<ModeV2>('light')
  const [lang, setLang] = useState<Lang>('en')
  const [navOpen, setNavOpen] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const t = copy[lang]
  const vars = useMemo(() => ({ ...designV2CssVars(mode), colorScheme: mode }) as CSSProperties, [mode])

  const exceptions: Array<{ title: string; meta: string; priority: Priority }> = [
    { title: t.ex1, meta: t.ex1m, priority: 'critical' },
    { title: t.ex2, meta: t.ex2m, priority: 'critical' },
    { title: t.ex3, meta: t.ex3m, priority: 'attention' },
    { title: t.ex4, meta: t.ex4m, priority: 'attention' },
  ]
  const priorityLabel = (p: Priority) => t[p]
  const total = STATUS_ORDER.reduce((sum, k) => sum + readinessCounts[k], 0)
  const barSummary = STATUS_ORDER.map((k) => `${t.status[k]} ${readinessCounts[k]}`).join(', ')
  const picked = selected === null ? null : exceptions[selected]

  const navList = (
    <ul className={styles.navList}>
      {NAV.map(({ key, icon: Icon }) => (
        <li key={key}>
          <button
            type="button"
            className={`${styles.navItem} ${key === 'dashboard' ? styles.navItemActive : ''}`}
            aria-current={key === 'dashboard' ? 'page' : undefined}
            onClick={() => setNavOpen(false)}
          >
            <Icon size={20} aria-hidden />
            {t.nav[key]}
          </button>
        </li>
      ))}
    </ul>
  )
  const brand = (
    <div className={styles.brand}>
      <span className={styles.logo} aria-hidden>P</span>
      {t.brand}
    </div>
  )

  return (
    <div className={styles.root} style={vars} data-design-v2={mode} lang={lang}>
      {/* Preview-only chrome: not part of the dashboard design. */}
      <div className={styles.toolbar} role="region" aria-label={t.banner}>
        <div className={styles.toolbarText}>
          <p className={styles.toolbarTitle}>{t.banner}</p>
          <p className={styles.toolbarBody}>{t.bannerBody}</p>
        </div>
        <div className={styles.toolbarGroup}>
          <span>{t.theme}</span>
          <Segmented<ModeV2>
            label={t.theme}
            value={mode}
            onChange={setMode}
            options={[
              { key: 'light', label: t.light },
              { key: 'dark', label: t.dark },
            ]}
          />
        </div>
        <div className={styles.toolbarGroup}>
          <span>{t.language}</span>
          <Segmented<Lang>
            label={t.language}
            value={lang}
            onChange={setLang}
            options={[
              { key: 'en', label: 'EN' },
              { key: 'es', label: 'ES' },
            ]}
          />
        </div>
      </div>

      <div className={styles.shell}>
        {/* 1. Sidebar */}
        <aside className={styles.sidebar} aria-label={t.nav.dashboard}>
          {brand}
          <nav aria-label={t.brand}>{navList}</nav>
        </aside>

        <div className={styles.main}>
          {/* 2. Header */}
          <header className={styles.header}>
            <button type="button" className={`${styles.iconButton} ${styles.menuButton}`} aria-label={t.openMenu} onClick={() => setNavOpen(true)}>
              <Menu size={22} aria-hidden />
            </button>
            <label className={styles.property}>
              <Building2 size={18} aria-hidden />
              <span className={styles.srOnly}>{t.property}</span>
              <select defaultValue="demo" aria-label={t.property}>
                <option value="demo">{t.propertyName}</option>
              </select>
              <ChevronDown size={16} aria-hidden />
            </label>
            <label className={styles.search}>
              <Search size={18} aria-hidden />
              <span className={styles.srOnly}>{t.searchShort}</span>
              <input type="search" placeholder={t.search} aria-label={t.searchShort} />
            </label>
            <span className={styles.headerSpacer} />
            <button type="button" className={styles.iconButton} aria-label={`${t.notifications}, 3`}>
              <Bell size={22} aria-hidden />
              <span className={styles.badgeCount} aria-hidden>3</span>
            </button>
            <button type="button" className={styles.account} aria-label={t.account}>
              <span className={styles.avatar} aria-hidden>AL</span>
              <span className={styles.accountText}>
                <span>Alex Lee</span>
                <br />
                <span className={styles.accountRole}>{t.accountRole}</span>
              </span>
            </button>
          </header>

          <main className={styles.content}>
            <div>
              <h1 className={styles.pageTitle}>{t.welcome}</h1>
              <p className={styles.pageSub}>{t.date}</p>
            </div>

            {/* 3. KPI cards */}
            <div className={styles.kpiGrid}>
              {kpiSample.map((k) => {
                const Icon = KPI_ICON[k.icon]
                return (
                  <div key={k.key} className={`${styles.card} ${styles.kpi}`}>
                    <div className={styles.kpiTop}>
                      <span>{t[k.key]}</span>
                      <span className={styles.kpiIcon}><Icon size={16} aria-hidden /></span>
                    </div>
                    <span className={`${styles.kpiValue} ${styles.num}`}>{k.value}</span>
                    <span className={styles.kpiCap}>{t[k.cap]}</span>
                  </div>
                )
              })}
            </div>

            <div className={styles.grid2}>
              <div className={styles.stack}>
                {/* 4. Room readiness */}
                <Card title={t.readiness} hint={t.readinessHint}>
                  <div className={styles.bar} role="img" aria-label={`${t.readiness}: ${barSummary}`}>
                    {STATUS_ORDER.map((k) => (
                      <span key={k} className={styles.barSeg} style={{ flexGrow: readinessCounts[k], background: statusSwatchVar(k) }} />
                    ))}
                  </div>
                  <ul className={styles.legend}>
                    {STATUS_ORDER.map((k) => (
                      <li key={k} className={styles.legendItem}>
                        <span className={styles.legendLabel}>
                          <span className={styles.swatch} style={{ background: statusSwatchVar(k) }} aria-hidden />
                          {t.status[k]}
                        </span>
                        <span className={`${styles.legendCount} ${styles.num}`}>{readinessCounts[k]}</span>
                      </li>
                    ))}
                  </ul>
                  <p className={styles.cardHint} style={{ marginTop: 10 }}>
                    <span className={styles.num}>{total}</span> {t.total}
                  </p>
                </Card>

                {/* 7. Work-order table */}
                <Card title={t.workOrders} hint={t.workOrdersHint} action={<button type="button" className={styles.linkButton}>{t.viewAll}</button>}>
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <caption className={styles.srOnly}>{t.workOrders}</caption>
                      <thead>
                        <tr>
                          <th scope="col">{t.colId}</th>
                          <th scope="col">{t.colIssue}</th>
                          <th scope="col">{t.colLocation}</th>
                          <th scope="col">{t.colPriority}</th>
                          <th scope="col">{t.colAssignee}</th>
                          <th scope="col">{t.colDue}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {t.woRows.map((row) => (
                          <tr key={row.id}>
                            <td data-label={t.colId} className={styles.mono}>{row.id}</td>
                            <td data-label={t.colIssue}>{row.issue}</td>
                            <td data-label={t.colLocation}>{row.location}</td>
                            <td data-label={t.colPriority}>
                              <PriorityBadge priority={row.priority as Priority} label={priorityLabel(row.priority as Priority)} />
                            </td>
                            <td data-label={t.colAssignee}>{row.assignee}</td>
                            <td data-label={t.colDue} className={styles.num}>{row.due}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>

              <div className={styles.stack}>
                {/* 5. Priority exceptions */}
                <Card title={t.exceptions} hint={t.exceptionsHint}>
                  <ul className={styles.list}>
                    {exceptions.map((ex, i) => (
                      <li key={ex.title}>
                        <button type="button" className={styles.listRow} onClick={() => setSelected(i)} aria-haspopup="dialog">
                          <PriorityBadge priority={ex.priority} label={priorityLabel(ex.priority)} />
                          <span className={styles.listText}>
                            <span className={styles.listTitle}>{ex.title}</span>
                            <br />
                            <span className={styles.listMeta}>{ex.meta}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </Card>

                {/* 6. Team pulse */}
                <Card title={t.team} hint={t.teamHint}>
                  {teamSample.map((team) => (
                    <ProgressRow
                      key={team.key}
                      label={t[team.key]}
                      value={team.on}
                      total={team.total}
                      valueText={t.onDuty.replace('{n}', String(team.on)).replace('{t}', String(team.total))}
                    />
                  ))}
                  <div className={styles.metricRow}>
                    <span className={styles.cardHint}>{t.avgClean}</span>
                    <span className={`${styles.metricBig} ${styles.num}`}>{t.avgCleanValue}</span>
                    <span className={styles.cardHint}>{t.avgCleanDelta}</span>
                  </div>
                </Card>

                {/* 8. AI insights */}
                <aside className={styles.ai} aria-label={t.ai}>
                  <div className={styles.aiHead}>
                    <Sparkles size={18} aria-hidden />
                    <h2 className={styles.cardTitle} style={{ color: 'inherit' }}>{t.ai}</h2>
                    <span className={styles.aiChip}>{t.aiLabel}</span>
                  </div>
                  {[t.ai1, t.ai2, t.ai3].map((line) => (
                    <p key={line} className={styles.aiItem}>{line}</p>
                  ))}
                  <p className={styles.aiNote}>{t.aiProvenance}</p>
                </aside>
              </div>
            </div>

            <StatesShowcase lang={lang} />
          </main>
        </div>
      </div>

      {/* Detail drawer (right) and navigation drawer (left, small screens). */}
      <Drawer
        open={picked !== null}
        onOpenChange={(open) => !open && setSelected(null)}
        title={t.drawerTitle}
        closeLabel={t.closeDrawer}
        themeVars={vars}
        footer={
          <>
            <Btn kind="primary">{t.drawerAction}</Btn>
            <Btn kind="secondary">{t.drawerSecondary}</Btn>
          </>
        }
      >
        {picked ? (
          <>
            <div><PriorityBadge priority={picked.priority} label={priorityLabel(picked.priority)} /></div>
            <h3 className={styles.cardTitle}>{picked.title}</h3>
            <p className={styles.cardHint}>{picked.meta}</p>
            <p>{t.drawerBody}</p>
          </>
        ) : null}
      </Drawer>
      <Drawer open={navOpen} onOpenChange={setNavOpen} side="left" title={t.brand} closeLabel={t.closeMenu} themeVars={vars}>
        <nav aria-label={t.brand}>{navList}</nav>
      </Drawer>
    </div>
  )
}
