import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  regularFile,
  sanitizeProduct,
  validateChildInput,
} from '../research/commander-four-product-read-child.mjs'

const childPath = new URL(
  '../research/commander-four-product-read-child.mjs',
  import.meta.url,
)

const identity = Object.freeze({
  upc: '00000000000017',
  modifier: '000',
})

test('child sanitizes only the exact five-field product snapshot contract', () => {
  const product = sanitizeProduct({
    upc: '00000000000017',
    modifier: '000',
    description: 'Pilot product',
    retail_price: '12.34',
    department_number: '10',
    raw_xml: '<not-retained>',
  }, identity)

  assert.deepEqual(Object.keys(product), [
    'upc',
    'modifier',
    'description',
    'price',
    'department',
  ])
  assert.deepEqual(product, {
    upc: '00000000000017',
    modifier: '000',
    description: 'Pilot product',
    price: '12.34',
    department: '10',
  })
})

test('child rejects missing or malformed normalized product fields and extra stdin keys', () => {
  const base = {
    upc: '00000000000017',
    modifier: '000',
    description: 'Pilot product',
    retail_price: '12.34',
    department_number: '10',
  }
  for (const product of [
    { ...base, department_number: '' },
    { ...base, department_number: 'department-ten' },
    { ...base, department_number: '1'.repeat(65) },
    { ...base, retail_price: '12.3' },
    { ...base, description: '' },
  ]) assert.throws(() => sanitizeProduct(product, identity), /product_response_invalid/)

  assert.equal(validateChildInput({ session_cookie: 'safe-cookie' }), 'safe-cookie')
  assert.throws(
    () => validateChildInput({ session_cookie: 'safe-cookie', extra: true }),
    /invalid_input/,
  )
})

test('regular-file validation accepts real Node Stats shape and rejects unsafe file kinds', async () => {
  const regular = {
    isFile: () => true,
    isSymbolicLink: () => false,
  }
  assert.equal(
    await regularFile('C:\\offline\\config.json', { async lstat() { return regular } }),
    true,
  )
  assert.equal(
    await regularFile('C:\\offline\\config.json', { async lstat() { return { ...regular, isFile: () => false } } }),
    false,
  )
  assert.equal(
    await regularFile('C:\\offline\\config.json', { async lstat() { return { ...regular, isSymbolicLink: () => true } } }),
    false,
  )
  assert.equal(
    await regularFile('C:\\offline\\config.json', { async lstat() { return { ...regular, isReparsePoint: () => true } } }),
    false,
  )
  assert.equal(
    await regularFile('C:\\offline\\config.json', { async lstat() { throw new Error('offline failure') } }),
    false,
  )
})

test('config regular-file refusal precedes Commander, TLS, and transport work', async () => {
  const source = await readFile(childPath, 'utf8')
  const regularFileRefusal = source.indexOf(
    "if (!(await regularFile(CONFIG_PATH))) fail('transport_failed')",
  )
  const tlsCall = source.indexOf('const trust = await resolveCommanderTlsTrust(')
  const transportCall = source.indexOf('const response = await readCommanderVpluProduct(')
  assert.ok(regularFileRefusal >= 0)
  assert.ok(regularFileRefusal < tlsCall)
  assert.ok(regularFileRefusal < transportCall)
  assert.doesNotMatch(source, /supabase/i)
})
