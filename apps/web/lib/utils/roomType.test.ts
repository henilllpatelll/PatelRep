import assert from 'node:assert/strict'
import test from 'node:test'
import { getRoomTypeCode } from './roomType'

test('gets room type code from top-level or nested room data', () => {
  assert.equal(getRoomTypeCode({ room_type_code: 'KS', rooms: { room_types: { code: 'DQ' } } }), 'KS')
  assert.equal(getRoomTypeCode({ rooms: { room_types: { code: 'DQ' } } }), 'DQ')
})

test('does not fall back to the room type name', () => {
  assert.equal(
    getRoomTypeCode({
      room_type_code: null,
      rooms: { room_types: {} },
    }),
    null,
  )
})
