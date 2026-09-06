import { WASocket } from '@whiskeysockets/baileys'
import {
  getActiveSchedule, getActiveContacts, getMessage, logSend, hasAlreadySent,
  getSetting, markOptedOut, isExcluded, getDailySentCount, isWithinQuietHours,
  type Contact
} from '../db/index.js'
import { normalizePhone } from '../utils/phone.js'
import { processSpintax } from '../utils/spintax.js'

const URDU_MONTHS = [
  'جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون',
  'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر',
]

const ENGLISH_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export interface LogItem {
  name: string
  phone: string
  status: 'sent' | 'failed' | 'skipped' | 'sending'
  message?: string
  time: string
}

export interface SendProgress {
  total: number
  sent: number
  failed: number
  skipped: number
  current?: string
  currentPhone?: string
  status: 'idle' | 'running' | 'cooldown' | 'paused' | 'aborted' | 'done' | 'error'
  lastError?: string
  cooldownRemaining?: number
  currentBatch?: number
  totalBatches?: number
  done: boolean
  startedAt?: string
  finishedAt?: string
  logs: LogItem[]
}

export interface SendOptions {
  groupId?: number
  targetContactIds?: number[]
  abortSignal?: AbortSignal
  getSocket?: () => WASocket | null
}

async function resolveActiveSocket(
  fallback: WASocket,
  getSock?: () => WASocket | null,
  signal?: AbortSignal,
  maxWaitMs = 45000
): Promise<WASocket | null> {
  const cur = getSock ? getSock() : fallback
  if (cur && (cur as any).ws?.readyState === 1) return cur

  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    if (signal?.aborted) return null
    await abortableSleep(1500, signal)
    const reconnected = getSock ? getSock() : null
    if (reconnected && (reconnected as any).ws?.readyState === 1) {
      return reconnected
    }
  }
  return getSock ? getSock() : fallback
}

export function personalize(template: string, contact: Contact, month: string): string {
  const firstName = contact.name.trim().split(/\s+/)[0] || contact.name
  const now = new Date()
  const year = String(now.getFullYear())
  const notes = contact.notes || ''
  const dateStr = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

  const raw = template
    .replace(/\{\{name\}\}/gi, contact.name)
    .replace(/\{\{firstName\}\}/gi, firstName)
    .replace(/\{\{first_name\}\}/gi, firstName)
    .replace(/\{\{month\}\}/gi, month)
    .replace(/\{\{year\}\}/gi, year)
    .replace(/\{\{phone\}\}/gi, contact.phone)
    .replace(/\{\{notes\}\}/gi, notes)
    .replace(/\{\{date\}\}/gi, dateStr)

  return processSpintax(raw)
}

function randomDelay(minMs: number, maxMs: number): number {
  const min = Math.min(minMs, maxMs)
  const max = Math.max(minMs, maxMs)
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(true), ms)
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timer)
        resolve(false)
      }, { once: true })
    }
  })
}

export async function sendMonthlyMessages(
  sock: WASocket,
  onProgress?: (p: SendProgress) => void,
  options: SendOptions = {}
): Promise<SendProgress> {
  const now = new Date()
  const startedAt = now.toISOString()
  const periodKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const progress: SendProgress = {
    total: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    status: 'running',
    done: false,
    startedAt,
    logs: [],
  }

  const addLog = (name: string, phone: string, status: LogItem['status'], message?: string) => {
    const item: LogItem = {
      name,
      phone,
      status,
      message,
      time: new Date().toLocaleTimeString('en-US', { hour12: false }),
    }
    progress.logs.unshift(item)
    if (progress.logs.length > 100) progress.logs.pop()
  }

  if (getSetting('global_paused') === 'true') {
    console.log('Global pause is active. Skipping send.')
    progress.status = 'paused'
    progress.done = true
    progress.finishedAt = new Date().toISOString()
    onProgress?.(progress)
    return progress
  }

  const schedule = getActiveSchedule()
  if (!schedule || !schedule.enabled) {
    progress.status = 'idle'
    progress.done = true
    progress.finishedAt = new Date().toISOString()
    onProgress?.(progress)
    return progress
  }

  const message = getMessage(schedule.message_id)
  if (!message) {
    progress.status = 'error'
    progress.lastError = 'Message template not found'
    progress.done = true
    progress.finishedAt = new Date().toISOString()
    onProgress?.(progress)
    return progress
  }

  const monthNames = schedule.timezone.startsWith('Asia') ? URDU_MONTHS : ENGLISH_MONTHS
  const month = monthNames[now.getMonth()]

  // Safe sending hours / Quiet hours check
  if (!options.targetContactIds && isWithinQuietHours(schedule.timezone)) {
    const qStart = getSetting('quiet_hours_start') || '22:00'
    const qEnd = getSetting('quiet_hours_end') || '08:00'
    const msg = `Quiet hours active (${qStart} - ${qEnd}) in ${schedule.timezone}. Broadcast deferred until morning to protect account reputation.`
    console.log(msg)
    progress.status = 'paused'
    progress.lastError = msg
    progress.done = true
    progress.finishedAt = new Date().toISOString()
    addLog('System', '', 'skipped', msg)
    onProgress?.(progress)
    return progress
  }

  const delayMin = parseInt(getSetting('delay_min_ms') || '10000')
  const delayMax = parseInt(getSetting('delay_max_ms') || '35000')
  const maxRetries = parseInt(getSetting('max_retries') || '3')
  const typingDuration = parseInt(getSetting('typing_duration_ms') || '3000')
  const dailyCap = parseInt(getSetting('daily_cap') || '100')
  const batchSize = Math.max(1, parseInt(getSetting('batch_size') || '15'))
  const batchCooldownMs = Math.max(0, parseInt(getSetting('batch_cooldown_ms') || '120000'))
  const sentTodayBeforeRun = getDailySentCount()

  const targetGroupId = options.groupId ?? (schedule.group_id ? schedule.group_id : undefined)
  let contacts = targetGroupId ? getActiveContacts(targetGroupId) : getActiveContacts()

  // Filter to specific contact IDs if provided
  if (options.targetContactIds && options.targetContactIds.length > 0) {
    const targetSet = new Set(options.targetContactIds)
    contacts = contacts.filter(c => targetSet.has(c.id))
  }

  const excluded = new Set<number>()
  for (const c of contacts) {
    if (isExcluded(c.id, periodKey)) {
      excluded.add(c.id)
    }
  }

  const eligible = contacts.filter((c) => !excluded.has(c.id))
  progress.total = eligible.length
  const totalBatches = Math.ceil(eligible.length / batchSize) || 1
  progress.totalBatches = totalBatches
  onProgress?.(progress)

  for (let i = 0; i < eligible.length; i++) {
    const contact = eligible[i]
    progress.currentBatch = Math.floor(i / batchSize) + 1

    // Inter-batch cooldown pause (after every batchSize contacts sent or attempted)
    if (i > 0 && i % batchSize === 0 && !options.abortSignal?.aborted) {
      const prevBatch = Math.floor(i / batchSize)
      console.log(`Completed batch ${prevBatch} of ${totalBatches}. Starting cooldown break of ${Math.round(batchCooldownMs / 1000)}s...`)
      addLog('System', '', 'sending', `Batch break: Cooling down for ${Math.round(batchCooldownMs / 1000)}s to mimic human break...`)
      progress.status = 'cooldown'

      const totalCooldownSecs = Math.round(batchCooldownMs / 1000)
      for (let s = totalCooldownSecs; s > 0; s--) {
        if (options.abortSignal?.aborted) break
        progress.cooldownRemaining = s
        onProgress?.(progress)
        const continued = await abortableSleep(1000, options.abortSignal)
        if (!continued) break
      }
      progress.cooldownRemaining = 0
      progress.status = 'running'
      onProgress?.(progress)
      if (options.abortSignal?.aborted) break
    }

    // Check for abort request
    if (options.abortSignal?.aborted) {
      console.log('Monthly send was aborted by user.')
      progress.status = 'aborted'
      progress.current = undefined
      progress.currentPhone = undefined
      progress.done = true
      progress.finishedAt = new Date().toISOString()
      addLog('System', '', 'skipped', 'Send aborted by user')
      onProgress?.(progress)
      return progress
    }

    // Check daily cap (combining today's existing sends with this run)
    if (sentTodayBeforeRun + progress.sent >= dailyCap) {
      progress.skipped++
      logSend(schedule.id, contact.id, periodKey, 'skipped', 'daily_cap_exceeded')
      addLog(contact.name, contact.phone, 'skipped', `Daily cap of ${dailyCap} reached`)
      continue
    }

    // Check if already sent this month (unless targeted specifically)
    if (!options.targetContactIds && hasAlreadySent(schedule.id, contact.id, periodKey)) {
      progress.skipped++
      addLog(contact.name, contact.phone, 'skipped', 'Already sent this month')
      continue
    }

    const cleanPhone = normalizePhone(contact.phone)
    const jid = `${cleanPhone}@s.whatsapp.net`
    const text = personalize(message.body_template, contact, month)

    progress.current = contact.name
    progress.currentPhone = contact.phone
    addLog(contact.name, contact.phone, 'sending', 'Typing & sending...')
    onProgress?.(progress)

    let sent = false
    for (let attempt = 0; attempt < maxRetries && !sent; attempt++) {
      if (options.abortSignal?.aborted) break

      const activeSock = await resolveActiveSocket(sock, options.getSocket, options.abortSignal)
      if (!activeSock) {
        console.warn(`WhatsApp socket unavailable. Aborting send attempt for ${contact.name}.`)
        break
      }

      // Proactively verify whether number exists on WhatsApp
      try {
        const onWa = await activeSock.onWhatsApp(cleanPhone)
        if (onWa && onWa.length > 0 && !onWa[0].exists) {
          progress.failed++
          const reason = 'Number not registered on WhatsApp'
          logSend(schedule.id, contact.id, periodKey, 'failed', reason)
          addLog(contact.name, contact.phone, 'failed', reason)
          break
        }
      } catch {}

      try {
        // Presence simulation with dynamic typing time based on message length
        const dynamicTypingMs = Math.min(Math.max(text.length * 35, typingDuration), 8000) + Math.floor(Math.random() * 800)
        try {
          await activeSock.sendPresenceUpdate('composing', jid)
        } catch {}

        const continued = await abortableSleep(dynamicTypingMs, options.abortSignal)
        if (!continued) break

        await activeSock.sendMessage(jid, { text })

        try {
          await activeSock.sendPresenceUpdate('paused', jid)
        } catch {}

        sent = true
        progress.sent++
        logSend(schedule.id, contact.id, periodKey, 'sent')
        addLog(contact.name, contact.phone, 'sent', 'Delivered')
      } catch (err: any) {
        const errMsg = err?.message || String(err)
        if (attempt < maxRetries - 1) {
          const backoff = Math.min(4000 * Math.pow(1.8, attempt), 25_000)
          console.log(`Send to ${contact.name} (${contact.phone}) failed: ${errMsg}. Retrying in ${Math.round(backoff/1000)}s...`)
          const continued = await abortableSleep(backoff, options.abortSignal)
          if (!continued) break
        } else {
          progress.failed++
          logSend(schedule.id, contact.id, periodKey, 'failed', errMsg)
          addLog(contact.name, contact.phone, 'failed', errMsg)
        }
      }
    }

    onProgress?.(progress)

    // Randomized anti-ban delay before next recipient
    if (i < eligible.length - 1 && !options.abortSignal?.aborted) {
      const delay = randomDelay(delayMin, delayMax)
      const continued = await abortableSleep(delay, options.abortSignal)
      if (!continued) break
    }
  }

  progress.done = true
  progress.current = undefined
  progress.currentPhone = undefined
  progress.status = options.abortSignal?.aborted ? 'aborted' : 'done'
  progress.finishedAt = new Date().toISOString()
  onProgress?.(progress)

  return progress
}

export async function sendSingleTestMessage(
  sock: WASocket,
  phone: string,
  text: string
): Promise<{ ok: boolean; error?: string }> {
  const cleanPhone = normalizePhone(phone)
  const jid = `${cleanPhone}@s.whatsapp.net`
  try {
    try {
      await sock.sendPresenceUpdate('composing', jid)
      await new Promise(r => setTimeout(r, 1500))
    } catch {}
    await sock.sendMessage(jid, { text })
    try {
      await sock.sendPresenceUpdate('paused', jid)
    } catch {}
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
}

export function isStopMessage(text: string): boolean {
  const t = text.trim().toLowerCase()
  return ['stop', 'unsubscribe', 'ناٹ سبسکرائب', 'rb', 'آرب', 'توقف'].includes(t)
}

