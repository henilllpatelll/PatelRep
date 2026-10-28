import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'

// ESLint 10 runs every plugin in eslint-config-next, several of which still declare peer
// ranges only up to ESLint 9. This proves the rules this repo relies on still load and fire.
const eslint = new ESLint({ cwd: fileURLToPath(new URL('..', import.meta.url)) })

async function ruleIds(filePath, source) {
  const [result] = await eslint.lintText(source, { filePath })
  return result.messages.map((message) => message.ruleId)
}

test('react-hooks, react, jsx-a11y and next rules fire', async () => {
  const ids = await ruleIds('components/shared/__probe.tsx', `
import { useState } from 'react'
export default function Probe({ items }: { items: string[] }) {
  if (items.length) { useState(0) }
  return (
    <div>
      <img src="/a.png" />
      {items.map((i) => <span>{i}</span>)}
    </div>
  )
}
`)
  assert.ok(ids.includes('react-hooks/rules-of-hooks'), 'react-hooks/rules-of-hooks')
  assert.ok(ids.includes('react/jsx-key'), 'react/jsx-key')
  assert.ok(ids.includes('jsx-a11y/alt-text'), 'jsx-a11y/alt-text')
  assert.ok(ids.includes('@next/next/no-img-element'), '@next/next/no-img-element')
})

test('the floor-copy i18n gate still hard-fails raw JSX text on floor surfaces', async () => {
  const source = `export default function Probe() { return <p>Raw floor text</p> }\n`
  assert.ok((await ruleIds('components/housekeeping/__probe.tsx', source)).includes('i18next/no-literal-string'))
  assert.ok(!(await ruleIds('components/shared/__probe.tsx', source)).includes('i18next/no-literal-string'))
})

test('a clean component produces no messages', async () => {
  const ids = await ruleIds('components/shared/__probe.tsx', `export default function Probe() { return <p aria-hidden>{'ok'}</p> }\n`)
  assert.deepEqual(ids, [])
})
