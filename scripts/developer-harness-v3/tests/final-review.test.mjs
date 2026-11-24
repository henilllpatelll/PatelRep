// D3.2 final remediation — regression tests for the targeted Opus review of the subscription correction, glob matcher and environment allow-list.
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPolicyBundle, loadContractFile, validateContract } from '../authority/contract.mjs'
import { EvidenceLedger } from '../authority/evidence.mjs'
import { evaluate } from '../authority/evaluator.mjs'
import { diffPolicy } from '../authority/policy-version.mjs'
import { checkLauncherControlled } from '../authority/spend.mjs'
import { validateGlobList } from '../lib/paths.mjs'
import { NOW, buildPolicy, makeKeys, request, trustedFor } from './helpers.mjs'

const C = loadContractFile()
const KEYS = makeKeys()
const ACTIVE = buildPolicy({ keys: KEYS })
const GOOD = Object.freeze({ verified: true, verified_by: 'launcher', source: 'claude_subscription_oauth', plan: 'claude_max_5x', extra_usage_enabled: false })
const launch = (launchBlock, params) => evaluate({ policy: ACTIVE.policy, request: request('launch_claude_session', params ? { params } : {}), trusted: trustedFor('orchestrator', { launch: launchBlock }), now: NOW, ledger: new EvidenceLedger() })
const L = { NODE_OPTIONS: 'trusted_launcher', HTTPS_PROXY: 'trusted_launcher' }

test('final review #1/#2: origins are looked up by EXACT name; case-variant spellings and ambiguous origin reports are refused', () => {
  const bad = ['ENV.VALUE_NOT_FROM_TRUSTED_LAUNCHER:HTTPS_PROXY']
  assert.deepEqual(checkLauncherControlled(['https_proxy'], { HTTPS_PROXY: 'trusted_launcher' }, [], C), bad, 'a lowercase variable the launcher never reported')
  assert.deepEqual(checkLauncherControlled(['https_proxy'], { https_proxy: 'trusted_launcher' }, [], C), [], 'reported under its own exact spelling')
  assert.deepEqual(checkLauncherControlled(['HTTPS_PROXY', 'https_proxy'], { ...L, https_proxy: 'trusted_launcher' }, [], C), bad, 'two spellings of one controlled variable are ambiguous')
  assert.deepEqual(checkLauncherControlled(['https_proxy', 'HTTPS_PROXY'], L, [], C), bad)
  const nodeBad = ['ENV.VALUE_NOT_FROM_TRUSTED_LAUNCHER:NODE_OPTIONS']
  assert.deepEqual(checkLauncherControlled(['NODE_OPTIONS'], { NODE_OPTIONS: 'trusted_launcher', node_options: 'repository' }, [], C), nodeBad, 'key order must not matter')
  assert.deepEqual(checkLauncherControlled(['NODE_OPTIONS'], { node_options: 'repository', NODE_OPTIONS: 'trusted_launcher' }, [], C), nodeBad)
  assert.deepEqual(checkLauncherControlled(['NODE_OPTIONS'], { NODE_OPTIONS: 'trusted_launcher', node_options: 'trusted_launcher' }, [], C), nodeBad, 'even two matching labels are an ambiguous report')
  assert.deepEqual(checkLauncherControlled(['NODE_OPTIONS'], Object.create({ NODE_OPTIONS: 'trusted_launcher' }), [], C), nodeBad, 'inherited labels do not count')
  assert.equal(launch({ env_names: ['PATH', 'HTTPS_PROXY'], settings: {}, auth: GOOD, env_value_origins: { HTTPS_PROXY: 'trusted_launcher' } }).decision, 'allow')
  assert.equal(launch({ env_names: ['PATH', 'https_proxy', 'HTTPS_PROXY'], settings: {}, auth: GOOD, env_value_origins: { HTTPS_PROXY: 'trusted_launcher' } }).decision, 'deny')
  assert.equal(launch({ env_names: ['PATH', 'NODE_OPTIONS'], settings: {}, auth: GOOD, env_value_origins: { NODE_OPTIONS: 'trusted_launcher', node_options: 'repository' } }).decision, 'deny')
  assert.deepEqual(launch({ env_names: ['PATH'], settings: {}, auth: GOOD, env_value_origins: { NODE_OPTIONS: 5 } }).reason_codes, ['INPUT.MALFORMED:launch'], 'origin labels must be strings')
})

test('final review #3: repository-controlled settings.env may set only a tiny inert list; PATH, HOME, XDG_*, SHELL, TMPDIR and friends are refused', () => {
  assert.deepEqual(C.settings_env_inert_allowlist.slice().sort(), ['CI', 'LANG', 'NODE_ENV', 'TERM', 'TZ'])
  const withEnv = (env) => launch({ env_names: ['PATH', 'HOME'], settings: { env }, auth: GOOD })
  assert.equal(withEnv({ TZ: 'UTC', LANG: 'en_US.UTF-8' }).decision, 'allow')
  for (const n of ['PATH', 'HOME', 'SHELL', 'TMPDIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'USER', 'LD_PRELOAD', 'PYTHONPATH', 'BASH_ENV', 'GIT_CONFIG_GLOBAL', 'path']) {
    const d = withEnv({ [n]: '/repo/evil' })
    assert.equal(d.decision, 'deny', n)
    assert.ok(d.reason_codes.some((c) => c.startsWith('ENV.SETTINGS_ENV_NOT_ALLOWED') || c.startsWith('ENV.NAME_NOT_ALLOWLISTED')), `${n}: ${d.reason_codes}`)
  }
  assert.deepEqual(withEnv({ PATH: 'x' }).reason_codes.filter((c) => c.startsWith('ENV.SETTINGS_ENV_NOT_ALLOWED')), ['ENV.SETTINGS_ENV_NOT_ALLOWED:PATH'])
  assert.deepEqual(withEnv('not-an-object').reason_codes, ['INPUT.MALFORMED:launch'])
  const widened = structuredClone(C); widened.settings_env_inert_allowlist.push('PATH')
  const b = buildPolicyBundle({ contract: widened, trusted_keys: KEYS.trusted_keys, parent_revision: ACTIVE.revision })
  assert.ok(diffPolicy(ACTIVE.policy, b).changes.some((x) => x.code === 'SETTINGS_ENV_ALLOWLIST_WIDENED' && x.severity === 'weakening'))
  const lower = structuredClone(C); lower.settings_env_inert_allowlist = ['lower']; assert.notDeepEqual(validateContract(lower), [])
})

test('final review #4: contract globs that can never match a normalized path are rejected', () => {
  for (const g of ['dir/', '/abs/**', 'a//b', './x', '..', 'a/./b', 'a/../b', 'a/***/b', '']) assert.ok(validateGlobList([g], 'x').length > 0, JSON.stringify(g))
  for (const g of ['dir/**', '**/CLAUDE.md', '.github/**', 'apps/api/**/agent_*/**', '**/.env*', 'supabase/seed*']) assert.deepEqual(validateGlobList([g], 'x'), [], g)
  const bad = structuredClone(C); bad.protected_paths.push('typo/'); assert.notDeepEqual(validateContract(bad), [])
})

test('final review #5: plan identities are lowercase, canonical and duplicate-free', () => {
  const dup = structuredClone(C); dup.subscription.known_plans.push('claude_pro'); assert.notDeepEqual(validateContract(dup), [])
  const dup2 = structuredClone(C); dup2.subscription.authorized_plans = ['claude_max_5x', 'claude_max_5x']; assert.notDeepEqual(validateContract(dup2), [])
  const upper = structuredClone(C); upper.subscription.known_plans.push('Claude_Max'); upper.subscription.authorized_plans = ['Claude_Max']; assert.notDeepEqual(validateContract(upper), [])
})

test('final review #6: env_value_origins is trusted-only; a request cannot carry it', () => {
  const d = launch({ env_names: ['PATH', 'NODE_OPTIONS'], settings: {}, auth: GOOD }, { env_value_origins: { NODE_OPTIONS: 'trusted_launcher' } })
  assert.deepEqual(d.reason_codes, ['INPUT.MALFORMED:params'])
})

test('final review #7: the trusted launch block is shape-checked before any name is spread or compared', () => {
  for (const bad of [{ env_names: 'NODE_OPTIONS', settings: {}, auth: GOOD }, { env_names: [1], settings: {}, auth: GOOD }, { env_names: [], settings: [], auth: GOOD }, { env_names: [], settings: {}, auth: 'x' },
    { env_names: [], settings: { env: [] }, auth: GOOD }, { env_names: [], settings: {}, auth: GOOD, extra: 1 }, 'launch', 7]) assert.deepEqual(launch(bad).reason_codes, ['INPUT.MALFORMED:launch'], JSON.stringify(bad))
})
