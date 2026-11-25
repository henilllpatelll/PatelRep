// D3.3 defect D-1 / D-2 regressions: persisted host state is read back through the SAME path its writer uses.
// D-1: four readers passed `(v) => v && v.schema` to readJsonState, which accepts only a boolean `true`, so every record read as CORRUPT
// (doctor showed NOT_RUN for a current PASS; the owner attestation could never be read back). All fixtures are synthetic: no VM, no login,
// no subscription probe.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { atomicWriteJson, readJsonState } from '../lib/atomic.mjs'
import * as R from '../isolation/acceptance-rules.mjs'
import { persistAcceptance, readAcceptanceStatus, SCHEMA } from '../isolation/acceptance.mjs'
import { consumedMarker, consumeOwnerAttestation, readSubscriptionState, recordOwnerAttestation } from '../isolation/subscription-probe.mjs'
import { ATTESTATION_TTL_MS, attestationStatus, buildOwnerAttestation, isSubscriptionStateRecord, nextGovernorState, SUBSCRIPTION_STATE_SCHEMA } from '../runtime/subscription-governor.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const V3 = path.resolve(HERE, '..')
const EVIDENCE = path.resolve(HERE, '..', '..', '..', 'docs', 'developer-harness-v3', 'evidence')
const NOW = Date.parse('2026-11-25T08:00:00.000Z')
const NONCE = '3f2c8a1e-5b7d-4c9a-8e21-0d6f4b9a7c13'
const G = 'a'.repeat(64); const C = 'c'.repeat(64)
const tmp = (fn) => { const d = mkdtempSync(path.join(os.tmpdir(), 'dh3-state-')); try { return fn(d) } finally { rmSync(d, { recursive: true, force: true }) } }
const scenarios = (over = {}) => Object.fromEntries(Array.from({ length: 13 }, (_, i) => [i + 1, { verdict: 'PASS', problems: [], evidence: {}, ...(over[i + 1] ?? {}) }]))
const passDoc = (o = {}) => ({ schema: SCHEMA, probe_version: R.PROBE_VERSION, started_at: '2026-11-25T07:35:35.961Z', verdict: 'PASS', scenarios: scenarios(),
  identity: { candidate: { closure: { digest: C } }, vm_image: { golden_sha256_now: G } }, ...o })
const PROV = { golden_sha256: G }

test('D-1: a current PASS written by persistAcceptance is recognised by the doctor reader', () => tmp((d) => {
  assert.deepEqual(readAcceptanceStatus(d, PROV, C), { current: false, status: 'NOT_RUN', reasons: [] }, 'no record yet')
  persistAcceptance(d, passDoc())
  assert.deepEqual(readAcceptanceStatus(d, PROV, C), { current: true, status: 'PASS', reasons: [] })
}))

test('D-1: older evidence is STALE, never green (probe version, golden image, trusted code)', () => tmp((d) => {
  persistAcceptance(d, passDoc())
  assert.deepEqual(readAcceptanceStatus(d, PROV, 'd'.repeat(64)), { current: false, status: 'STALE', reasons: ['TRUSTED_CODE_CHANGED'] })
  assert.deepEqual(readAcceptanceStatus(d, { golden_sha256: 'b'.repeat(64) }, C).reasons, ['GOLDEN_IMAGE_CHANGED'])
  assert.deepEqual(readAcceptanceStatus(d, null, C).reasons, ['GOLDEN_IMAGE_CHANGED'])
  persistAcceptance(d, passDoc({ started_at: '2026-11-25T07:40:00.000Z', probe_version: 2 }))
  assert.deepEqual(readAcceptanceStatus(d, PROV, C), { current: false, status: 'STALE', reasons: ['PROBE_VERSION'] })
}))

test('D-1: malformed, wrong-schema or self-inconsistent evidence fails closed (INVALID / its own non-PASS verdict)', () => tmp((d) => {
  const latest = path.join(d, 'isolation-acceptance.json')
  const raw = (text) => { writeFileSync(latest, text); return readAcceptanceStatus(d, PROV, C) }
  for (const [label, text] of [['truncated JSON', '{"schema":'], ['array', '[]'], ['null', 'null'], ['string', '"PASS"'],
    ['wrong schema', JSON.stringify(passDoc({ schema: 'patelrep.developer-harness-v3.isolation-acceptancE' }))],
    ['missing schema', JSON.stringify({ ...passDoc(), schema: undefined })], ['missing scenarios', JSON.stringify({ ...passDoc(), scenarios: undefined })],
    ['bad started_at', JSON.stringify(passDoc({ started_at: 'yesterday' }))], ['non-integer probe version', JSON.stringify(passDoc({ probe_version: '3' }))],
    ['lower-case verdict', JSON.stringify(passDoc({ verdict: 'pass' }))]]) {
    const s = raw(text)
    assert.equal(s.current, false, label); assert.equal(s.status, 'INVALID', label)
  }
  // the label says PASS but a scenario does not: never current
  assert.deepEqual(raw(JSON.stringify(passDoc({ scenarios: scenarios({ 9: { verdict: 'FAIL' } }) }))), { current: false, status: 'INVALID', reasons: ['SCENARIO_VERDICTS_INCONSISTENT'] })
  const twelve = scenarios(); delete twelve[13]
  assert.equal(raw(JSON.stringify(passDoc({ scenarios: twelve }))).status, 'INVALID', 'all 13 scenarios are required')
  assert.deepEqual(raw(JSON.stringify(passDoc({ verdict: 'NOT_RUN', scenarios: {} }))), { current: false, status: 'NOT_RUN', reasons: [] })
  assert.equal(raw(JSON.stringify(passDoc({ verdict: 'FAIL' }))).status, 'FAIL')
}))

test('D-1: the committed real-VM evidence parses through the exact validators (run 2 PASS, run 1 STALE, the refusal NOT_RUN)', () => {
  const read = (f) => JSON.parse(readFileSync(path.join(EVIDENCE, f), 'utf8'))
  const run2 = read('isolation-acceptance-run2-20261125T073535Z.json')
  assert.equal(R.isAcceptanceRecord(run2), true)
  const prov2 = { golden_sha256: run2.identity.vm_image.golden_sha256_recorded }
  assert.deepEqual(R.acceptanceStatus(run2, prov2, run2.identity.candidate.closure.digest), { current: true, status: 'PASS', reasons: [] })
  assert.equal(R.acceptanceStatus(run2, prov2, 'e'.repeat(64)).status, 'STALE', 'a closure change (e.g. these fixes) makes run 2 stale')
  const run1 = read('isolation-acceptance-run1-20261124T233915Z.json')
  assert.notEqual(R.acceptanceStatus(run1, prov2, run2.identity.candidate.closure.digest).current, true)
  const refused = read('isolation-acceptance-notrun-20261125T003628Z.json')
  assert.equal(R.isAcceptanceRecord(refused), true); assert.equal(R.acceptanceStatus(refused, prov2, 'x').status, 'NOT_RUN')
})

test('D-1: every readJsonState validator returns a strict boolean (never a truthy schema string)', () => {
  const cases = [passDoc(), { schema: SCHEMA }, null, undefined, 0, '', [], 'x', { schema: SUBSCRIPTION_STATE_SCHEMA }, { schema: SUBSCRIPTION_STATE_SCHEMA, state: 'nope' }]
  for (const v of cases) {
    assert.equal(typeof R.isAcceptanceRecord(v), 'boolean', JSON.stringify(v))
    assert.equal(typeof isSubscriptionStateRecord(v), 'boolean', JSON.stringify(v))
  }
  // static audit of the trusted code: no readJsonState call may pass the `(v) => v && v.<field>)` form that returned a string
  const offenders = []
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { if (e.name !== 'tests') walk(p) } else if (e.name.endsWith('.mjs')) {
        for (const [i, line] of readFileSync(p, 'utf8').split('\n').entries()) if (/readJsonState\(.*\(v\) => v && v\.\w+\)/.test(line)) offenders.push(`${path.relative(V3, p)}:${i + 1}`)
      }
    }
  }
  walk(V3)
  assert.deepEqual(offenders, [])
})

test('D-1: governor state written by nextGovernorState reads back; malformed or wrong-schema state is CORRUPT', () => tmp((d) => {
  const f = path.join(d, 'subscription.json')
  assert.equal(readSubscriptionState(f).code, 'STATE.ABSENT')
  const gov = nextGovernorState(null, { state: 'available', reason_codes: [], extra_usage: { enabled: false, basis: 'SYNTHETIC' } }, { now: NOW })
  atomicWriteJson(f, gov)
  const back = readSubscriptionState(f)
  assert.equal(back.ok, true); assert.deepEqual(back.value, gov); assert.equal(back.value.extra_usage.verified_at, NOW)
  for (const [label, v] of [['wrong schema', { ...gov, schema: 'patelrep.developer-harness-v3.subscription' }], ['unknown state', { ...gov, state: 'fine' }],
    ['extra usage not an object', { ...gov, extra_usage: 'off' }], ['extra usage enabled is a string', { ...gov, extra_usage: { enabled: 'false', verified_at: NOW } }],
    ['verified fact without a time', { ...gov, extra_usage: { enabled: false, verified_at: null } }], ['missing verified_at', { ...gov, extra_usage: { enabled: false } }],
    ['next_eligible_at a string', { ...gov, next_eligible_at: 'soon' }], ['attestation an array', { ...gov, owner_attestation: [] }], ['array', [gov]]]) {
    atomicWriteJson(f, v); assert.equal(readSubscriptionState(f).code, 'STATE.CORRUPT', label)
  }
  writeFileSync(f, '{"schema":"patelrep'); assert.equal(readSubscriptionState(f).code, 'STATE.CORRUPT', 'truncated')
  // readJsonState's strict contract is unchanged: a truthy non-boolean validator result is still refused
  atomicWriteJson(f, gov); assert.equal(readJsonState(f, (v) => v.schema).code, 'STATE.CORRUPT')
}))

test('D-1: a valid owner attestation reads back and is consumed exactly once; governor state is kept', () => tmp((d) => {
  const f = path.join(d, 'subscription.json')
  const blocked = { schema: SUBSCRIPTION_STATE_SCHEMA, state: 'unauthorized_billing', next_eligible_at: null, extra_usage: { enabled: true, basis: 'SYNTHETIC', verified_at: NOW - 1000 } }
  atomicWriteJson(f, blocked)
  const r = recordOwnerAttestation(f, { now: NOW, nonce: NONCE })
  assert.equal(r.ok, true); assert.equal(r.attestation.nonce, NONCE)
  const back = readSubscriptionState(f)
  assert.equal(back.ok, true); assert.equal(back.value.state, 'unauthorized_billing', 'a blocked governor survives an attestation'); assert.equal(back.value.next_eligible_at, null)
  assert.deepEqual(attestationStatus(back.value.owner_attestation, NOW + 60000), { ok: true })
  assert.equal(consumeOwnerAttestation(f, { now: NOW + 60000, nonce: 'other' }).code, 'ATTESTATION.NONCE_CHANGED')
  const c = consumeOwnerAttestation(f, { now: NOW + 60000, nonce: NONCE })
  assert.equal(c.ok, true); assert.equal(c.attestation.used, true); assert.equal(c.attestation.used_at, new Date(NOW + 60000).toISOString())
  assert.equal(readSubscriptionState(f).value.owner_attestation.used, true, 'consumption is persisted before any launch')
  assert.equal(consumeOwnerAttestation(f, { now: NOW + 120000, nonce: NONCE }).code, 'ATTESTATION.USED', 'never twice')
  assert.equal(attestationStatus(readSubscriptionState(f).value.owner_attestation, NOW + 120000).code, 'ATTESTATION.USED')
  // a fresh file (no prior state) gets the schema and only the attestation
  tmp((d2) => { const f2 = path.join(d2, 's.json'); assert.equal(recordOwnerAttestation(f2, { now: NOW, nonce: NONCE }).ok, true); assert.deepEqual(Object.keys(readSubscriptionState(f2).value).sort(), ['owner_attestation', 'schema']) })
}))

test('D-1: expired, malformed and already-consumed attestations are rejected; an unreadable state file is never overwritten', () => tmp((d) => {
  const good = buildOwnerAttestation({ now: NOW, nonce: NONCE })
  assert.equal(attestationStatus(good, NOW + ATTESTATION_TTL_MS).code, 'ATTESTATION.EXPIRED', 'expires exactly at 24 h')
  assert.equal(attestationStatus(good, NOW + ATTESTATION_TTL_MS - 1).ok, true)
  assert.equal(attestationStatus({ ...good, used: true }, NOW).code, 'ATTESTATION.USED')
  for (const v of [null, undefined]) assert.equal(attestationStatus(v, NOW).code, 'ATTESTATION.MISSING')
  for (const [label, att] of [['array', [good]], ['string', 'yes'], ['extra_usage_off false', { ...good, extra_usage_off: false }], ['extra_usage_off "true"', { ...good, extra_usage_off: 'true' }],
    ['no nonce', { ...good, nonce: undefined }], ['nonce not a UUID', { ...good, nonce: 'abc' }], ['used "false"', { ...good, used: 'false' }], ['used missing', { ...good, used: undefined }],
    ['attested_at not ISO', { ...good, attested_at: 'today' }], ['expires_at a number', { ...good, expires_at: NOW + 1000 }],
    ['window longer than 24 h', { ...good, expires_at: new Date(NOW + ATTESTATION_TTL_MS + 1).toISOString() }], ['expires before attested', { ...good, expires_at: new Date(NOW - 1).toISOString() }],
    ['attested in the future', buildOwnerAttestation({ now: NOW + 60000, nonce: NONCE })], ['impossible date', { ...good, attested_at: '2026-02-30T00:00:00.000Z' }]]) {
    assert.equal(attestationStatus(att, NOW).code, 'ATTESTATION.MALFORMED', label)
  }
  assert.equal(attestationStatus(good, Number.NaN).code, 'ATTESTATION.MALFORMED', 'a non-finite clock fails closed')
  assert.throws(() => buildOwnerAttestation({ now: NOW, nonce: 'not-a-uuid' }), /ATTESTATION.BAD_INPUT/)
  const f = path.join(d, 'subscription.json')
  // expired on disk → consumption refused, file unchanged
  atomicWriteJson(f, { schema: SUBSCRIPTION_STATE_SCHEMA, owner_attestation: buildOwnerAttestation({ now: NOW - ATTESTATION_TTL_MS - 1, nonce: NONCE }) })
  const before = readFileSync(f)
  assert.equal(consumeOwnerAttestation(f, { now: NOW, nonce: NONCE }).code, 'ATTESTATION.EXPIRED'); assert.ok(readFileSync(f).equals(before))
  // malformed attestation on disk: the state still reads (so the governor is not lost) but cannot be consumed
  atomicWriteJson(f, { schema: SUBSCRIPTION_STATE_SCHEMA, owner_attestation: { ...good, nonce: 'x' } })
  assert.equal(readSubscriptionState(f).ok, true); assert.equal(consumeOwnerAttestation(f, { now: NOW, nonce: 'x' }).code, 'ATTESTATION.MALFORMED')
  // no state / corrupt state: nothing consumed, and attest refuses to overwrite a corrupt file
  rmSync(f); assert.equal(consumeOwnerAttestation(f, { now: NOW, nonce: NONCE }).code, 'ATTESTATION.STATE_UNREADABLE:STATE.ABSENT')
  writeFileSync(f, '{"schema":"patelrep.developer-harness-v3.subscription-governor","state":"unauthorized_billing"')
  const corrupt = readFileSync(f)
  assert.equal(recordOwnerAttestation(f, { now: NOW, nonce: NONCE }).code, 'ATTESTATION.STATE_UNREADABLE:STATE.CORRUPT'); assert.ok(readFileSync(f).equals(corrupt))
}))

test('review A1: consumption is a compare-and-swap; a racing second consumer that also read used:false loses', () => tmp((d) => {
  const f = path.join(d, 'subscription.json')
  assert.equal(recordOwnerAttestation(f, { now: NOW, nonce: NONCE }).ok, true)
  const unconsumed = readFileSync(f) // what a second process read before the first one wrote
  assert.equal(consumeOwnerAttestation(f, { now: NOW + 1000, nonce: NONCE }).ok, true)
  assert.ok(existsSync(consumedMarker(f, NONCE)), 'the per-nonce marker exists')
  writeFileSync(f, unconsumed) // the race: the state file still says used:false to the loser
  assert.equal(attestationStatus(readSubscriptionState(f).value.owner_attestation, NOW + 1000).ok, true, 'the file alone would allow it')
  assert.equal(consumeOwnerAttestation(f, { now: NOW + 1000, nonce: NONCE }).code, 'ATTESTATION.USED', 'the exclusive marker refuses the second claim')
  // a NEW attestation (new nonce) is independent of the old marker
  const NONCE2 = '9b1d4c2e-7a3f-4e8b-9c0d-1e2f3a4b5c6d'
  assert.equal(recordOwnerAttestation(f, { now: NOW + 2000, nonce: NONCE2 }).ok, true)
  assert.equal(consumeOwnerAttestation(f, { now: NOW + 3000, nonce: NONCE2 }).ok, true)
}))

test('review A2/A3: a future verified-off fact is never carried forward; an impossible calendar date is malformed by round trip', () => {
  const prev = { schema: SUBSCRIPTION_STATE_SCHEMA, state: 'available', extra_usage: { enabled: false, basis: 'SYNTHETIC', verified_at: NOW + 3600000 } }
  const next = nextGovernorState(prev, { state: 'available', reason_codes: [], extra_usage: null }, { now: NOW })
  assert.deepEqual(next.extra_usage, { enabled: null, basis: 'UNVERIFIED_OR_EXPIRED', verified_at: null })
  const past = nextGovernorState({ ...prev, extra_usage: { ...prev.extra_usage, verified_at: NOW - 1000 } }, { state: 'available', reason_codes: [], extra_usage: null }, { now: NOW })
  assert.equal(past.extra_usage.verified_at, NOW - 1000, 'a past fact within its TTL is still carried')
  // 02-30 rolls over to 03-02 in Date.parse; the window check alone would not catch a same-length roll-over, the round trip does
  const att = { ...buildOwnerAttestation({ now: Date.parse('2026-03-01T00:00:00.000Z'), nonce: NONCE }), attested_at: '2026-02-29T00:00:00.000Z' }
  assert.equal(Date.parse(att.attested_at), Date.parse('2026-03-01T00:00:00.000Z'), 'V8 rolls the impossible date over')
  assert.equal(attestationStatus(att, Date.parse('2026-03-01T01:00:00.000Z')).code, 'ATTESTATION.MALFORMED')
})

test('D-2: a refused admission reason carries exactly one RESOURCE. prefix', () => {
  assert.equal(R.admissionRefusalReason(['RESOURCE.MEMORY_HEADROOM_INSUFFICIENT']), 'RESOURCE.MEMORY_HEADROOM_INSUFFICIENT')
  assert.equal(R.admissionRefusalReason(['RESOURCE.MEMORY_HEADROOM_INSUFFICIENT', 'COMMIT_RATIO_HIGH']), 'RESOURCE.MEMORY_HEADROOM_INSUFFICIENT,RESOURCE.COMMIT_RATIO_HIGH')
  for (const empty of [[], null, undefined, [''], [42]]) assert.equal(R.admissionRefusalReason(empty), 'RESOURCE.ADMISSION_REFUSED')
  const src = readFileSync(path.join(V3, 'isolation', 'acceptance.mjs'), 'utf8')
  assert.ok(!src.includes('`RESOURCE.${a.reason_codes'), 'the doubling form is gone'); assert.ok(src.includes("finish('NOT_RUN', R.admissionRefusalReason(a.reason_codes))"))
})
