import { Router } from 'express'
import {
  getDB, getActiveContacts, addContact, updateContact, deleteContact, getContactById, getContactByPhone,
  getMessage, getAllMessages, updateMessage, addMessage, deleteMessage,
  getActiveSchedule, updateSchedule,
  getSendLogForPeriod, getExcludedForMonth, getExclusionsWithDetails, deleteExclusionById, setExclusion, removeExclusion,
  getSetting, setSetting, getDailySentCount, isWithinQuietHours,
} from '../db/index.js'
import {
  getGroups, createGroup, updateGroup, deleteGroup,
  assignContactToGroup, removeContactFromGroup, getContactsByGroup, getGroupsForContact,
} from '../db/groups.js'
import type { SessionManager } from '../session/manager.js'
import type { MonthlyScheduler } from '../scheduler/index.js'
import { sendSingleTestMessage, personalize } from '../sender/index.js'
import { normalizePhone } from '../utils/phone.js'
import { validateSpintax, generateSpintaxVariations } from '../utils/spintax.js'
import { validateBody } from './validate.js'
import {
  ContactCreateSchema,
  ContactUpdateSchema,
  MessageUpdateSchema,
  MessageCreateSchema,
  ScheduleUpdateSchema,
  ExclusionSchema,
  SettingsBulkUpdateSchema,
  GroupCreateSchema,
  GroupUpdateSchema,
  ContactGroupSchema,
  SendTestSchema,
  SendNowSchema,
} from '../schemas/index.js'

let session: SessionManager | null = null
let scheduler: MonthlyScheduler | null = null

export function setSession(s: SessionManager) { session = s }
export function setScheduler(s: MonthlyScheduler) { scheduler = s }

import { appendFileSync, mkdirSync, existsSync, readFileSync, statSync, renameSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'

export interface SystemLogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error'
  message: string
}

const LOGS_DIR = join(import.meta.dirname, '..', '..', 'data', 'logs')
const LOGS_FILE = join(LOGS_DIR, 'events.log')
const systemLogs: SystemLogEntry[] = []

try {
  if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true })
  if (existsSync(LOGS_FILE)) {
    const raw = readFileSync(LOGS_FILE, 'utf-8').trim().split('\n').filter(Boolean)
    for (const l of raw.slice(-100)) {
      try { systemLogs.push(JSON.parse(l)) } catch {}
    }
  }
} catch {}

export function logSystemEvent(level: 'info' | 'warn' | 'error', message: string) {
  const entry: SystemLogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
  }
  systemLogs.push(entry)
  if (systemLogs.length > 250) systemLogs.shift()

  try {
    if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true })
    if (existsSync(LOGS_FILE) && statSync(LOGS_FILE).size > 5 * 1024 * 1024) {
      renameSync(LOGS_FILE, join(LOGS_DIR, 'events.old.log'))
    }
    appendFileSync(LOGS_FILE, JSON.stringify(entry) + '\n')
  } catch {}
}

export function createAPIRoutes(
  sendNowLimiter?: (req: any, res: any, next: any) => void,
  contactsLimiter?: (req: any, res: any, next: any) => void,
): Router {
  const r = Router()

  function maybeLimit(limiter: typeof sendNowLimiter) {
    return limiter ? [limiter] : []
  }

  // ── Status ──
  r.get('/status', (_req, res) => {
    const sched = getActiveSchedule()
    const tz = sched?.timezone || 'Asia/Karachi'
    res.json({
      session: session?.status ?? 'disconnected',
      scheduler: scheduler?.status ?? 'idle',
      nextRun: scheduler?.nextRun?.toISOString() ?? null,
      lastRun: scheduler?.lastRun?.toISOString() ?? null,
      linkedNumber: session?.linkedNumber ?? null,
      qrDataUrl: session?.qrDataUrl ?? null,
      pairingCode: session?.pairingCode ?? null,
      globalPaused: getSetting('global_paused') === 'true',
      progress: scheduler?.currentProgress ?? null,
      sentToday: getDailySentCount(),
      dailyCap: parseInt(getSetting('daily_cap') || '100'),
      batchSize: parseInt(getSetting('batch_size') || '15'),
      batchCooldownSeconds: Math.round(parseInt(getSetting('batch_cooldown_ms') || '120000') / 1000),
      quietHoursActive: isWithinQuietHours(tz),
      quietHoursEnabled: getSetting('quiet_hours_enabled') === 'true',
      quietHoursStart: getSetting('quiet_hours_start') || '22:00',
      quietHoursEnd: getSetting('quiet_hours_end') || '08:00',
    })
  })

  // ── Spintax Preview ──
  r.post('/template/spin-preview', (req, res) => {
    const template = String(req.body?.template || '')
    const count = Math.min(10, Math.max(1, parseInt(req.body?.count) || 4))
    const validation = validateSpintax(template)
    const variations = generateSpintaxVariations(template, count)
    res.json({
      ok: true,
      valid: validation.valid,
      error: validation.error,
      variations: variations.length > 0 ? variations : [template],
    })
  })

  // ── System Logs ──
  r.get('/system/logs', (_req, res) => {
    res.json(systemLogs.slice(-100).reverse())
  })

  // ── Session Controls ──
  r.post('/session/reconnect', async (_req, res) => {
    try {
      await session?.reconnect()
      res.json({ ok: true, message: 'Reconnecting...' })
    } catch (e: any) {
      res.status(500).json({ error: e.message })
    }
  })

  r.post('/session/relink', async (_req, res) => {
    try {
      await session?.relink()
      res.json({ ok: true, message: 'Session reset. Scan new QR code.' })
    } catch (e: any) {
      res.status(500).json({ error: e.message })
    }
  })

  r.post('/session/pair', async (req, res) => {
    if (!session) {
      return res.status(503).json({ error: 'WhatsApp session manager not ready' })
    }
    const phone = req.body?.phone
    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required for pairing' })
    }
    try {
      const code = await session.requestPairingCode(phone)
      res.json({ ok: true, code })
    } catch (e: any) {
      res.status(400).json({ error: e.message })
    }
  })

  // ── Contacts ──
  r.get('/contacts', (req, res) => {
    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit as string) || 50))
    const offset = (page - 1) * limit
    const search = String(req.query.search || req.query.q || '').trim()
    const groupId = req.query.groupId ? parseInt(String(req.query.groupId)) : undefined
    const status = String(req.query.status || '').trim()
    const activeFilter = req.query.active !== undefined ? parseInt(String(req.query.active)) : undefined

    let whereClauses: string[] = []
    const params: any[] = []

    if (status === 'active') {
      whereClauses.push('c.active = 1 AND c.opted_out = 0')
    } else if (status === 'inactive') {
      whereClauses.push('c.active = 0 AND c.opted_out = 0')
    } else if (status === 'opted_out') {
      whereClauses.push('c.opted_out = 1')
    } else if (activeFilter !== undefined) {
      whereClauses.push('c.active = ?')
      params.push(activeFilter)
    }

    if (search) {
      whereClauses.push('(c.name LIKE ? OR c.phone LIKE ? OR c.notes LIKE ?)')
      const s = `%${search}%`
      params.push(s, s, s)
    }

    if (groupId) {
      whereClauses.push('(c.group_id = ? OR c.id IN (SELECT contact_id FROM contact_groups WHERE group_id = ?))')
      params.push(groupId, groupId)
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

    const countSql = `SELECT COUNT(*) as total FROM contacts c ${whereSql}`
    const total = (getDB().prepare(countSql).get(...params) as any).total

    const querySql = `
      SELECT c.*, g.name as group_name, g.color as group_color
      FROM contacts c
      LEFT JOIN "groups" g ON c.group_id = g.id
      ${whereSql}
      ORDER BY c.name COLLATE NOCASE ASC
      LIMIT ? OFFSET ?
    `
    const data = getDB().prepare(querySql).all(...params, limit, offset)

    res.json({
      data,
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
    })
  })

  r.post('/contacts', ...maybeLimit(contactsLimiter), validateBody(ContactCreateSchema), (req, res) => {
    const { name, phone, notes, groupId } = req.body
    const cleanPhone = normalizePhone(phone)

    const existing = getContactByPhone(cleanPhone)
    if (existing) {
      return res.status(409).json({ error: `Phone number already exists for contact "${existing.name}"` })
    }

    const contact = addContact(name, cleanPhone, notes || '', groupId ?? null)
    res.status(201).json(contact)
  })

  r.post('/contacts/bulk', ...maybeLimit(contactsLimiter), (req, res) => {
    const { contacts, updateExisting } = req.body
    if (!Array.isArray(contacts)) {
      return res.status(400).json({ error: 'Expected array of contacts' })
    }

    let imported = 0
    let skipped = 0
    const errors: Array<{ line: number; name: string; phone: string; reason: string }> = []

    const db = getDB()
    db.transaction(() => {
      for (let i = 0; i < contacts.length; i++) {
        const item = contacts[i]
        const name = item.name ? String(item.name).trim() : ''
        const rawPhone = item.phone ? String(item.phone).trim() : ''
        const cleanPhone = normalizePhone(rawPhone)

        if (!name) {
          errors.push({ line: i + 1, name, phone: rawPhone, reason: 'Name is empty' })
          skipped++
          continue
        }

        if (!/^\d{10,15}$/.test(cleanPhone)) {
          errors.push({ line: i + 1, name, phone: rawPhone, reason: 'Invalid phone format (must be 10-15 digits)' })
          skipped++
          continue
        }

        const existing = getContactByPhone(cleanPhone)
        if (existing) {
          if (updateExisting) {
            updateContact(existing.id, { name, notes: item.notes || existing.notes, group_id: item.groupId ?? existing.group_id })
            imported++
          } else {
            errors.push({ line: i + 1, name, phone: cleanPhone, reason: `Phone already exists for "${existing.name}"` })
            skipped++
          }
          continue
        }

        addContact(name, cleanPhone, item.notes || '', item.groupId ?? null)
        imported++
      }
    })()

    res.json({ ok: true, imported, skipped, errors })
  })

  r.get('/contacts/export', (_req, res) => {
    const contacts = getDB().prepare(`
      SELECT c.name, c.phone, c.active, c.opted_out, c.notes, g.name as group_name
      FROM contacts c
      LEFT JOIN "groups" g ON c.group_id = g.id
      ORDER BY c.name ASC
    `).all() as any[]

    let csv = 'Name,Phone,Group,Active,OptedOut,Notes\n'
    for (const c of contacts) {
      const escape = (str: string) => `"${String(str || '').replace(/"/g, '""')}"`
      csv += `${escape(c.name)},${escape(c.phone)},${escape(c.group_name || '')},${c.active},${c.opted_out},${escape(c.notes || '')}\n`
    }

    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', 'attachment; filename="whatsapp-contacts.csv"')
    res.send(csv)
  })

  r.patch('/contacts/:id', validateBody(ContactUpdateSchema), (req, res) => {
    const id = parseInt(String(req.params.id))
    const existing = getContactById(id)
    if (!existing) return res.status(404).json({ error: 'Contact not found' })

    if (req.body.phone) {
      const duplicate = getContactByPhone(req.body.phone)
      if (duplicate && duplicate.id !== id) {
        return res.status(409).json({ error: `Phone number is already used by "${duplicate.name}"` })
      }
    }

    updateContact(id, req.body)
    res.json({ ok: true, contact: getContactById(id) })
  })

  r.delete('/contacts/:id', (req, res) => {
    deleteContact(parseInt(String(req.params.id)))
    res.json({ ok: true })
  })

  // ── Groups ──
  r.get('/groups', (_req, res) => {
    res.json(getGroups())
  })

  r.post('/groups', validateBody(GroupCreateSchema), (req, res) => {
    try {
      const group = createGroup(req.body.name, req.body.color)
      res.status(201).json(group)
    } catch (e: any) {
      res.status(400).json({ error: e.message })
    }
  })

  r.patch('/groups/:id', validateBody(GroupUpdateSchema), (req, res) => {
    updateGroup(parseInt(String(req.params.id)), req.body)
    res.json({ ok: true })
  })

  r.delete('/groups/:id', (req, res) => {
    deleteGroup(parseInt(String(req.params.id)))
    res.json({ ok: true })
  })

  r.get('/groups/:id/contacts', (req, res) => {
    res.json(getContactsByGroup(parseInt(String(req.params.id))))
  })

  r.post('/groups/assign', validateBody(ContactGroupSchema), (req, res) => {
    assignContactToGroup(req.body.contactId, req.body.groupId)
    res.json({ ok: true })
  })

  r.post('/groups/unassign', validateBody(ContactGroupSchema), (req, res) => {
    removeContactFromGroup(req.body.contactId, req.body.groupId)
    res.json({ ok: true })
  })

  r.get('/contacts/:id/groups', (req, res) => {
    res.json(getGroupsForContact(parseInt(String(req.params.id))))
  })

  // ── Messages (multi-template) ──
  r.get('/messages', (_req, res) => {
    res.json(getAllMessages())
  })

  r.get('/messages/:id', (req, res) => {
    const msg = getMessage(parseInt(String(req.params.id)))
    if (!msg) return res.status(404).json({ error: 'not found' })
    res.json(msg)
  })

  r.post('/messages', validateBody(MessageCreateSchema), (req, res) => {
    const msg = addMessage(req.body.title, req.body.body_template)
    res.status(201).json(msg)
  })

  r.patch('/messages/:id', validateBody(MessageUpdateSchema), (req, res) => {
    updateMessage(parseInt(String(req.params.id)), req.body.body_template, req.body.title)
    res.json({ ok: true })
  })

  r.delete('/messages/:id', (req, res) => {
    const msgs = getAllMessages()
    if (msgs.length <= 1) return res.status(400).json({ error: 'Cannot delete the last message' })
    deleteMessage(parseInt(String(req.params.id)))
    res.json({ ok: true })
  })

  // ── Schedule ──
  r.get('/schedule', (_req, res) => {
    res.json(getActiveSchedule())
  })

  r.patch('/schedule/:id', validateBody(ScheduleUpdateSchema), (req, res) => {
    updateSchedule(parseInt(String(req.params.id)), req.body)
    if (scheduler) {
      scheduler.schedule()
      if (session?.socket) {
        scheduler.updateSocket(session.socket)
      }
    }
    res.json({ ok: true, schedule: getActiveSchedule() })
  })

  // ── History ──
  r.get('/history/:periodKey', (req, res) => {
    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit as string) || 100))
    const offset = (page - 1) * limit
    const periodKey = String(req.params.periodKey)
    const status = req.query.status ? String(req.query.status) : ''

    let sql = 'SELECT l.*, c.name as contact_name, c.phone as contact_phone FROM send_log l LEFT JOIN contacts c ON l.contact_id = c.id WHERE l.period_key = ?'
    const params: any[] = [periodKey]

    if (status) {
      sql += ' AND l.status = ?'
      params.push(status)
    }

    const countSql = `SELECT COUNT(*) as total FROM (${sql})`
    const total = (getDB().prepare(countSql).get(...params) as any).total

    sql += ' ORDER BY l.sent_at DESC, l.created_at DESC LIMIT ? OFFSET ?'
    const data = getDB().prepare(sql).all(...params, limit, offset)

    res.json({
      data,
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
    })
  })

  r.get('/history/:periodKey/export', (req, res) => {
    const periodKey = String(req.params.periodKey)
    const sql = `
      SELECT l.period_key, c.name, c.phone, l.status, l.sent_at, l.error
      FROM send_log l
      LEFT JOIN contacts c ON l.contact_id = c.id
      WHERE l.period_key = ?
      ORDER BY l.sent_at DESC
    `
    const rows = getDB().prepare(sql).all(periodKey) as any[]
    let csv = 'Period,Name,Phone,Status,SentAt,Error\n'
    const escape = (str: string) => `"${String(str || '').replace(/"/g, '""')}"`
    for (const r of rows) {
      csv += `${r.period_key},${escape(r.name)},${escape(r.phone)},${r.status},${escape(r.sent_at || '')},${escape(r.error || '')}\n`
    }
    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', `attachment; filename="whatsapp-logs-${periodKey}.csv"`)
    res.send(csv)
  })

  // ── Exclusions ──
  r.get('/exclusions/:periodKey', (req, res) => {
    const periodKey = String(req.params.periodKey)
    const ids = getExcludedForMonth(periodKey)
    const details = getExclusionsWithDetails(periodKey)
    res.json({ ids, details })
  })

  r.post('/exclusions', validateBody(ExclusionSchema), ...maybeLimit(contactsLimiter), (req, res) => {
    const { contactId, yearMonth } = req.body
    setExclusion(contactId, yearMonth)
    res.json({ ok: true })
  })

  r.delete('/exclusions', validateBody(ExclusionSchema), (req, res) => {
    const { contactId, yearMonth } = req.body
    removeExclusion(contactId, yearMonth)
    res.json({ ok: true })
  })

  r.delete('/exclusions/id/:id', (req, res) => {
    const id = parseInt(String(req.params.id))
    deleteExclusionById(id)
    res.json({ ok: true })
  })

  // ── Settings ──
  r.get('/settings', (_req, res) => {
    const keys = [
      'delay_min_ms', 'delay_max_ms', 'daily_cap', 'catchup_hours',
      'min_delay_ms', 'max_delay_ms', 'daily_send_limit', 'catch_up_window_hours',
      'global_paused', 'global_paused_until', 'typing_duration_ms', 'max_retries', 'owner_phone',
    ]
    const settings: Record<string, string | null> = {}
    for (const k of keys) settings[k] = getSetting(k)

    const minDelay = settings['min_delay_ms'] || settings['delay_min_ms'] || '4000'
    const maxDelay = settings['max_delay_ms'] || settings['delay_max_ms'] || '10000'
    const dailyCap = settings['daily_send_limit'] || settings['daily_cap'] || '200'
    const catchup = settings['catch_up_window_hours'] || settings['catchup_hours'] || '72'
    const typing = settings['typing_duration_ms'] || '2500'
    const retries = settings['max_retries'] || '3'
    const paused = settings['global_paused'] || 'false'
    const phone = settings['owner_phone'] || ''

    res.json({
      ...settings,
      min_delay_ms: minDelay,
      delay_min_ms: minDelay,
      max_delay_ms: maxDelay,
      delay_max_ms: maxDelay,
      daily_send_limit: dailyCap,
      daily_cap: dailyCap,
      catch_up_window_hours: catchup,
      catchup_hours: catchup,
      typing_duration_ms: typing,
      max_retries: retries,
      global_paused: paused,
      owner_phone: phone,
    })
  })

  r.patch('/settings', validateBody(SettingsBulkUpdateSchema), (req, res) => {
    for (const [k, v] of Object.entries(req.body)) {
      setSetting(k, String(v))
      if (k === 'min_delay_ms') setSetting('delay_min_ms', String(v))
      if (k === 'delay_min_ms') setSetting('min_delay_ms', String(v))
      if (k === 'max_delay_ms') setSetting('delay_max_ms', String(v))
      if (k === 'delay_max_ms') setSetting('max_delay_ms', String(v))
      if (k === 'daily_send_limit') setSetting('daily_cap', String(v))
      if (k === 'daily_cap') setSetting('daily_send_limit', String(v))
      if (k === 'catch_up_window_hours') setSetting('catchup_hours', String(v))
      if (k === 'catchup_hours') setSetting('catch_up_window_hours', String(v))
    }
    res.json({ ok: true })
  })

  // ── Actions & Live Progress ──

  // Live SSE stream for real-time send progress
  r.get('/send/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const sendData = (data: any) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`)
    }

    // Send initial snapshot
    sendData({
      status: scheduler?.status ?? 'idle',
      progress: scheduler?.currentProgress ?? null,
    })

    const onProgress = (p: any) => {
      sendData({ status: scheduler?.status ?? 'running', progress: p })
    }

    const onStatus = (s: any) => {
      sendData({ status: s, progress: scheduler?.currentProgress ?? null })
    }

    scheduler?.on('progress', onProgress)
    scheduler?.on('status', onStatus)

    const keepAlive = setInterval(() => {
      res.write(': keepalive\n\n')
    }, 15000)

    req.on('close', () => {
      clearInterval(keepAlive)
      scheduler?.off('progress', onProgress)
      scheduler?.off('status', onStatus)
    })
  })

  // Polling fallback for send progress
  r.get('/send/progress', (_req, res) => {
    res.json({
      status: scheduler?.status ?? 'idle',
      progress: scheduler?.currentProgress ?? null,
    })
  })

  // Start sending on demand (non-blocking)
  r.post('/send-now', ...maybeLimit(sendNowLimiter), validateBody(SendNowSchema), async (req, res) => {
    if (!scheduler || !session?.socket) {
      return res.status(503).json({ error: 'WhatsApp is not connected. Please scan QR or check connection.' })
    }

    if (scheduler.status === 'running') {
      return res.status(409).json({ error: 'A monthly send is already actively in progress' })
    }

    const { groupId, contactIds } = req.body || {}

    // Trigger run in the background
    scheduler.manualRun({ groupId, targetContactIds: contactIds }).catch((e) => {
      console.error('Error during on-demand send:', e)
    })

    res.status(202).json({ ok: true, message: 'Send process started' })
  })

  // Abort active send
  r.post('/send/abort', (_req, res) => {
    if (!scheduler || scheduler.status !== 'running') {
      return res.json({ ok: true, message: 'No send is currently active', aborted: false })
    }
    const aborted = scheduler.abort()
    res.json({ ok: true, message: 'Abort signal sent', aborted })
  })

  // Send single test message
  r.post('/send/test', ...maybeLimit(sendNowLimiter), validateBody(SendTestSchema), async (req, res) => {
    if (!session?.socket || session.status !== 'connected') {
      return res.status(503).json({ error: 'WhatsApp is not connected' })
    }

    const ownerPhone = getSetting('owner_phone') || process.env.OWNER_PHONE || ''
    const targetPhone = req.body.phone || ownerPhone
    if (!targetPhone) {
      return res.status(400).json({ error: 'No phone number provided and OWNER_PHONE is not set' })
    }

    const cleanPhone = normalizePhone(targetPhone)
    let messageText = req.body.customMessage

    if (!messageText) {
      const schedule = getActiveSchedule()
      const messageId = req.body.messageId || schedule?.message_id
      const template = messageId ? getMessage(messageId) : getAllMessages()[0]
      if (!template) {
        return res.status(400).json({ error: 'No template available' })
      }
      const now = new Date()
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
      messageText = personalize(template.body_template, { name: 'Test Contact', phone: cleanPhone } as any, monthNames[now.getMonth()])
    }

    const result = await sendSingleTestMessage(session.socket, cleanPhone, messageText)
    if (!result.ok) {
      return res.status(500).json({ error: result.error || 'Failed to send test message' })
    }

    res.json({ ok: true, phone: cleanPhone, message: messageText })
  })

  // Retry failed sends for a period
  r.post('/send/retry-failed', ...maybeLimit(sendNowLimiter), async (req, res) => {
    if (!scheduler || !session?.socket) {
      return res.status(503).json({ error: 'WhatsApp is not connected' })
    }

    if (scheduler.status === 'running') {
      return res.status(409).json({ error: 'A send is already in progress' })
    }

    const now = new Date()
    const periodKey = req.body?.periodKey || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const logs = getSendLogForPeriod(periodKey)
    const failedContactIds = logs.filter(l => l.status === 'failed').map(l => l.contact_id)

    if (failedContactIds.length === 0) {
      return res.json({ ok: true, message: 'No failed messages found to retry for this period', count: 0 })
    }

    scheduler.manualRun({ targetContactIds: failedContactIds }).catch((e) => {
      console.error('Error during retry send:', e)
    })

    res.json({ ok: true, message: `Retrying ${failedContactIds.length} failed contact(s)`, count: failedContactIds.length })
  })

  // ── Database Backup & Restore ──
  r.get('/backup', (_req, res) => {
    const db = getDB()
    db.pragma('wal_checkpoint(TRUNCATE)')
    const now = new Date().toISOString().split('T')[0]
    res.download(db.name, `whatsapp-sender-backup-${now}.db`)
  })

  r.post('/backup/restore', (req, res) => {
    const base64Data = req.body?.databaseBase64
    if (!base64Data || typeof base64Data !== 'string') {
      return res.status(400).json({ error: 'Database base64 content required' })
    }
    try {
      const buffer = Buffer.from(base64Data, 'base64')
      if (buffer.length < 100) {
        return res.status(400).json({ error: 'Uploaded file is too small to be a database' })
      }
      const header = buffer.subarray(0, 16).toString('utf-8')
      if (!header.startsWith('SQLite format 3')) {
        return res.status(400).json({ error: 'Uploaded file is not a valid SQLite database' })
      }

      const db = getDB()
      db.pragma('wal_checkpoint(TRUNCATE)')

      const targetPath = join(import.meta.dirname, '..', '..', 'data', 'sender.db')
      writeFileSync(targetPath, buffer)

      logSystemEvent('warn', 'Database restored successfully from backup')
      res.json({ ok: true, message: 'Database restored successfully' })
    } catch(e: any) {
      res.status(500).json({ error: 'Database restore failed: ' + e.message })
    }
  })

  return r
}

