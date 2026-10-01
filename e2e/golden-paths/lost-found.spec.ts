/** Lost & Found Phase 1 golden path: log → inspect drawer → custody release. */
import { test, expect } from '@playwright/test'

const UNIQUE_DESC = `E2E Found Item ${Date.now()}`

test.describe.configure({ mode: 'serial' })
test.describe('Lost & Found golden path', () => {
  test('logs an item and opens its detail drawer', async ({ page }) => {
    await page.goto('/lost-found')
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: /log found item/i }).click()

    const modal = page.getByRole('dialog')
    await modal.getByLabel(/location found/i).fill('Room 105')
    await modal.getByLabel(/description/i).fill(UNIQUE_DESC)
    const [response] = await Promise.all([
      page.waitForResponse((candidate) => candidate.url().includes('/lost-found') && candidate.request().method() === 'POST'),
      modal.getByRole('button', { name: /log item/i }).click(),
    ])
    expect(response.status()).toBeLessThan(300)

    const row = page.getByTestId('lost-found-item').filter({ hasText: UNIQUE_DESC })
    await expect(row).toBeVisible()
    await row.click()
    const drawer = page.getByRole('dialog')
    await expect(drawer).toContainText(UNIQUE_DESC)
    await expect(drawer.getByRole('tab', { name: 'Details' })).toBeVisible()
    await drawer.getByRole('button', { name: 'Close item details' }).click()
    await expect(drawer).not.toBeVisible()
  })

  test('releases an unclaimed item through its custody event and hides terminal actions', async ({ page }) => {
    await page.goto('/lost-found')
    await page.waitForLoadState('networkidle')
    const row = page.getByTestId('lost-found-item').filter({ hasText: UNIQUE_DESC })
    await expect(row).toBeVisible()
    await row.click()

    const drawer = page.getByRole('dialog')
    await drawer.getByRole('button', { name: 'Release item' }).click()
    await drawer.getByLabel('Recipient name').fill('E2E Guest')
    await drawer.getByLabel('Verification method').fill('photo ID')
    const [response] = await Promise.all([
      page.waitForResponse((candidate) => candidate.url().includes('/custody-events') && candidate.request().method() === 'POST'),
      drawer.getByRole('button', { name: 'Confirm release' }).click(),
    ])
    expect(response.status()).toBeLessThan(300)
    await expect(drawer).toContainText('Returned')
    await expect(drawer.getByRole('button', { name: 'Release item' })).toHaveCount(0)
  })
})
