import Database from 'better-sqlite3'
import { openDB } from './schema.js'

import { normalizePhone } from '../utils/phone.js'

export interface Contact {
  id: number
  name: string
  phone: string
  active: number
  opted_out: number
  notes: string
  group_id: number | null
  group_name?: string | null
  group_color?: string | null
  created_at: string
}

export interface Message {
  id: number
  title: string
  body_template: string
  updated_at: string
}

export interface Schedule {
  id: number
  message_id: number
  group_id: number | null
  day_of_month: number
  send_hour: number
  send_minute: number
  timezone: string
  enabled: number
  created_at: string
}

export interface Exclusion {
  id: number
  contact_id: number
  year_month: string
}

export interface ExclusionDetail {
  id: number
  contact_id: number
  year_month: string
  created_at: string
  contact_name: string
  contact_phone: string
}

export interface SendLogEntry {
  id: number
  schedule_id: number
  contact_id: number
  period_key: string
  status: 'sent' | 'failed' | 'skipped' | 'opted_out'
  sent_at: string | null
  error: string
  created_at: string
}

let _db: Database.Database | null = null

export function getDB(): Database.Database {
  if (!_db) _db = openDB()
  return _db
}

// ── Contacts ──

export function getActiveContacts(groupId?: number): Contact[] {
  if (groupId) {
    return getDB()
      .prepare(`
        SELECT c.*, g.name as group_name, g.color as group_color
        FROM contacts c
        LEFT JOIN "groups" g ON c.group_id = g.id
        WHERE c.active = 1 AND c.opted_out = 0 AND (
          c.group_id = ? OR c.id IN (SELECT contact_id FROM contact_groups WHERE group_id = ?)
        )
        ORDER BY c.name ASC
      `)
      .all(groupId, groupId) as Contact[]
  }
  return getDB()
    .prepare(`
      SELECT c.*, g.name as group_name, g.color as group_color
      FROM contacts c
      LEFT JOIN "groups" g ON c.group_id = g.id
      WHERE c.active = 1 AND c.opted_out = 0
      ORDER BY c.name ASC
    `)
    .all() as Contact[]
}

export function getContactById(id: number): Contact | undefined {
  return getDB().prepare(`
    SELECT c.*, g.name as group_name, g.color as group_color
    FROM contacts c
    LEFT JOIN "groups" g ON c.group_id = g.id
    WHERE c.id = ?
  `).get(id) as Contact | undefined
}

export function getContactByPhone(phone: string): Contact | undefined {
  const clean = normalizePhone(phone)
  return getDB().prepare(`
    SELECT c.*, g.name as group_name, g.color as group_color
    FROM contacts c
    LEFT JOIN "groups" g ON c.group_id = g.id
    WHERE c.phone = ?
  `).get(clean) as Contact | undefined
}

export function addContact(name: string, phone: string, notes: string = '', groupId?: number | null): Contact {
  const cleanPhone = normalizePhone(phone)
  const result = getDB()
    .prepare('INSERT INTO contacts (name, phone, notes, group_id) VALUES (?, ?, ?, ?)')
    .run(name.trim(), cleanPhone, notes.trim(), groupId ?? null)
  const contactId = Number(result.lastInsertRowid)
  if (groupId) {
    getDB()
      .prepare('INSERT OR IGNORE INTO contact_groups (contact_id, group_id) VALUES (?, ?)')
      .run(contactId, groupId)
  }
  return getContactById(contactId)!
}

export function updateContact(id: number, data: Partial<Pick<Contact, 'name' | 'phone' | 'active' | 'notes' | 'group_id' | 'opted_out'>>) {
  const ALLOWED = ['name', 'phone', 'active', 'notes', 'group_id', 'opted_out']
  const sets: string[] = []
  const vals: any[] = []
  for (const [k, v] of Object.entries(data)) {
    if (ALLOWED.includes(k)) {
      if (k === 'phone' && v !== undefined) {
        sets.push(`${k} = ?`)
        vals.push(normalizePhone(String(v)))
      } else {
        sets.push(`${k} = ?`)
        vals.push(v)
      }
    }
  }
  if (sets.length === 0) return
  vals.push(id)
  getDB().prepare(`UPDATE contacts SET ${sets.join(', ')} WHERE id = ?`).run(...vals)

  if (data.group_id !== undefined) {
    getDB().prepare('DELETE FROM contact_groups WHERE contact_id = ?').run(id)
    if (data.group_id) {
      getDB().prepare('INSERT OR IGNORE INTO contact_groups (contact_id, group_id) VALUES (?, ?)').run(id, data.group_id)
    }
  }
}

export function deleteContact(id: number) {
  getDB().prepare('DELETE FROM contact_groups WHERE contact_id = ?').run(id)
  getDB().prepare('DELETE FROM exclusions WHERE contact_id = ?').run(id)
  getDB().prepare('DELETE FROM contacts WHERE id = ?').run(id)
}

// ── Messages ──

export function getMessage(id: number): Message | undefined {
  return getDB().prepare('SELECT * FROM messages WHERE id = ?').get(id) as Message | undefined
}

export function getAllMessages(): Message[] {
  return getDB().prepare('SELECT * FROM messages ORDER BY updated_at DESC').all() as Message[]
}

export function updateMessage(id: number, bodyTemplate: string, title?: string) {
  const msg = getMessage(id)
  if (!msg) return
  getDB()
    .prepare('UPDATE messages SET body_template = ?, title = COALESCE(?, title), updated_at = datetime(\'now\') WHERE id = ?')
    .run(bodyTemplate, title ?? null, id)
}

export function addMessage(title: string, bodyTemplate: string): Message {
  const result = getDB()
    .prepare('INSERT INTO messages (title, body_template) VALUES (?, ?)')
    .run(title, bodyTemplate)
  return getMessage(Number(result.lastInsertRowid))!
}

export function deleteMessage(id: number) {
  getDB().prepare('DELETE FROM messages WHERE id = ?').run(id)
}

// ── Schedules ──

export function getActiveSchedule(): Schedule | undefined {
  return getDB()
    .prepare('SELECT * FROM schedules WHERE enabled = 1 LIMIT 1')
    .get() as Schedule | undefined
}

export function updateSchedule(id: number, data: Partial<Pick<Schedule, 'day_of_month' | 'send_hour' | 'send_minute' | 'timezone' | 'enabled' | 'message_id' | 'group_id'>>) {
  const ALLOWED = ['day_of_month', 'send_hour', 'send_minute', 'timezone', 'enabled', 'message_id', 'group_id']
  const sets: string[] = []
  const vals: any[] = []
  for (const [k, v] of Object.entries(data)) {
    if (ALLOWED.includes(k)) {
      sets.push(`${k} = ?`)
      vals.push(v)
    }
  }
  if (sets.length === 0) return
  vals.push(id)
  getDB().prepare(`UPDATE schedules SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
}

// ── Exclusions ──

export function isExcluded(contactId: number, yearMonth: string): boolean {
  const row = getDB()
    .prepare('SELECT 1 FROM exclusions WHERE contact_id = ? AND year_month = ?')
    .get(contactId, yearMonth)
  return !!row
}

export function setExclusion(contactId: number, yearMonth: string) {
  getDB()
    .prepare('INSERT OR IGNORE INTO exclusions (contact_id, year_month) VALUES (?, ?)')
    .run(contactId, yearMonth)
}

export function removeExclusion(contactId: number, yearMonth: string) {
  getDB()
    .prepare('DELETE FROM exclusions WHERE contact_id = ? AND year_month = ?')
    .run(contactId, yearMonth)
}

export function getExcludedForMonth(yearMonth: string): number[] {
  const rows = getDB()
    .prepare('SELECT contact_id FROM exclusions WHERE year_month = ?')
    .all(yearMonth) as { contact_id: number }[]
  return rows.map((r) => r.contact_id)
}

export function getExclusionsWithDetails(yearMonth: string): ExclusionDetail[] {
  return getDB()
    .prepare(`
      SELECT e.id, e.contact_id, e.year_month, e.created_at, c.name as contact_name, c.phone as contact_phone
      FROM exclusions e
      INNER JOIN contacts c ON e.contact_id = c.id
      WHERE e.year_month = ?
      ORDER BY c.name ASC
    `)
    .all(yearMonth) as ExclusionDetail[]
}

export function deleteExclusionById(id: number) {
  getDB().prepare('DELETE FROM exclusions WHERE id = ?').run(id)
}

// ── Send Log ──

export function logSend(scheduleId: number, contactId: number, periodKey: string, status: SendLogEntry['status'], error: string = '') {
  getDB()
    .prepare(`
      INSERT INTO send_log (schedule_id, contact_id, period_key, status, sent_at, error)
      VALUES (?, ?, ?, ?, CASE WHEN ? = 'sent' THEN datetime('now') ELSE NULL END, ?)
      ON CONFLICT(schedule_id, contact_id, period_key) DO UPDATE SET
        status = CASE
          WHEN excluded.status = 'sent' THEN 'sent'
          WHEN send_log.status = 'sent' THEN 'sent'
          ELSE excluded.status
        END,
        sent_at = CASE
          WHEN excluded.status = 'sent' THEN datetime('now')
          WHEN send_log.status = 'sent' THEN send_log.sent_at
          ELSE NULL
        END,
        error = CASE
          WHEN excluded.status = 'sent' THEN ''
          WHEN send_log.status = 'sent' THEN send_log.error
          ELSE excluded.error
        END
    `)
    .run(scheduleId, contactId, periodKey, status, status, error)
}

export function hasAlreadySent(scheduleId: number, contactId: number, periodKey: string): boolean {
  const row = getDB()
    .prepare('SELECT 1 FROM send_log WHERE schedule_id = ? AND contact_id = ? AND period_key = ? AND status = ?')
    .get(scheduleId, contactId, periodKey, 'sent')
  return !!row
}

export function getSendLogForPeriod(periodKey: string): SendLogEntry[] {
  return getDB()
    .prepare('SELECT * FROM send_log WHERE period_key = ? ORDER BY sent_at')
    .all(periodKey) as SendLogEntry[]
}

export function resetFailedLogs(periodKey: string): number {
  const result = getDB()
    .prepare("DELETE FROM send_log WHERE period_key = ? AND status = 'failed'")
    .run(periodKey)
  return result.changes
}

// ── Settings ──

export function getSetting(key: string): string | null {
  const row = getDB().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string) {
  getDB().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
}

// ── Opt-out handling ──

export function markOptedOut(phone: string) {
  const clean = normalizePhone(phone)
  getDB().prepare('UPDATE contacts SET opted_out = 1, active = 0 WHERE phone = ?').run(clean)
}

export function clearOptOut(idOrPhone: number | string) {
  if (typeof idOrPhone === 'number') {
    getDB().prepare('UPDATE contacts SET opted_out = 0, active = 1 WHERE id = ?').run(idOrPhone)
  } else {
    const clean = normalizePhone(idOrPhone)
    getDB().prepare('UPDATE contacts SET opted_out = 0, active = 1 WHERE phone = ?').run(clean)
  }
}
