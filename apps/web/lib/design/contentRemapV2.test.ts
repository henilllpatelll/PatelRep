import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { applyContentScopeV2 } from './contentScopeV2'
import { designV2CssVars } from './designV2Tokens'

const webRoot = path.resolve(__dirname, '..', '..')
const read = (rel: string) => readFileSync(path.join(webRoot, rel), 'utf8')
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

const REMAP = 'components/design-v2/content/contentRemapV2.css'
const SCOPE = "body[data-dv2-content][data-dv2-mode"

test('content remap: every rule is scoped to the V2 body attributes, never global', () => {
  const css = strip(read(REMAP))
  const selectors = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim()).filter(Boolean)
  assert.ok(selectors.length >= 2)
  for (const selector of selectors) {
    assert.ok(selector.startsWith(SCOPE), `unscoped selector: ${selector}`)
  }
  assert.equal(/(^|[},\s])(:root|html|\*)\s*[{,]/.test(css), false)
  assert.equal(/!important/.test(css), false, 'no !important')
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(css), false, 'no hex colors: only var(--dv2-*)')
  assert.equal(/:global\(/.test(css), false)
})

test('content remap: covers every legacy token family the pages and Tailwind use', () => {
  const css = read(REMAP)
  for (const token of [
    '--paper', '--surface', '--surface-2', '--surface-3', '--line', '--line-2', '--ink', '--ink-2', '--ink-3', '--ink-4',
    '--accent', '--accent-soft', '--accent-line', '--brand', '--ready', '--caution', '--alert', '--info', '--progress',
    '--blocked', '--ai', '--ai-soft', '--ai-line', '--r-lg', '--shadow-sm',
  ]) {
    assert.match(css, new RegExp(`${token}:\\s*var\\(--dv2-|${token}:\\s*(color-mix|none)`), `${token} is not remapped`)
  }
})

test('content remap: the legacy serif display face maps to the sans stack', () => {
  assert.match(read(REMAP), /--font-display:\s*var\(--font-sans\);/)
})

test('content remap: every var(--dv2-*) it reads is defined by designV2CssVars', () => {
  const used = new Set([...read(REMAP).matchAll(/var\((--dv2-[a-z0-9-]+)\)/g)].map((m) => m[1]))
  const light = designV2CssVars('light')
  const dark = designV2CssVars('dark')
  for (const name of used) {
    assert.ok(name in light && name in dark, `${name} is not a defined V2 variable`)
  }
})

test('applyContentScopeV2 sets and fully removes the attributes and variables', () => {
  const props = new Map<string, string>()
  const attrs = new Map<string, string>()
  const body = {
    style: { setProperty: (k: string, v: string) => props.set(k, v), removeProperty: (k: string) => props.delete(k) },
    setAttribute: (k: string, v: string) => attrs.set(k, v),
    removeAttribute: (k: string) => attrs.delete(k),
  } as unknown as HTMLElement
  const vars = { ...designV2CssVars('dark'), colorScheme: 'dark' }
  const cleanup = applyContentScopeV2(body, 'dark', vars)
  assert.equal(attrs.get('data-dv2-mode'), 'dark')
  assert.ok(attrs.has('data-dv2-content'))
  assert.equal(props.get('--dv2-primary'), designV2CssVars('dark')['--dv2-primary'])
  assert.equal([...props.keys()].every((k) => k.startsWith('--dv2-')), true, 'only --dv2-* variables are set')
  cleanup()
  assert.equal(props.size, 0)
  assert.equal(attrs.size, 0)
})

test('flag isolation: only ShellV2 turns the remap on, and only when the tenant-aware decision mounted it', () => {
  const shell = read('components/design-v2/shell/ShellV2.tsx')
  assert.match(shell, /applyContentScopeV2\(document\.body/)
  assert.match(shell, /import '\.\.\/content\/contentRemapV2\.css'/)
  const dashboardShell = read('components/shared/DashboardShell.tsx')
  assert.match(dashboardShell, /if \(designV2\) \{\s*return \(\s*<ShellV2/)
  assert.equal(/applyContentScopeV2|data-dv2-content/.test(dashboardShell), false)
})

test('ShellV2 root never carries theme-dark / accent-* (they would shadow the body remap)', () => {
  const shell = read('components/design-v2/shell/ShellV2.tsx')
  assert.match(shell, /startsWith\('density-'\)/)
  assert.match(shell, /cx\(styles\.root, \.\.\.rootThemeClasses\)/)
  assert.equal(/cx\(styles\.root, \.\.\.themeClasses\)/.test(shell), false)
})

test('dashboard: the V2 layout is behind the V2 decision and the legacy return is untouched', () => {
  const src = read('components/dashboard/SimplifiedDashboard.tsx')
  assert.match(src, /if \(isDesignV2Enabled\(\)\) \{/)
  assert.match(src, /<div className="flex flex-col gap-4 h-full min-h-0">/)
  assert.match(src, /<DashboardGreeting/)
})

test('dashboard: V2 sections never fetch and never call AI on mount', () => {
  const src = read('components/dashboard/DashboardV2Sections.tsx')
  assert.equal(/useQuery|useMutation|fetch\(|aiApi|useEffect/.test(src), false)
})

test('content remap: raw gray utilities are re-pointed to V2 tokens without touching switch thumbs or backdrops', () => {
  const css = strip(read(REMAP))
  for (const cls of ['text-gray-700', 'text-gray-400', 'bg-gray-50', 'bg-gray-100', 'border-gray-200', 'border-gray-300']) {
    assert.ok(css.includes(`.${cls}`), `.${cls} is not overridden`)
  }
  assert.equal(/(^|[\s,])\.bg-white\s*[{,]/.test(css), false, 'bare .bg-white must not be overridden (switch thumb)')
  assert.equal(/stone-900|bg-black/.test(css), false, 'backdrops are not overridden')
})

test('phase 8: micro-labels are sentence case only for the uppercase + tracking pair, never for bare uppercase', () => {
  const css = strip(read(REMAP))
  assert.match(css, /\.uppercase\[class\*="tracking-"\]\s*\{[^}]*text-transform:\s*none/)
  assert.equal(/(^|[\s,])\.uppercase\s*\{/.test(css), false, 'bare .uppercase must not be overridden')
})

test('phase 8: the route error boundary retry button takes the V2 primary, scoped to its data hook', () => {
  const css = strip(read(REMAP))
  assert.match(css, /\[data-error-retry\]\s*\{[^}]*var\(--dv2-primary\)/)
  assert.match(read('app/(dashboard)/error.tsx'), /data-error-retry/)
})

test('phase 8: the dashboard room-list drawer is a labelled modal dialog with a focus trap', () => {
  const src = read('components/dashboard/SimplifiedDashboard.tsx')
  const drawer = src.slice(src.indexOf('function RoomListDrawer('), src.indexOf('function RoomListDrawer(') + 2600)
  assert.match(drawer, /useModalFocusTrap\(panelRef, true, onClose\)/)
  assert.match(drawer, /role="dialog"/)
  assert.match(drawer, /aria-modal="true"/)
  assert.match(drawer, /aria-labelledby=\{titleId\}/)
})

test('phase 8: dialogs that declare aria-modal restore focus to their opener', () => {
  const hook = read('lib/hooks/useModalFocusTrap.ts')
  // opener tracking is a passive focusin listener (no render-phase ref writes) and close restores only a connected node
  assert.match(hook, /addEventListener\('focusin'/)
  assert.match(hook, /export function getFocusReturnTarget/)
  assert.match(hook, /previouslyFocused\?\.isConnected/)
  for (const file of [
    'app/(dashboard)/sop/page.tsx',
    'components/engineering/BulkArchiveModal.tsx',
    'components/engineering/AssetDetailModal.tsx',
    'components/engineering/CreateWorkOrderDrawer.tsx',
    'components/ai/SOPQueryModal.tsx',
    'components/dashboard/SimplifiedDashboard.tsx',
  ]) {
    assert.match(read(file), /useModalFocusTrap\(/, `${file} must use the shared focus trap`)
  }
  // the command palette is a Radix dialog with no Trigger, so it must hand focus back itself
  const palette = read('components/shared/CommandPalette.tsx')
  assert.match(palette, /onCloseAutoFocus/)
  assert.match(palette, /getFocusReturnTarget\(\)/)
})

test('phase 8: the legacy serif-italic headline accent renders upright in V2 (only the exact class pair)', () => {
  const css = strip(read(REMAP))
  assert.match(css, /\.font-display\.italic\s*\{[^}]*font-style:\s*normal/)
  assert.equal(/(^|[\s,])\.italic\s*\{/.test(css), false, 'bare .italic must not be overridden')
})
