import { expect, test } from '@playwright/test'
import { join } from 'node:path'
import { AUTH_DIR } from './global-setup'

test.use({ storageState: join(AUTH_DIR, 'gm.json') })

test.beforeEach(async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: testInfo.project.name === 'reduced-motion' ? 'reduce' : 'no-preference' })
  // Keep the briefing deterministic; sending the question below uses its local
  // board answer and never creates tasks or incurs AI credits.
  await page.route('**/ai/risk-alerts', (route) => route.fulfill({
    json: { data: { housekeeping_risks: [], engineering_risks: [] } },
  }))
  await page.goto('/dashboard')
})

test('Ask about this becomes an inline chat and returns keyboard focus on close', async ({ page }, testInfo) => {
  const ask = page.getByRole('button', { name: 'Ask about this', exact: true })
  await expect(ask).toBeVisible()
  const totalRooms = page.getByRole('button', { name: /Total rooms/ })
  const originalTile = await totalRooms.boundingBox()
  await page.screenshot({ path: testInfo.outputPath('briefing.png') })
  await ask.click()
  const input = page.getByRole('textbox', { name: 'Ask about the briefing', exact: true })
  await expect(input).toBeFocused()
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('button', { name: /Total rooms/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()

  await input.fill('Which rooms are flagged?')
  await input.press('Enter')
  await expect(page.getByText('Nothing is flagged at risk right now — the board is clean.', { exact: true })).toBeVisible()
  await expect(input).toHaveValue('')
  const chatTile = await totalRooms.boundingBox()
  expect(chatTile?.y).toBeCloseTo(originalTile!.y, 0)
  expect(chatTile?.height).toBeCloseTo(originalTile!.height, 0)
  const composer = await input.boundingBox()
  expect(composer!.x + composer!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  await page.screenshot({ path: testInfo.outputPath('chat.png') })

  await page.getByRole('button', { name: 'Close chat', exact: true }).click()
  await expect(input).toHaveCount(0)
  await expect(ask).toBeFocused()

  await ask.press('Enter')
  await expect(input).toBeFocused()
  await expect(page.getByText('Which rooms are flagged?', { exact: true })).toBeVisible()
  await input.press('Escape')
  await expect(input).toHaveCount(0)
  await expect(ask).toBeFocused()
})

test('closing during the entrance leaves no duplicate or hidden active composer', async ({ page }) => {
  const ask = page.getByRole('button', { name: 'Ask about this', exact: true })
  await ask.click()
  const input = page.getByRole('textbox', { name: 'Ask about the briefing', exact: true })
  await expect(input).toBeFocused()
  await input.press('Escape')
  await expect(ask).toBeFocused()
  await expect(input).toHaveCount(0)
  await ask.press('Enter')
  await expect(input).toBeFocused()
  await expect(input).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Close chat', exact: true })).toHaveCount(1)
})
