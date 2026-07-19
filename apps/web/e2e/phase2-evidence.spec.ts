import { expect, test, type Page } from '@playwright/test'

const GM_EMAIL = process.env.TEST_EMAIL ?? 'hp.patelrep@gmail.com'
const GM_PASSWORD = process.env.TEST_PASSWORD
const EVIDENCE_BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'https://patelrep-production-0ad1.up.railway.app'

async function loginAsGM(page: Page): Promise<void> {
  const password = GM_PASSWORD
  if (!password) {
    test.skip(true, 'Set TEST_PASSWORD to run authenticated evidence configuration coverage')
    return
  }

  await page.goto(new URL('/login', EVIDENCE_BASE_URL).toString())
  await page.locator('#email-pw').or(page.locator('input[type="email"]')).first().fill(GM_EMAIL)
  await page.locator('input[type="password"]').first().fill(password)
  await page.getByRole('button', { name: /sign in|log in|login/i }).or(page.locator('button[type="submit"]')).first().click()
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 20_000 })
}

test('GM can save canonical property applicability', async ({ page }) => {
  test.skip(process.env.RUN_EVIDENCE_E2E !== 'true', 'Set RUN_EVIDENCE_E2E=true to enable a state-changing authenticated check')
  await loginAsGM(page)
  await page.goto('/evidence')

  const pool = page.getByTestId('applicability-facilities-pool')
  await expect(pool).toBeVisible()
  const originallyChecked = await pool.isChecked()

  try {
    await pool.setChecked(!originallyChecked)
    const [saveResponse] = await Promise.all([
      page.waitForResponse((response) => response.url().includes('/evidence/applicability') && response.request().method() === 'PUT'),
      page.getByTestId('save-applicability').click(),
    ])
    expect(saveResponse.ok()).toBeTruthy()
    await expect(pool).toBeChecked({ checked: !originallyChecked })
  } finally {
    if (await pool.isChecked() !== originallyChecked) {
      await Promise.all([
        page.waitForResponse((response) => response.url().includes('/evidence/applicability') && response.request().method() === 'PUT'),
        pool.setChecked(originallyChecked).then(() => page.getByTestId('save-applicability').click()),
      ])
    }
  }
})

test('GM can open the controlled-document lifecycle workspace', async ({ page }) => {
  test.skip(process.env.RUN_EVIDENCE_E2E !== 'true', 'Set RUN_EVIDENCE_E2E=true to enable authenticated evidence coverage')
  await loginAsGM(page)
  await page.goto('/evidence')

  await expect(page.getByTestId('controlled-document-title')).toBeVisible()
  await expect(page.getByTestId('create-controlled-document')).toBeVisible()
})

test('authorized staff can open secure evidence capture and review', async ({ page }) => {
  test.skip(process.env.RUN_EVIDENCE_E2E !== 'true', 'Set RUN_EVIDENCE_E2E=true to enable authenticated evidence coverage')
  await loginAsGM(page)
  await page.goto('/evidence')

  await expect(page.getByTestId('evidence-label')).toBeVisible()
  await expect(page.getByTestId('evidence-file')).toBeVisible()
  await expect(page.getByTestId('capture-evidence')).toBeVisible()
})
