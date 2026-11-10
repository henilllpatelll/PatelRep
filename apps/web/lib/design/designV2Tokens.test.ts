import assert from 'node:assert/strict'
import test from 'node:test'
import { aiV2, designV2CssVars, paletteV2, shellV2, statusV2, type ModeV2 } from './designV2Tokens'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

type Rgba = [number, number, number, number]

function parse(color: string): Rgba {
  const hex = /^#([\da-f]{6})$/i.exec(color)
  if (hex) {
    const v = hex[1]
    return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16), 1]
  }
  const rgba = /^rgba?\(([^)]+)\)$/i.exec(color)
  assert.ok(rgba, `unsupported color ${color}`)
  const parts = rgba[1].split(',').map((p) => Number(p.trim()))
  return [parts[0], parts[1], parts[2], parts[3] ?? 1]
}

function over(fg: string, bg: string): [number, number, number] {
  const f = parse(fg)
  const b = parse(bg)
  assert.equal(b[3], 1, 'backgrounds must be opaque')
  return [0, 1, 2].map((i) => f[i] * f[3] + b[i] * (1 - f[3])) as [number, number, number]
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** WCAG contrast of fg over fill, where fill (maybe translucent) sits on an opaque base. */
function contrast(fg: string, fill: string, base = fill): number {
  const fillRgb = parse(fill)[3] === 1 ? (parse(fill).slice(0, 3) as [number, number, number]) : over(fill, base)
  const fgRgb = parse(fg)[3] === 1 ? (parse(fg).slice(0, 3) as [number, number, number]) : over(fg, `#${fillRgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`)
  const a = luminance(fgRgb)
  const b = luminance(fillRgb)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

const MODES: ModeV2[] = ['light', 'dark']
const STATUS = ['ready', 'clean', 'inProgress', 'dirty', 'occupied', 'pickup', 'outOfOrder'] as const

// The mobile file is loaded dynamically (non-literal specifier) because the web Docker build copies
// only apps/web: a static import would break `next build`'s type-check there. In a full checkout
// (CI, local) the file exists and the drift check runs; in the web-only context it is skipped.
const MOBILE_TOKENS = path.resolve(__dirname, '../../../mobile/components/shared/tokensV2.ts')

test('web V2 tokens match mobile V2 tokens value-for-value (no drift)', async (t) => {
  if (!existsSync(MOBILE_TOKENS)) return t.skip('apps/mobile is not present in this checkout')
  const mobile = await import(pathToFileURL(MOBILE_TOKENS).href)
  assert.deepEqual(paletteV2, mobile.paletteV2)
  assert.deepEqual(statusV2, mobile.statusV2)
  for (const mode of MODES) {
    const theme = mobile.getThemeTokensV2(mode)
    assert.deepEqual(shellV2[mode], theme.shell)
    assert.deepEqual(aiV2[mode], theme.ai)
  }
})

for (const mode of MODES) {
  const p = paletteV2[mode]
  const s = statusV2[mode]
  const surfaces = [p.background, p.surface, p.surfaceSecondary]

  test(`${mode}: text tiers are >= 4.5:1 on every surface`, () => {
    for (const bg of surfaces) {
      for (const fg of [p.textPrimary, p.textSecondary, p.textMuted]) {
        assert.ok(contrast(fg, bg) >= 4.5, `${fg} on ${bg} = ${contrast(fg, bg).toFixed(2)}`)
      }
    }
  })

  test(`${mode}: primary action text and filled labels are readable`, () => {
    for (const bg of surfaces) assert.ok(contrast(p.primary, bg) >= 4.5, `primary on ${bg}`)
    assert.ok(contrast(p.onPrimary, p.primary) >= 4.5)
    assert.ok(contrast(p.onPrimary, p.primaryPressed) >= 4.5)
    assert.ok(contrast(p.onDestructive, p.destructive) >= 4.5)
    assert.ok(contrast(p.onAi, p.ai) >= 4.5)
    for (const bg of surfaces) {
      assert.ok(contrast(p.primary, p.primarySoft, bg) >= 4.5, `primary on soft over ${bg}`)
      assert.ok(contrast(p.ai, p.aiSoft, bg) >= 4.5, `ai on soft over ${bg}`)
    }
  })

  test(`${mode}: form-field edge is >= 3:1 on every surface`, () => {
    for (const bg of surfaces) assert.ok(contrast(p.borderStrong, bg) >= 3, `${p.borderStrong} on ${bg}`)
  })

  test(`${mode}: every status reads >= 4.5:1 on its soft fill and on the surfaces`, () => {
    for (const name of STATUS) {
      const fg = s[name]
      const soft = s[`${name}Soft`]
      for (const bg of surfaces) {
        assert.ok(contrast(fg, soft, bg) >= 4.5, `${name} on soft over ${bg} = ${contrast(fg, soft, bg).toFixed(2)}`)
        assert.ok(contrast(fg, bg) >= 4.5, `${name} on ${bg}`)
      }
    }
  })

  test(`${mode}: dark navigation chrome text is readable`, () => {
    const shell = shellV2[mode]
    for (const fg of [shell.ink, shell.ink2, shell.ink3]) {
      assert.ok(contrast(fg, shell.bg) >= 4.5, `${fg} on shell`)
    }
    assert.ok(contrast(shell.ink, shell.raised) >= 4.5)
    assert.ok(contrast(shell.ink2, shell.raised) >= 4.5)
  })
}

test('CSS variables expose every status triplet and key surface for both modes', () => {
  for (const mode of MODES) {
    const vars = designV2CssVars(mode)
    assert.equal(vars['--dv2-bg'], paletteV2[mode].background)
    assert.equal(vars['--dv2-primary'], paletteV2[mode].primary)
    assert.equal(vars['--dv2-in-progress'], statusV2[mode].inProgress)
    assert.equal(vars['--dv2-out-of-order-soft'], statusV2[mode].outOfOrderSoft)
    for (const name of ['ready', 'clean', 'in-progress', 'dirty', 'occupied', 'pickup', 'out-of-order']) {
      for (const suffix of ['', '-soft', '-line']) {
        assert.ok(vars[`--dv2-${name}${suffix}`], `missing --dv2-${name}${suffix}`)
      }
    }
    for (const value of Object.values(vars)) assert.ok(value.length > 0)
  }
})

test('uses the exact headline palette from the V2 brief', () => {
  assert.equal(paletteV2.light.background, '#F6F8FC')
  assert.equal(paletteV2.light.primary, '#2563EB')
  assert.equal(paletteV2.light.textPrimary, '#0D1728')
  assert.equal(paletteV2.light.navSurface, '#0D1728')
  assert.equal(paletteV2.light.ai, '#7C3AED')
  assert.equal(paletteV2.dark.background, '#0B1220')
  assert.equal(paletteV2.dark.primary, '#60A5FA')
  assert.equal(paletteV2.dark.ai, '#A78BFA')
})
