import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { buildShellNavGroups } from './shellNav'
import { designV2CssVars, paletteV2, shellV2, statusV2, type ModeV2 } from './designV2Tokens'
import { getAllowedHrefs, getAllowedNavItems, MORE_NAV_HREFS, PRIMARY_NAV_HREFS } from '../utils/navigation'

const webRoot = path.resolve(__dirname, '..', '..')
const read = (rel: string) => readFileSync(path.join(webRoot, rel), 'utf8')

const ROLES = ['gm', 'housekeeping_supervisor', 'housekeeper', 'engineer', 'chief_engineer', 'front_desk'] as const
const MODES: ModeV2[] = ['light', 'dark']

/* -- Navigation / RBAC --------------------------------------------------------------------- */

test('V2 sidebar shows exactly the destinations the legacy sidebar shows, for every base role', () => {
  for (const role of ROLES) {
    const allowed = getAllowedNavItems({ role, customRoleModules: null, frontDeskModules: null })
    const legacy = new Set([
      ...(allowed.some((i) => i.href === '/dashboard') ? ['/dashboard'] : []),
      ...allowed.filter((i) => PRIMARY_NAV_HREFS.includes(i.href)).map((i) => i.href),
      ...allowed.filter((i) => MORE_NAV_HREFS.includes(i.href)).map((i) => i.href),
    ])
    const v2 = buildShellNavGroups({ role, customRoleModules: null, frontDeskModules: null })
      .flatMap((g) => g.items.map((i) => i.href))
    assert.deepEqual(new Set(v2), legacy, `role ${role}`)
    assert.equal(new Set(v2).size, v2.length, `no duplicates for ${role}`)
  }
})

test('V2 sidebar never shows a route the role may not reach (single permission source)', () => {
  for (const role of ROLES) {
    const reachable = new Set(getAllowedHrefs({ role, customRoleModules: null, frontDeskModules: null }))
    for (const group of buildShellNavGroups({ role })) {
      for (const item of group.items) assert.ok(reachable.has(item.href), `${role} -> ${item.href}`)
    }
  }
})

test('V2 sidebar honors custom-role modules and hotel front-desk modules', () => {
  const custom = buildShellNavGroups({ role: 'engineer', customRoleModules: ['tasks'] }).flatMap((g) => g.items.map((i) => i.href))
  assert.deepEqual(custom.sort(), ['/dashboard', '/tasks'])
  const desk = buildShellNavGroups({ role: 'front_desk', frontDeskModules: ['logbook'] }).flatMap((g) => g.items.map((i) => i.href))
  assert.deepEqual(desk.sort(), ['/dashboard', '/logbook'])
})

test('no role means no destinations, and the housekeeper label stays My Rooms', () => {
  assert.deepEqual(buildShellNavGroups({ role: null }), [])
  const rooms = buildShellNavGroups({ role: 'housekeeper' }).flatMap((g) => g.items).find((i) => i.href === '/housekeeping')
  assert.equal(rooms?.label, 'My Rooms')
})

test('groups are Overview, Operations, Records in that order and never empty', () => {
  const groups = buildShellNavGroups({ role: 'gm' })
  assert.deepEqual(groups.map((g) => g.id), ['overview', 'operations', 'records'])
  assert.ok(groups.every((g) => g.items.length > 0))
})

/* -- Contrast of the nav chrome ------------------------------------------------------------- */

function lum(hex: string): number {
  const v = /^#([\da-f]{6})$/i.exec(hex)
  assert.ok(v, `opaque hex expected, got ${hex}`)
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const n = parseInt(v[1], 16)
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
}
const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)

test('sidebar text and the active indicator are legible on the dark slate in both modes', () => {
  for (const mode of MODES) {
    const s = shellV2[mode]
    for (const surface of [s.bg, s.surface, s.raised]) {
      assert.ok(ratio(s.ink, surface) >= 4.5, `${mode} ink on ${surface}`)
      assert.ok(ratio(s.ink2, surface) >= 4.5, `${mode} ink2 on ${surface}`)
      assert.ok(ratio(s.ink3, surface) >= 4.5, `${mode} ink3 on ${surface}`)
    }
    // Active bar is an essential non-text indicator: >= 3:1 against the bar behind it.
    assert.ok(ratio(paletteV2[mode].primary, s.bg) >= 3, `${mode} active indicator`)
    // The raised active tile must be visibly separate from the bar (and the active item also
    // gets a bold weight and an indicator bar, so selection is never color alone).
    assert.ok(ratio(s.raised, s.bg) >= 1.1, `${mode} active tile`)
  }
})

test('header surface text, search edge and focus ring meet contrast', () => {
  for (const mode of MODES) {
    const p = paletteV2[mode]
    assert.ok(ratio(p.textPrimary, p.surface) >= 4.5)
    assert.ok(ratio(p.textSecondary, p.surface) >= 4.5)
    assert.ok(ratio(p.textSecondary, p.surfaceSecondary) >= 4.5, 'property chip on secondary surface')
    assert.ok(ratio(p.borderStrong, p.surface) >= 3, 'search field edge')
    assert.ok(ratio(p.primary, p.surface) >= 3, 'focus ring on header')
    assert.ok(ratio(p.primary, p.background) >= 3, 'focus ring on content')
    assert.ok(ratio(p.onPrimary, p.primary) >= 4.5, 'skip link and primary button text')
    assert.ok(ratio(statusV2[mode].dirty, p.surface) >= 4.5, 'error text on card')
  }
})

test('every CSS variable the shell stylesheets read is defined by designV2CssVars', () => {
  const defined = new Set(Object.keys(designV2CssVars('light')))
  for (const file of ['components/design-v2/shell/shellV2.module.css', 'components/design-v2/shell/authV2.module.css']) {
    const css = read(file)
    for (const [, name] of css.matchAll(/var\((--dv2-[a-z0-9-]+)\)/g)) {
      assert.ok(defined.has(name), `${file} reads undefined ${name}`)
    }
  }
})

/* -- Stylesheet contract --------------------------------------------------------------------- */

for (const file of ['components/design-v2/shell/shellV2.module.css', 'components/design-v2/shell/authV2.module.css']) {
  test(`${path.basename(file)}: tokens only, no hex colors`, () => {
    const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '')
    assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(css), false)
    assert.equal(/\brgba?\(/.test(css.replace(/rgba\(0, 0, 0, 0\.25\)/, '')), false, 'only the tooltip shadow may use rgba')
  })

  test(`${path.basename(file)}: visible focus and forced-colors support`, () => {
    const css = read(file)
    assert.match(css, /:focus-visible/)
    assert.match(css, /forced-colors:\s*active/)
  })
}

test('shell stylesheet: responsive contract (rail, drawer, 44px targets, reduced motion)', () => {
  const css = read('components/design-v2/shell/shellV2.module.css')
  assert.match(css, /grid-template-columns:\s*248px/)
  assert.match(css, /\.shellRail\s*\{[^}]*72px/)
  assert.match(css, /@media \(max-width: 1023px\)[\s\S]*\.sidebar \{ display: none; \}/)
  assert.match(css, /\.menuButton \{ display: grid; \}/)
  assert.match(css, /min-height: var\(--dv2-touch\)/)
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\)[\s\S]*navIn/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*transition: none/)
  assert.match(css, /max-width: 1440px/)
  assert.match(css, /\.skipLink:focus/)
})

test('legacy token names are remapped only on chrome scopes, never globally', () => {
  const css = read('components/design-v2/shell/shellV2.module.css').replace(/\/\*[\s\S]*?\*\//g, '')
  for (const [, selector] of css.matchAll(/([^{}]+)\{[^}]*--(?:paper|surface|ink|line|accent|brand)\b:/g)) {
    assert.match(selector.trim(), /^\.chromeLight$/, `unexpected remap scope: ${selector.trim()}`)
  }
  const auth = read('components/design-v2/shell/authV2.module.css').replace(/\/\*[\s\S]*?\*\//g, '')
  for (const [, selector] of auth.matchAll(/([^{}]+)\{[^}]*--(?:paper|surface|ink|line|accent|brand)\b:/g)) {
    assert.match(selector.trim(), /^\.page$/, `unexpected remap scope: ${selector.trim()}`)
  }
  assert.equal(/:global\(/.test(css), false, 'no global selectors in the shell stylesheet')
  assert.equal(/(^|[},])\s*(body|html|:root)\b/m.test(css), false)
})

/* -- Flag isolation / legacy preserved -------------------------------------------------------- */

test('DashboardShell always renders the V2 shell: no flag, hotel setting or environment variable is consulted', () => {
  const src = read('components/shared/DashboardShell.tsx')
  assert.match(src, /return \(\s*<ShellV2/)
  assert.equal(/useDesignV2|isDesignV2|enabled_features|design_v2/.test(src), false, 'no activation logic may remain')
  assert.equal(/flex h-screen bg-paper/.test(src), false, 'the legacy shell markup is gone')
  assert.equal(/process\.env/.test(src), false, 'the shell must not read the environment')
  for (const file of ['components/design-v2/shell/ShellV2.tsx', 'components/design-v2/shell/SidebarV2.tsx', 'components/design-v2/shell/HeaderLeadingV2.tsx', 'components/design-v2/shell/AuthV2Scope.tsx']) {
    assert.equal(/process\.env/.test(read(file)), false, `${file} must not read env`)
  }
})

test('the legacy Header only changes when v2Leading is provided', () => {
  const src = read('components/shared/Header.tsx')
  assert.match(src, /v2Leading\?: React\.ReactNode/)
  assert.match(src, /className="md:hidden -ml-1 flex h-9 w-9/)
  assert.match(src, /\{!v2Leading && \(/)
  assert.match(src, /data-testid="environment-indicator"/)
})

test('login is always the V2 sign-in with the unchanged auth handlers', () => {
  const src = read('app/(auth)/login/page.tsx')
  assert.match(src, /<AuthV2Scope>/)
  assert.equal(/isDesignV2PreviewEnabled|DESIGN_V2_PREVIEW/.test(src), false)
  assert.equal(src.includes('<div className="min-h-screen grid grid-cols-1 lg:grid-cols-2 bg-paper">'), false, 'the legacy layout is gone')
  // One layout, the same handlers and the same sign-in methods.
  assert.equal((src.match(/handlePasswordLogin/g) ?? []).length >= 2, true)
  assert.equal((src.match(/handleMagicLink/g) ?? []).length >= 2, true)
  assert.match(src, /MOBILE_ONLY_ROLES\.has\(userRole\)/)
  assert.match(src, /signInWithPassword/)
  assert.match(src, /signInWithOtp/)
  assert.match(src, /getRedirectPath/)
  // V2 form labelled, password reveal named, errors announced.
  assert.match(src, /htmlFor="email-pw"/)
  assert.match(src, /aria-pressed=\{showPassword\}/)
  assert.match(src, /role="alert"/)
})

/* -- Accessibility structure ------------------------------------------------------------------ */

test('sidebar: landmarks, current page, collapsed tooltips and RBAC-gated settings', () => {
  const src = read('components/design-v2/shell/SidebarV2.tsx')
  assert.match(src, /<nav aria-label=\{t\('shellV2\.mainNavigation'\)\}/)
  assert.match(src, /aria-current=\{active \? 'page' : undefined\}/)
  assert.match(src, /Tooltip\.Root/)
  assert.match(src, /styles\.srOnly/, 'collapsed items keep an accessible name')
  assert.match(src, /canAccessSettings\(baseRole \?\? role\)/)
  assert.match(src, /aria-expanded=\{!rail\}/)
})

test('shell: skip link, main landmark target, Radix drawer with focus return and Escape/overlay close', () => {
  const src = read('components/design-v2/shell/ShellV2.tsx')
  assert.match(src, /href="#main-content"/)
  assert.match(src, /<main id="main-content" tabIndex=\{-1\}/)
  assert.match(src, /@radix-ui\/react-dialog/)
  assert.match(src, /onCloseAutoFocus/)
  assert.match(src, /menuRef\.current\?\.focus\(\)/)
  assert.match(src, /Dialog\.Title/)
  assert.match(src, /DRAWER_BREAKPOINT_PX = 1024/)
  assert.match(src, /RAIL_BREAKPOINT_PX = 1280/)
  const css = read('components/design-v2/shell/shellV2.module.css')
  assert.match(css, /@media \(max-width: 1023px\)/, 'CSS drawer breakpoint matches DRAWER_BREAKPOINT_PX')
})

test('header leading area: menu button named, search opens the existing palette, trail is a nav landmark', () => {
  const src = read('components/design-v2/shell/HeaderLeadingV2.tsx')
  assert.match(src, /aria-label=\{t\('header\.openMenu'\)\}/)
  assert.match(src, /new CustomEvent\('command-palette:open'\)/)
  assert.match(src, /aria-current="page"/)
  assert.match(src, /<nav aria-label=\{t\('shellV2\.youAreHere'\)\}/)
  assert.match(read('components/shared/CommandPalette.tsx'), /'command-palette:open'/)
})

/* -- i18n parity ------------------------------------------------------------------------------ */

test('shellV2 strings exist in English and Spanish and every used key resolves', async () => {
  const en = (await import('../../i18n/locales/en')).default as Record<string, any>
  const es = (await import('../../i18n/locales/es')).default as Record<string, any>
  assert.deepEqual(Object.keys(en.shellV2).sort(), Object.keys(es.shellV2).sort())
  for (const key of Object.keys(en.shellV2)) {
    assert.ok(String(en.shellV2[key]).length > 0 && String(es.shellV2[key]).length > 0, key)
    assert.notEqual(es.shellV2[key], en.shellV2[key], `${key} should be translated`)
  }
  const used = new Set<string>()
  for (const file of [
    'components/design-v2/shell/ShellV2.tsx',
    'components/design-v2/shell/SidebarV2.tsx',
    'components/design-v2/shell/HeaderLeadingV2.tsx',
    'lib/design/shellNav.ts',
  ]) {
    for (const [, key] of read(file).matchAll(/['"]shellV2\.([A-Za-z]+)['"]/g)) used.add(key)
  }
  assert.ok(used.size >= 8)
  for (const key of used) assert.ok(key in en.shellV2, `missing shellV2.${key}`)
})
