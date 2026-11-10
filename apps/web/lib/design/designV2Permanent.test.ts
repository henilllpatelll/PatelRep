import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { getRouteAccessDecision } from '../utils/routeGuard'

/* Design System V2 is the permanent design for every hotel and role. There is no tenant flag, preview variable or
   activation logic left to consult; these checks pin that nothing can bring the legacy shell or sign-in back. */

const webRoot = path.resolve(__dirname, '..', '..')
const read = (rel: string) => readFileSync(path.join(webRoot, rel), 'utf8')

const walk = (dir: string): string[] =>
  readdirSync(path.join(webRoot, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`
    if (['node_modules', '.next', 'e2e'].includes(name)) return []
    if (statSync(path.join(webRoot, rel)).isDirectory()) return walk(rel)
    return /\.(ts|tsx|css)$/.test(name) && !/\.test\.ts$/.test(name) ? [rel] : []
  })

const SOURCES = ['app', 'components', 'lib', 'stores'].flatMap(walk)

test('the activation modules and the preview route are gone', () => {
  for (const rel of [
    'lib/design/designV2.ts',
    'lib/design/designV2Activation.ts',
    'lib/design/useDesignV2.ts',
    'app/design-v2-preview/page.tsx',
  ]) {
    assert.equal(existsSync(path.join(webRoot, rel)), false, `${rel} must not exist`)
  }
})

test('no source reads the retired flag, the preview variable or the old decision functions', () => {
  const offenders = SOURCES.filter((f) =>
    /design_v2|DESIGN_V2_PREVIEW|isDesignV2Enabled|isDesignV2PreviewEnabled|useDesignV2\b|designV2Activation|resolveTenantDesignV2/.test(read(f)),
  )
  assert.deepEqual(offenders, [])
})

test('the dashboard shell always renders ShellV2, with no legacy chrome left in the file', () => {
  const src = read('components/shared/DashboardShell.tsx')
  assert.match(src, /<ShellV2 themeClasses=\{themeClasses\} legacyRedesigned=\{shellV2\}>/)
  assert.equal(/<Sidebar|<Header|bg-paper/.test(src), false)
})

test('sign-in is always the V2 form for every hotel', () => {
  const src = read('app/(auth)/login/page.tsx')
  assert.match(src, /<AuthV2Scope>/)
  assert.match(src, /data-testid="login-v2"/)
  assert.equal(/process\.env|isDesignV2/.test(src), false)
})

test('the retired preview route is no longer public, and the route guard is otherwise unchanged', () => {
  assert.equal(
    getRouteAccessDecision({ pathname: '/design-v2-preview', isAuthenticated: false, hasHotel: false, role: null }).type,
    'redirect',
  )
  for (const pathname of ['/', '/login', '/auth/callback', '/auth/reset-password']) {
    assert.deepEqual(getRouteAccessDecision({ pathname, isAuthenticated: false, hasHotel: false, role: null }), { type: 'allow' })
  }
})

test('the feature-flag registry no longer lists design_v2 but keeps the other flags', () => {
  const src = read('lib/featureRegistry.ts')
  assert.equal(/design_v2/.test(src), false)
  assert.match(src, /hk_ai_assistant/)
})

test('no env example documents a preview variable', () => {
  assert.equal(/DESIGN_V2/.test(read('.env.example')), false)
})
