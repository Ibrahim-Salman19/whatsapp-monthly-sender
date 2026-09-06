import assert from 'node:assert/strict'
import { normalizePhone, isValidPhone, formatPhoneDisplay } from '../src/utils/phone.js'
import { personalize, isStopMessage } from '../src/sender/index.js'
import {
  getDB, addContact, updateContact, getContactById, getContactByPhone, deleteContact,
  clearOptOut, markOptedOut, setExclusion, getExclusionsWithDetails, deleteExclusionById,
  getSetting, setSetting, getDailySentCount, isWithinQuietHours, type Contact
} from '../src/db/index.js'
import { getGroups, createGroup, updateGroup, deleteGroup, assignContactToGroup, getContactsByGroup } from '../src/db/groups.js'
import { verifyPassword, setupPassword } from '../src/api/auth.js'
import { processSpintax, validateSpintax, generateSpintaxVariations } from '../src/utils/spintax.js'
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

test('processSpintax resolves simple alternatives', () => {
  const tpl = '{Hello|Hi|Hey} there!'
  for (let i = 0; i < 10; i++) {
    const res = processSpintax(tpl)
    assert.ok(['Hello there!', 'Hi there!', 'Hey there!'].includes(res))
  }
})

test('processSpintax resolves nested alternatives', () => {
  const tpl = '{Greeting: {Hi|Hello}|Salute: {Hey|Peace}}'
  const allowed = ['Greeting: Hi', 'Greeting: Hello', 'Salute: Hey', 'Salute: Peace']
  for (let i = 0; i < 15; i++) {
    const res = processSpintax(tpl)
    assert.ok(allowed.includes(res), `Got unexpected: ${res}`)
  }
})

test('validateSpintax accurately validates brace pairing', () => {
  assert.equal(validateSpintax('{Hello|Hi}').valid, true)
  assert.equal(validateSpintax('{Hello|{Hi|Hey}}').valid, true)
  assert.equal(validateSpintax('{Hello|Hi').valid, false)
  assert.equal(validateSpintax('Hello|Hi}').valid, false)
})

test('generateSpintaxVariations generates distinct variations', () => {
  const tpl = '{Peace|Blessings|Hello|Hi} to {you|all|everyone}'
  const vars = generateSpintaxVariations(tpl, 4)
  assert.ok(vars.length >= 2)
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

test('getDailySentCount accurately queries database', () => {
  const count = getDailySentCount()
  assert.ok(typeof count === 'number')
  assert.ok(count >= 0)
})

test('isWithinQuietHours executes correctly with timezone', () => {
  setSetting('quiet_hours_enabled', 'false')
  assert.equal(isWithinQuietHours('Asia/Karachi'), false)

  setSetting('quiet_hours_enabled', 'true')
  setSetting('quiet_hours_start', '00:00')
  setSetting('quiet_hours_end', '23:59')
  assert.equal(isWithinQuietHours('Asia/Karachi'), true)

  // Reset to default safe setting
  setSetting('quiet_hours_enabled', 'false')
})

test('Anti-ban default settings exist in database', () => {
  assert.ok(getSetting('batch_size') !== null)
  assert.ok(getSetting('batch_cooldown_ms') !== null)
  assert.ok(getSetting('daily_cap') !== null)
})

// 4. Auth & Security
console.log('\n--- 4. Authentication & Security ---')
test('Password hashing and verification works with bcrypt', () => {
  const pwd = 'securePassword123'
  const hash = bcrypt.hashSync(pwd, 10)
  assert.equal(bcrypt.compareSync(pwd, hash), true)
  assert.equal(bcrypt.compareSync('wrongPassword', hash), false)
})

test('Quick-start admin password setup and verification', () => {
  setupPassword('admin123')
  assert.equal(verifyPassword('admin123'), true)
  assert.equal(verifyPassword('wrongPassword'), false)
})

test('Demo sandbox insertion and removal in database', () => {
  const db = getDB()
  const demoPhones = ['923001234567', '923219876543', '923335557788', '923451122334', '923124455667']
  
  const insertContact = db.prepare(`
    INSERT INTO contacts (name, phone, notes, active, created_at)
    VALUES (?, ?, ?, 1, datetime('now'))
    ON CONFLICT(phone) DO UPDATE SET name = excluded.name, notes = excluded.notes, active = 1
  `)

  for (const p of demoPhones) {
    insertContact.run('Demo Contact', p, 'Test demo')
  }

  const countBefore = (db.prepare(`SELECT COUNT(*) as count FROM contacts WHERE phone IN (${demoPhones.map(() => '?').join(',')})`).get(...demoPhones) as any).count
  assert.equal(countBefore, 5)

  // Clear demo data
  db.prepare(`DELETE FROM contacts WHERE phone IN (${demoPhones.map(() => '?').join(',')})`).run(...demoPhones)
  const countAfter = (db.prepare(`SELECT COUNT(*) as count FROM contacts WHERE phone IN (${demoPhones.map(() => '?').join(',')})`).get(...demoPhones) as any).count
  assert.equal(countAfter, 0)
})

console.log(`\n========================================`)
console.log(`TEST RESULTS: ${passed}/${total} passed (${Math.round((passed/total)*100)}%)`)
console.log(`========================================\n`)

if (passed !== total) process.exit(1)
