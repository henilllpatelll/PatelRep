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

/** Unsaved-changes protection (verified in a real browser; this pins the wiring so it cannot silently regress). */
const GUARDED: Array<[string, string[]]> = [
  ['components/tasks/CreateTaskDrawer.tsx', ['useDiscardGuard(dirty, onClose)', 'guard.requestClose', 'DiscardChangesPrompt']],
  ['components/logbook/AddHandoffDrawer.tsx', ['useDiscardGuard(dirty, onClose)', 'guard.requestClose', 'DiscardChangesPrompt']],
  ['components/engineering/CreateWorkOrderDrawer.tsx', ['useDiscardGuard(dirty, onClose)', 'guard.requestClose', 'DiscardChangesPrompt']],
]
for (const [file, needles] of GUARDED) {
  test(`create drawer asks before discarding input: ${file}`, () => {
    const src = read(file)
    for (const needle of needles) assert.ok(src.includes(needle), `${file} must contain ${needle}`)
    // Saving is not discarding: the success path must not go through the guard (it would prompt after a save).
    assert.equal(/onSuccess:[^
]*guard\.requestClose/.test(src), false)
  })
}

test('discard prompt defaults to the safe choice and Escape means keep editing', () => {
  const src = read('components/ui/DiscardChangesPrompt.tsx')
  assert.match(src, /role="alertdialog"/)
  assert.match(src, /keepRef\.current\?\.focus\(\)/)
  assert.match(src, /event\.key === 'Escape'[\s\S]*onKeepEditing\(\)/)
})

test('useDiscardGuard closes immediately when clean and only prompts when dirty', () => {
  const src = read('lib/hooks/useDiscardGuard.ts')
  assert.match(src, /if \(dirty\) setConfirming\(true\)\s*else onClose\(\)/)
})
