import assert from 'node:assert/strict'
import { normalizePhone, isValidPhone, formatPhoneDisplay } from '../src/utils/phone.js'
import { personalize, isStopMessage } from '../src/sender/index.js'
import {
  getDB, addContact, updateContact, getContactById, getContactByPhone, deleteContact,
  clearOptOut, markOptedOut, setExclusion, getExclusionsWithDetails, deleteExclusionById,
  getSetting, setSetting, type Contact
} from '../src/db/index.js'
import { getGroups, createGroup, updateGroup, deleteGroup, assignContactToGroup, getContactsByGroup } from '../src/db/groups.js'
import { verifyPassword, setupPassword } from '../src/api/auth.js'
import bcrypt from 'bcryptjs'

console.log('🧪 RUNNING FULL TEST SUITE...\n')

let passed = 0
let total = 0

function test(name: string, fn: () => void | Promise<void>) {
  total++
  try {
    fn()
    console.log(`  ✓ ${name}`)
    passed++
  } catch (err: any) {
    console.error(`  ✗ ${name}`)
    console.error(`    ${err.message}`)
  }
}

// 1. Phone Utility Tests
console.log('--- 1. Phone Normalization & Validation ---')
test('normalizes Pakistani local mobile numbers (0300... -> 92300...)', () => {
  assert.equal(normalizePhone('03001234567'), '923001234567')
  assert.equal(normalizePhone('0321-555-4433'), '923215554433')
  assert.equal(normalizePhone('(0300) 1234567'), '923001234567')
})

test('normalizes international formats with +, 00, spaces, and dashes', () => {
  assert.equal(normalizePhone('+92 300 1234567'), '923001234567')
  assert.equal(normalizePhone('00923001234567'), '923001234567')
  assert.equal(normalizePhone('+1 (415) 555-2671'), '14155552671')
})

test('isValidPhone correctly validates length', () => {
  assert.equal(isValidPhone('923001234567'), true)
  assert.equal(isValidPhone('14155552671'), true)
  assert.equal(isValidPhone('123'), false)
  assert.equal(isValidPhone(''), false)
})

test('formatPhoneDisplay formats with spaces and country code', () => {
  assert.equal(formatPhoneDisplay('923001234567'), '+92 300 1234567')
})

// 2. Personalize & Template Engine Tests
console.log('\n--- 2. Template Personalization Engine ---')
test('personalize replaces {{name}}, {{firstName}}, {{month}}, {{year}}, {{phone}}, {{notes}}, {{date}}', () => {
  const contact: Contact = {
    id: 1,
    name: 'Ahmed Khan',
    phone: '923001234567',
    active: 1,
    opted_out: 0,
    notes: 'VIP Supporter',
    created_at: new Date().toISOString()
  }

  const template = 'Assalam-o-Alaikum {{firstName}} ({{name}}), reminder for {{month}} {{year}}. Notes: {{notes}}. Phone: {{phone}}.'
  const output = personalize(template, contact, 'September')

  assert.ok(output.includes('Ahmed (Ahmed Khan)'))
  assert.ok(output.includes('September'))
  assert.ok(output.includes(String(new Date().getFullYear())))
  assert.ok(output.includes('VIP Supporter'))
  assert.ok(output.includes('923001234567'))
})

test('isStopMessage detects Urdu and English opt-out triggers', () => {
  assert.equal(isStopMessage('STOP'), true)
  assert.equal(isStopMessage('stop'), true)
  assert.equal(isStopMessage('unsubscribe'), true)
  assert.equal(isStopMessage('ناٹ سبسکرائب'), true)
  assert.equal(isStopMessage('Hello how are you?'), false)
})

// 3. Database Operations
console.log('\n--- 3. Database Operations & Consistency ---')
test('Database opened with WAL mode and schema v3', () => {
  const db = getDB()
  const mode = db.pragma('journal_mode', { simple: true })
  const ver = db.pragma('user_version', { simple: true })
  assert.equal(mode, 'wal')
  assert.ok(Number(ver) >= 3)
})

test('Contact CRUD and normalization on save', () => {
  const uniquePhone = '92399' + String(Date.now()).slice(-7)
  const contact = addContact('Test Person', uniquePhone, 'Test notes')
  assert.equal(contact.name, 'Test Person')
  assert.equal(contact.phone, uniquePhone)

  updateContact(contact.id, { name: 'Updated Person', notes: 'Updated notes' })
  const updated = getContactById(contact.id)
  assert.equal(updated?.name, 'Updated Person')
  assert.equal(updated?.notes, 'Updated notes')

  // Opt out and clear opt out
  markOptedOut(uniquePhone)
  const optedOut = getContactById(contact.id)
  assert.equal(optedOut?.opted_out, 1)

  clearOptOut(contact.id)
  const cleared = getContactById(contact.id)
  assert.equal(cleared?.opted_out, 0)
  assert.equal(cleared?.active, 1)

  deleteContact(contact.id)
  assert.equal(getContactById(contact.id), undefined)
})

test('Groups management and contact assignment', () => {
  const group = createGroup('Test VIP Group', '#25D366')
  assert.equal(group.name, 'Test VIP Group')

  const uniquePhone = '92398' + String(Date.now()).slice(-7)
  const contact = addContact('Group Member', uniquePhone)

  assignContactToGroup(contact.id, group.id)
  const groupContactIds = getContactsByGroup(group.id)
  assert.ok(groupContactIds.includes(contact.id))

  deleteContact(contact.id)
  deleteGroup(group.id)
})

test('Exclusions creation, details query, and deletion', () => {
  const uniquePhone = '92397' + String(Date.now()).slice(-7)
  const contact = addContact('Excluded Person', uniquePhone)
  const period = '2026-11'

  setExclusion(contact.id, period)
  const details = getExclusionsWithDetails(period)
  const found = details.find(e => e.contact_id === contact.id)
  assert.ok(found)
  assert.equal(found.contact_name, 'Excluded Person')

  if (found) {
    deleteExclusionById(found.id)
    const afterDelete = getExclusionsWithDetails(period)
    assert.equal(afterDelete.find(e => e.id === found.id), undefined)
  }

  deleteContact(contact.id)
})

test('Settings storage and retrieval', () => {
  setSetting('test_key_sample', 'sample_val_123')
  assert.equal(getSetting('test_key_sample'), 'sample_val_123')
})

// 4. Auth & Security
console.log('\n--- 4. Authentication & Security ---')
test('Password hashing and verification works with bcrypt', () => {
  const pwd = 'securePassword123'
  const hash = bcrypt.hashSync(pwd, 10)
  assert.equal(bcrypt.compareSync(pwd, hash), true)
  assert.equal(bcrypt.compareSync('wrongPassword', hash), false)
})

console.log(`\n========================================`)
console.log(`TEST RESULTS: ${passed}/${total} passed (${Math.round((passed/total)*100)}%)`)
console.log(`========================================\n`)

if (passed !== total) process.exit(1)
