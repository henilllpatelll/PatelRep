// Proves the scoped `i18next/no-literal-string` gate (04-08 / D-04, eslint.config.mjs)
// actually bites, without committing a real lint failure into a floor-facing
// directory. Runs the ESLint API programmatically against two in-memory
// fixtures (never written to disk):
//
//   1. A raw JSX text literal mapped to a floor-facing file path (one of the
//      files this plan's eslint.config.mjs override scopes to) -- the rule
//      MUST fire.
//   2. The same raw literal mapped to a GM/admin allowlisted path
//      (app/(dashboard)/reports/**) -- the rule must NOT fire, proving the
//      D-03 carve-out stays exempt.
//
// Exits non-zero (and prints the ESLint messages) if either assertion fails.

import { ESLint } from 'eslint'
import path from 'node:path'

const RAW_LITERAL_FIXTURE = `
export function FixtureComponent() {
  return <div>This is a raw untranslated floor-facing string</div>
}
`

async function lint(relativeFilePath, source) {
  const eslint = new ESLint({ cwd: process.cwd() })
  const filePath = path.resolve(process.cwd(), relativeFilePath)
  const results = await eslint.lintText(source, { filePath })
  return results.flatMap((r) => r.messages)
}

function hasI18nextViolation(messages) {
  return messages.some((m) => m.ruleId === 'i18next/no-literal-string')
}

async function main() {
  let failed = false

  // ── 1. Positive case: floor-facing scoped file MUST fire ──────────────────
  const floorMessages = await lint('components/engineering/WorkOrderCard.tsx', RAW_LITERAL_FIXTURE)
  if (!hasI18nextViolation(floorMessages)) {
    failed = true
    console.error('FAIL: i18next/no-literal-string did NOT fire for a raw literal on a floor-facing scoped path.')
    console.error(JSON.stringify(floorMessages, null, 2))
  } else {
    console.log(
      `PASS: i18next/no-literal-string fired on the floor-facing fixture (${floorMessages.filter((m) => m.ruleId === 'i18next/no-literal-string').length} violation(s)).`,
    )
  }

  // ── 2. Negative case: GM/admin allowlisted path must stay exempt (D-03) ──
  const gmMessages = await lint('app/(dashboard)/reports/fixture-check.tsx', RAW_LITERAL_FIXTURE)
  if (hasI18nextViolation(gmMessages)) {
    failed = true
    console.error('FAIL: i18next/no-literal-string incorrectly fired on the GM/reports allowlisted path (D-03 carve-out broken).')
    console.error(JSON.stringify(gmMessages, null, 2))
  } else {
    console.log('PASS: the GM/reports allowlisted path stayed exempt from the gate, as expected (D-03).')
  }

  if (failed) {
    process.exit(1)
  }
  console.log('verify-i18n-gate: the scoped no-literal-string gate is wired correctly.')
}

main().catch((err) => {
  console.error('verify-i18n-gate crashed:', err)
  process.exit(1)
})
