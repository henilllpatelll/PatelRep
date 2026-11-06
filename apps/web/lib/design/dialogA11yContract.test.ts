import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const webRoot = path.resolve(__dirname, '..', '..')
const read = (rel: string) => readFileSync(path.join(webRoot, rel), 'utf8')

/** Modal dialogs (aria-modal) must trap focus and return it; these six were the known gaps. */
const MODALS: Array<[string, string]> = [
  ['components/engineering/AssetDetailPanel.tsx', 'useModalFocusTrap(deactivateDialogRef'],
  ['components/housekeeping/RoomStatusBoard.tsx', 'useModalFocusTrap(cleanTypeDialogRef'],
  ['components/housekeeping/AssignmentWorkspace.tsx', 'useModalFocusTrap(cleanTypeDialogRef'],
  ['app/(dashboard)/housekeeping/out-of-order/page.tsx', 'useModalFocusTrap(panelRef'],
  ['app/(dashboard)/housekeeping/out-of-order/page.tsx', 'useModalFocusTrap(detailRef'],
]

for (const [file, call] of MODALS) {
  test(`modal dialog traps focus: ${file} (${call})`, () => {
    assert.ok(read(file).includes(call), `${file} must call ${call}`)
  })
}

test('asset deactivate confirm has an accessible name and description', () => {
  const src = read('components/engineering/AssetDetailPanel.tsx')
  assert.match(src, /aria-labelledby="asset-deactivate-title"/)
  assert.match(src, /aria-describedby="asset-deactivate-help"/)
})

test('out-of-order detail panel is a real modal dialog, not a bare aside', () => {
  const src = read('app/(dashboard)/housekeeping/out-of-order/page.tsx')
  assert.match(src, /<aside ref=\{detailRef\} role="dialog" aria-modal="true"/)
})

for (const file of ['components/ai/AICopilotBubble.tsx', 'components/shared/FeedbackButton.tsx']) {
  test(`floating widget is a non-modal dialog that returns focus to its launcher: ${file}`, () => {
    const src = read(file)
    assert.equal(/aria-modal="true"/.test(src), false, 'floating widgets do not block the page, so they must not be aria-modal')
    assert.match(src, /role="dialog"/)
    assert.match(src, /launcherRef\.current\?\.focus\(\)/)
    assert.match(src, /key === 'Escape'/)
    assert.match(src, /aria-expanded=\{open\}/)
  })
}
