import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createLoginDiagnostics,
  probeAuthBackend,
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

test('login diagnostics list auth requests still waiting, and drop answered or failed ones', () => {
  const diagnostics = createLoginDiagnostics('gm', 'https://web.example.test/')
  const token = { url: () => 'https://project.supabase.co/auth/v1/token?grant_type=password', method: () => 'POST' }
  const user = { url: () => 'https://project.supabase.co/auth/v1/user', method: () => 'GET' }
  const logout = { url: () => 'https://project.supabase.co/auth/v1/logout', method: () => 'POST' }
  diagnostics.recordAuthRequest(token)
  diagnostics.recordAuthRequest(user)
  diagnostics.recordAuthRequest(logout)
  diagnostics.recordAuthResponse({ url: token.url, status: () => 200, request: () => token })
  diagnostics.recordAuthRequestFailure(logout)

  const waiting = diagnostics.unansweredAuthRequests(Date.now() + 20_000)
  assert.deepEqual(waiting.map((w) => w.request), ['GET https://project.supabase.co/auth/v1/user'])
  assert.ok(waiting[0].waitedMs >= 20_000)
})

test('auth backend probe reports an http answer, a timeout and a network error without leaking the key', async () => {
  const key = 'public-anon-key-should-never-appear'
  const answered = await probeAuthBackend('https://p.supabase.co', key, { fetchImpl: async () => ({ status: 200 }) })
  assert.equal(answered.outcome, 'http')
  assert.equal(answered.status, 200)

  const hung = await probeAuthBackend('https://p.supabase.co', key, {
    timeoutMs: 20,
    fetchImpl: (_url, init) =>
      new Promise((_resolve, reject) =>
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))),
      ),
  })
  assert.equal(hung.outcome, 'timeout')

  const broken = await probeAuthBackend('https://p.supabase.co', key, {
    fetchImpl: async () => {
      throw new Error('getaddrinfo ENOTFOUND')
    },
  })
  assert.equal(broken.outcome, 'error')
  assert.doesNotMatch(JSON.stringify([answered, hung, broken]), new RegExp(key))
})
