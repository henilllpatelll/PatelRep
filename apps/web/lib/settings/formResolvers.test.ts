import assert from 'node:assert/strict'
import test from 'node:test'
import { zodResolver } from '@hookform/resolvers/zod'
import type { ResolverOptions } from 'react-hook-form'
import { EMPTY_PROFILE, propertyProfileSchema, type PropertyProfileValues } from './propertyProfile'

// @hookform/resolvers 6 contract: the zod resolver feeds react-hook-form on the Property Profile
// (settings/general) and onboarding forms. These run the real resolver against the real schema.
const options: ResolverOptions<PropertyProfileValues> = { fields: {}, shouldUseNativeValidation: false }
const resolve = (values: unknown) => zodResolver(propertyProfileSchema)(values as PropertyProfileValues, undefined, options)

const valid: PropertyProfileValues = {
  name: '  Fossil Creek Inn  ',
  address: '123 Main Street',
  city: 'Fort Worth',
  state: 'TX',
  zip: '76137',
  phone: '+1 (817) 555-0100',
  timezone: 'America/Chicago',
  average_daily_rate: 129.5,
}

test('valid values resolve with the schema output and no errors', async () => {
  const result = await resolve(valid)
  assert.deepEqual(result.errors, {})
  assert.equal((result.values as PropertyProfileValues).name, 'Fossil Creek Inn')
  assert.equal((result.values as PropertyProfileValues).average_daily_rate, 129.5)
})

test('the optional daily rate may be omitted', async () => {
  const result = await resolve({ ...valid, average_daily_rate: undefined })
  assert.deepEqual(result.errors, {})
})

test('invalid fields come back keyed by field name with the schema messages', async () => {
  const result = await resolve({ ...valid, name: 'A', state: 'Texas', zip: '7613', phone: 'abc' })
  assert.deepEqual(result.values, {})
  const errors = result.errors as Record<string, { message?: string; type?: string }>
  assert.equal(errors.name?.message, 'Name must be at least 2 characters')
  assert.equal(errors.state?.message, 'Use a 2-letter state code (e.g. TX)')
  assert.equal(errors.zip?.message, 'Enter a valid ZIP code')
  assert.equal(errors.phone?.message, 'Enter a valid phone number')
  assert.equal(errors.city, undefined)
})

test('a wrong-typed number surfaces the custom type message', async () => {
  const result = await resolve({ ...valid, average_daily_rate: 'cheap' })
  const errors = result.errors as Record<string, { message?: string }>
  assert.equal(errors.average_daily_rate?.message, 'Enter a dollar amount')
})

test('numeric bounds are enforced', async () => {
  const over = (await resolve({ ...valid, average_daily_rate: 100001 })).errors as Record<string, { message?: string }>
  assert.equal(over.average_daily_rate?.message, 'Max $100,000')
  const under = (await resolve({ ...valid, average_daily_rate: -1 })).errors as Record<string, { message?: string }>
  assert.equal(under.average_daily_rate?.message, 'Must be 0 or more')
})

test('the empty default form fails every required field instead of throwing', async () => {
  const result = await resolve(EMPTY_PROFILE)
  const keys = Object.keys(result.errors as object).sort()
  assert.deepEqual(keys, ['address', 'city', 'name', 'phone', 'state', 'zip'])
})
