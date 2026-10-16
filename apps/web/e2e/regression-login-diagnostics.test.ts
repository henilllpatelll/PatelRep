import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createLoginDiagnostics,
  redactDiagnosticText,
  safeDiagnosticUrl,
} from './regression-login-diagnostics'

test('login diagnostics retain only an auth response method, status, and query-free URL', () => {
  const diagnostics = createLoginDiagnostics('gm', 'https://web.example.test/login?access_token=secret')

  diagnostics.recordAuthResponse({
    url: () => 'https://project.supabase.co/auth/v1/token?grant_type=password&access_token=secret',
    status: () => 400,
    request: () => ({ method: () => 'POST' }),
  })

  assert.deepEqual(diagnostics.snapshot('https://web.example.test/login?token=secret', []), {
    role: 'gm',
    target: 'https://web.example.test/login',
    currentPage: 'https://web.example.test/login',
    authResponses: [
      { method: 'POST', status: 400, url: 'https://project.supabase.co/auth/v1/token' },
    ],
    pageErrors: [],
    visibleLoginErrors: [],
  })
})

test('login diagnostics redact common authentication secrets and emails', () => {
  const message = redactDiagnosticText(
    'Invalid login for fixture@example.test: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def access_token=secret password=hunter2',
  )

  assert.doesNotMatch(message, /fixture@example\.test|eyJ|secret|hunter2/i)
  assert.match(message, /\[REDACTED_EMAIL\]|\[REDACTED\]/)
  assert.equal(safeDiagnosticUrl('not a url'), '[invalid-url]')
})
