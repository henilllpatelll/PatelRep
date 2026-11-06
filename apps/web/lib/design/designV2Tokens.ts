/* Design System V2 — "Precision Slate + Electric Blue" tokens for the WEB app.
 *
 * Mirrors apps/mobile/components/shared/tokensV2.ts value-for-value. The web Docker build copies
 * only apps/web, so the file is duplicated rather than imported; lib/design/designV2Tokens.test.ts
 * fails if the two ever drift. Contrast is asserted in that same test.
 *
 * Applied only inside the flagged /design-v2-preview route via inline CSS variables
 * (designV2CssVars). globals.css / tailwind.config.ts are frozen and untouched. */

export type ModeV2 = 'light' | 'dark'

/** The headline palette from the V2 brief plus the derived soft/line/pressed values. */
export const paletteV2 = {
  light: {
    background: '#F6F8FC',
    surface: '#FFFFFF',
    surfaceSecondary: '#EEF2F8',
    textPrimary: '#0D1728',
    textSecondary: '#536277',
    // Deviation: lighter-than-secondary text that still clears 4.5:1 on surfaceSecondary.
    textMuted: '#5B6B82',
    // Subtle separator / card edge (the brief's 'Border'). NOT sufficient for form-field edges.
    border: '#DDE4EE',
    // Essential-UI edge (inputs, outlined controls): ≥3:1 on every surface. Documented addition.
    borderStrong: '#7A8BA1',
    primary: '#2563EB',
    primaryPressed: '#1D4ED8',
    primarySoft: '#EAF1FE',
    primaryLine: '#B9CDF8',
    onPrimary: '#FFFFFF',
    destructive: '#C2414B',
    onDestructive: '#FFFFFF',
    navSurface: '#0D1728',
    ai: '#7C3AED',
    aiSoft: '#F3EDFE',
    aiLine: '#D5C3FA',
    onAi: '#FFFFFF',
  },
  dark: {
    background: '#0B1220',
    surface: '#111C2E',
    surfaceSecondary: '#19263A',
    textPrimary: '#F3F7FC',
    textSecondary: '#A8B6CA',
    textMuted: '#8A9BB3',
    border: '#2A3B51',
    borderStrong: '#6B7F99',
    primary: '#60A5FA',
    primaryPressed: '#3B82F6',
    primarySoft: 'rgba(96, 165, 250, 0.16)',
    primaryLine: 'rgba(96, 165, 250, 0.40)',
    onPrimary: '#0B1220',
    destructive: '#F87171',
    onDestructive: '#1C0D0F',
    navSurface: '#0D1728',
    ai: '#A78BFA',
    aiSoft: 'rgba(167, 139, 250, 0.12)',
    aiLine: 'rgba(167, 139, 250, 0.42)',
    onAi: '#140B2E',
  },
} as const

/** Semantic status colors. Key names mirror the legacy `statusTokens` so adapters stay 1:1.
 *  Foreground values are text-safe (≥4.5:1 on their own soft fill) and always paired with an
 *  icon + text label — color is never the only signal. */
export const statusV2 = {
  light: {
    ready: '#047857',
    clean: '#0E7490',
    inProgress: '#7C3AED',
    dirty: '#C2414B',
    occupied: '#475569',
    // Deviation: the brief says #B45309, which is 4.47:1 on surfaceSecondary; #B04F08 clears 4.5:1.
    pickup: '#B04F08',
    // Deviation: the brief's #64748B is 4.2:1 on its soft fill; #566379 clears 4.5:1.
    outOfOrder: '#566379',
    readySoft: '#E8F5EF',
    readyLine: '#A7D8C4',
    cleanSoft: '#E8F4F8',
    cleanLine: '#A6D3DF',
    inProgressSoft: '#F3EDFE',
    inProgressLine: '#D5C3FA',
    dirtySoft: '#FDF1F2',
    dirtyLine: '#EFB5BA',
    occupiedSoft: '#EDF0F4',
    occupiedLine: '#C3CCD8',
    pickupSoft: '#FCF5EA',
    pickupLine: '#EBC79C',
    outOfOrderSoft: '#EEF1F5',
    outOfOrderLine: '#C3CCD8',
  },
  dark: {
    ready: '#34D399',
    clean: '#22D3EE',
    inProgress: '#B9A2FC',
    dirty: '#FA8686',
    occupied: '#A3B1C4',
    pickup: '#FBBF24',
    outOfOrder: '#A3B1C4',
    readySoft: 'rgba(52, 211, 153, 0.14)',
    readyLine: 'rgba(52, 211, 153, 0.40)',
    cleanSoft: 'rgba(34, 211, 238, 0.14)',
    cleanLine: 'rgba(34, 211, 238, 0.40)',
    inProgressSoft: 'rgba(185, 162, 252, 0.14)',
    inProgressLine: 'rgba(185, 162, 252, 0.40)',
    dirtySoft: 'rgba(250, 134, 134, 0.14)',
    dirtyLine: 'rgba(250, 134, 134, 0.40)',
    occupiedSoft: 'rgba(163, 177, 196, 0.14)',
    occupiedLine: 'rgba(163, 177, 196, 0.40)',
    pickupSoft: 'rgba(251, 191, 36, 0.14)',
    pickupLine: 'rgba(251, 191, 36, 0.40)',
    outOfOrderSoft: 'rgba(163, 177, 196, 0.14)',
    outOfOrderLine: 'rgba(163, 177, 196, 0.40)',
  },
} as const

/** Dark navigation chrome (tab bar, sidebar). Dark in BOTH modes per the brief. */
export const shellV2 = {
  light: {
    bg: '#0D1728',
    surface: '#14213A',
    raised: '#1B2A45',
    line: '#2F4260',
    ink: '#F3F7FC',
    ink2: '#A8B6CA',
    ink3: '#8A9BB3',
  },
  dark: {
    bg: '#070D18',
    surface: '#0D1728',
    raised: '#14213A',
    line: '#2A3B51',
    ink: '#F3F7FC',
    ink2: '#A8B6CA',
    ink3: '#8A9BB3',
  },
} as const

export const aiV2 = {
  light: {
    primary: paletteV2.light.ai,
    secondary: '#0E7490',
    electric: '#2563EB',
    soft: paletteV2.light.aiSoft,
    line: paletteV2.light.aiLine,
    glow: 'rgba(124, 58, 237, 0.18)',
  },
  dark: {
    primary: paletteV2.dark.ai,
    secondary: '#22D3EE',
    electric: '#60A5FA',
    soft: paletteV2.dark.aiSoft,
    line: paletteV2.dark.aiLine,
    glow: 'rgba(167, 139, 250, 0.28)',
  },
} as const

/** Radii / spacing / touch sizes (px), matching the mobile scales. */
export const radiusV2 = { sm: 8, chip: 10, input: 12, control: 14, card: 16, hero: 18, sheet: 24, pill: 999 } as const
export const touchV2 = { min: 44, comfortable: 48, primary: 56 } as const

/** Flat `--dv2-*` CSS custom properties for a mode. The preview root sets these inline, so every
 *  V2 color has exactly one definition (this file) and the stylesheet only ever reads var(--dv2-*). */
export function designV2CssVars(mode: ModeV2): Record<string, string> {
  const p = paletteV2[mode]
  const s = statusV2[mode]
  const shell = shellV2[mode]
  const ai = aiV2[mode]
  const vars: Record<string, string> = {
    '--dv2-bg': p.background,
    '--dv2-surface': p.surface,
    '--dv2-surface-2': p.surfaceSecondary,
    '--dv2-text': p.textPrimary,
    '--dv2-text-2': p.textSecondary,
    '--dv2-text-3': p.textMuted,
    '--dv2-border': p.border,
    '--dv2-border-strong': p.borderStrong,
    '--dv2-primary': p.primary,
    '--dv2-primary-pressed': p.primaryPressed,
    '--dv2-primary-soft': p.primarySoft,
    '--dv2-primary-line': p.primaryLine,
    '--dv2-on-primary': p.onPrimary,
    '--dv2-destructive': p.destructive,
    '--dv2-on-destructive': p.onDestructive,
    '--dv2-nav': p.navSurface,
    '--dv2-shell-bg': shell.bg,
    '--dv2-shell-surface': shell.surface,
    '--dv2-shell-raised': shell.raised,
    '--dv2-shell-line': shell.line,
    '--dv2-shell-ink': shell.ink,
    '--dv2-shell-ink-2': shell.ink2,
    '--dv2-shell-ink-3': shell.ink3,
    '--dv2-ai': ai.primary,
    '--dv2-ai-soft': ai.soft,
    '--dv2-ai-line': ai.line,
    '--dv2-on-ai': p.onAi,
    '--dv2-shadow-card':
      mode === 'light' ? '0 1px 2px rgba(13, 23, 40, 0.06), 0 2px 8px rgba(13, 23, 40, 0.04)' : 'none',
    '--dv2-r-card': `${radiusV2.card}px`,
    '--dv2-r-hero': `${radiusV2.hero}px`,
    '--dv2-r-control': `${radiusV2.control}px`,
    '--dv2-r-input': `${radiusV2.input}px`,
    '--dv2-touch': `${touchV2.min}px`,
  }
  const statusNames = ['ready', 'clean', 'inProgress', 'dirty', 'occupied', 'pickup', 'outOfOrder'] as const
  for (const name of statusNames) {
    const kebab = name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
    vars[`--dv2-${kebab}`] = s[name]
    vars[`--dv2-${kebab}-soft`] = s[`${name}Soft`]
    vars[`--dv2-${kebab}-line`] = s[`${name}Line`]
  }
  return vars
}
