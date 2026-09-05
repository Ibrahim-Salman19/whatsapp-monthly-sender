import 'dotenv/config'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { randomBytes } from 'crypto'
import { SessionManager } from './session/manager.js'
import { MonthlyScheduler } from './scheduler/index.js'
import { getDB, markOptedOut, getActiveContacts, getActiveSchedule, getSendLogForPeriod, getSetting } from './db/index.js'
import { isStopMessage } from './sender/index.js'
import { createServer } from './api/server.js'
import { setSession, setScheduler, logSystemEvent } from './api/routes.js'

const DATA_DIR = join(import.meta.dirname, '..', 'data')
const ENV_PATH = join(import.meta.dirname, '..', '.env')

function ensureEncryptionKey(): string {
  if (process.env.SESSION_ENCRYPTION_KEY) return process.env.SESSION_ENCRYPTION_KEY
  if (existsSync(ENV_PATH)) {
    const env = readFileSync(ENV_PATH, 'utf-8')
    const match = env.match(/SESSION_ENCRYPTION_KEY=(.+)/)
    if (match) return match[1]
  }
  const key = randomBytes(32).toString('hex')
  const suffix = `\nSESSION_ENCRYPTION_KEY=${key}\n`
  if (existsSync(ENV_PATH)) {
    writeFileSync(ENV_PATH, readFileSync(ENV_PATH, 'utf-8') + suffix)
  } else {
    writeFileSync(ENV_PATH, suffix)
  }
  console.log('Generated new session encryption key.')
  return key
}

function formatPeriodKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

async function main() {
  const args = process.argv.slice(2)
  const sendNow = args.includes('--send-now')
  const manualRun = args.includes('--run-now')
  const status = args.includes('--status')
  const targetPhone = args.find((a) => !a.startsWith('--'))

  ensureEncryptionKey()

  // Status check (no WhatsApp needed)
  if (status) {
    const schedule = getActiveSchedule()
    const now = new Date()
    const periodKey = formatPeriodKey(now)
    const logs = getSendLogForPeriod(periodKey)
    const contacts = getActiveContacts()
    console.log(`Schedule: day ${schedule?.day_of_month ?? 1} @ ${schedule?.send_hour ?? 10}:${String(schedule?.send_minute ?? 0).padStart(2, '0')} ${schedule?.timezone}`)
    console.log(`Active contacts: ${contacts.length}`)
    console.log(`This month (${periodKey}): ${logs.filter((l) => l.status === 'sent').length} sent, ${logs.filter((l) => l.status === 'failed').length} failed, ${logs.filter((l) => l.status === 'skipped').length} skipped`)
    process.exit(0)
  }

  const phoneNumber = getSetting('owner_phone') || process.env.OWNER_PHONE || undefined
  const session = new SessionManager(join(DATA_DIR, 'auth'), phoneNumber)
  const scheduler = new MonthlyScheduler()

  session.on('status', (s) => {
    logSystemEvent('info', `WhatsApp session status: ${s}`)
    if (s === 'connected') {
      console.log('WhatsApp connected. Scheduler active.')
      logSystemEvent('info', `WhatsApp linked successfully as +${session.linkedNumber || 'unknown'}`)
    } else if (s === 'needs_qr') {
      console.log('Waiting for QR scan on dashboard or terminal...')
      logSystemEvent('warn', 'WhatsApp requires QR code scan or pairing code to connect')
    }
  })

  // Keep scheduler's active socket in sync whenever session reconnects
  session.on('socket', (sock) => {
    if (sock) {
      if (!scheduler.nextRun) {
        scheduler.start(sock)
      } else {
        scheduler.updateSocket(sock)
      }
    }
  })

  // STOP message detection
  session.on('message', async (msg: any) => {
    try {
      const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || ''
      if (!isStopMessage(text)) return
      const phone = msg.key.remoteJid?.replace('@s.whatsapp.net', '')
      if (!phone) return
      markOptedOut(phone)
      console.log(`Opted out: ${phone}`)
      logSystemEvent('warn', `Contact +${phone} opted out via STOP message`)
      await session.sendMessage(msg.key.remoteJid, 'You have been unsubscribed. You will no longer receive messages.')
    } catch (err: any) {
      console.error('Error handling incoming message:', err.message)
      logSystemEvent('error', `Incoming message error: ${err.message}`)
    }
  })

  scheduler.on('catch_up_needed', async ({ periodKey, hoursSinceSendTime }: { periodKey: string; hoursSinceSendTime: number }) => {
    const msg = `Catch-up: running missed send for ${periodKey} (${hoursSinceSendTime.toFixed(1)}h overdue)`
    console.log(msg)
    logSystemEvent('warn', msg)
    await scheduler.runSend()
  })

  scheduler.on('status', (s) => {
    logSystemEvent('info', `Scheduler status changed to: ${s}`)
    if (s === 'running') console.log('Monthly send in progress...')
    else if (s === 'catching_up') console.log('Catch-up: missed send detected, running now...')
  })

  scheduler.on('progress', (p: any) => {
    if (p.done) {
      const msg = `Send complete: ${p.sent} sent, ${p.failed} failed, ${p.skipped} skipped (of ${p.total})`
      console.log(msg)
      logSystemEvent('info', msg)
    } else if (p.current) {
      console.log(`  Sending to ${p.current}... (${p.sent + p.failed}/${p.total})`)
    }
  })

  await session.connect()

  // Start dashboard server
  const { app, port } = createServer()
  setSession(session)
  setScheduler(scheduler)
  app.listen(port, () => {
    console.log(`Dashboard: http://localhost:${port}`)
  })

  if (sendNow) {
    await session.waitForConnection()
    const recipient = targetPhone
      ? session.phoneToJid(targetPhone)
      : phoneNumber
        ? session.phoneToJid(phoneNumber)
        : null
    if (!recipient) {
      console.error('Provide a phone number: --send-now 923001234567')
      process.exit(1)
    }
    console.log(`Sending test message to ${recipient}...`)
    const ok = await session.sendMessage(recipient, '✅ WhatsApp Monthly Sender — connection test.')
    console.log(ok ? 'Message sent.' : 'Failed to send.')
    process.exit(ok ? 0 : 1)
  }

  if (manualRun) {
    await session.waitForConnection()
    console.log('Running monthly send on demand...')
    const result = await scheduler.manualRun()
    if (result) {
      console.log(`Done: ${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped`)
    }
    process.exit(0)
  }

  // Start scheduler after connection is ready
  session.waitForConnection().then(() => {
    if (session.socket) scheduler.start(session.socket)
  })

  console.log(`Starting WhatsApp Monthly Sender (env: ${process.env.NODE_ENV || 'development'})`)
  console.log(`Log level: ${process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')}`)
  console.log('Press Ctrl+C to disconnect.')

  process.on('unhandledRejection', (reason: any) => {
    const msg = `Unhandled Rejection: ${reason?.message || reason}`
    console.error(msg)
    logSystemEvent('error', msg)
  })

  process.on('uncaughtException', (err: Error) => {
    const msg = `Uncaught Exception: ${err.message}`
    console.error(msg, err.stack)
    logSystemEvent('error', msg)
  })

  const shutdown = async () => {
    console.log('\nShutting down...')
    scheduler.stop()
    await session.disconnect()
    try {
      const db = getDB()
      db.pragma('wal_checkpoint(TRUNCATE)')
      db.close()
    } catch {}
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((e) => {
  console.error('Fatal:', e)
  process.exit(1)
})
