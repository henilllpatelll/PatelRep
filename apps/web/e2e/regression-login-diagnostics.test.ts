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
    authRequestsSent: [],
    failedAuthRequests: [],
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

test('login diagnostics distinguish an unanswered auth request from a click that never fired', () => {
  const diagnostics = createLoginDiagnostics('gm', 'https://web.example.test/')
  const request = {
    url: () => 'https://project.supabase.co/auth/v1/token?grant_type=password',
    method: () => 'POST',
    failure: () => ({ errorText: 'net::ERR_TIMED_OUT for fixture@example.test' }),
  }
  diagnostics.recordAuthRequest(request)
  diagnostics.recordAuthRequestFailure(request)
  diagnostics.recordAuthRequest({ url: () => 'https://web.example.test/_next/x.js', method: () => 'GET' })

  const snapshot = diagnostics.snapshot('https://web.example.test/login', [])
  assert.deepEqual(snapshot.authRequestsSent, ['POST https://project.supabase.co/auth/v1/token'])
  assert.equal(snapshot.failedAuthRequests.length, 1)
  assert.doesNotMatch(snapshot.failedAuthRequests[0].error, /fixture@example\.test/)
})
