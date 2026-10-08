import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { apiClient } from '@/lib/api/client'
import { staffApi } from '@/lib/api/staff'

type Call = { method: string; path: string; body?: unknown; options?: unknown }

describe('staffApi contracts', () => {
  const original = { ...apiClient }
  let calls: Call[] = []

  beforeEach(() => {
    calls = []
    const record = (method: string) => (path: string, a?: unknown, b?: unknown) => {
      const hasBody = method === 'POST' || method === 'PATCH'
      calls.push({ method, path, body: hasBody ? a : undefined, options: hasBody ? b : a })
      return Promise.resolve({ data: {} })
    }
    Object.assign(apiClient, {
      get: record('GET'), post: record('POST'), patch: record('PATCH'), delete: record('DELETE'),
    })
  })
  afterEach(() => { Object.assign(apiClient, original) })

  it('list() with no args is the unchanged active-only request used by every picker', async () => {
    await staffApi.list()
    await staffApi.list({})
    assert.deepEqual(calls, [
      { method: 'GET', path: '/staff', body: undefined, options: undefined },
      { method: 'GET', path: '/staff', body: undefined, options: undefined },
    ])
  })

  it('list() forwards explicit lifecycle and department filters as query params', async () => {
    await staffApi.list({ status: 'all', department_id: 'd1' })
    assert.deepEqual(calls[0].options, { params: { status: 'all', department_id: 'd1' } })
  })

  it('maps lifecycle, profile and department calls to the new endpoints', async () => {
    await staffApi.get('u1')
    await staffApi.updateProfile('u1', { preferred_name: 'Hec' })
    await staffApi.reactivate('u1')
    await staffApi.listDepartments()
    assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), [
      'GET /staff/u1', 'PATCH /staff/u1/profile', 'POST /staff/u1/reactivate', 'GET /staff/departments',
    ])
    assert.deepEqual(calls[1].body, { preferred_name: 'Hec' })
  })

  it('maps the invitation lifecycle', async () => {
    await staffApi.listInvitations()
    await staffApi.listInvitations('all')
    await staffApi.resendInvitation('i1')
    await staffApi.revokeInvitation('i1')
    await staffApi.reissueInvitation('i1', { role: 'front_desk' })
    await staffApi.acceptInvitation()
    assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), [
      'GET /staff/invitations', 'GET /staff/invitations', 'POST /staff/invitations/i1/resend',
      'DELETE /staff/invitations/i1', 'POST /staff/invitations/i1/reissue', 'POST /staff/invitations/accept',
    ])
    assert.equal(calls[0].options, undefined)
    assert.deepEqual(calls[1].options, { params: { status: 'all' } })
    assert.deepEqual(calls[4].body, { role: 'front_desk' })
  })
})
