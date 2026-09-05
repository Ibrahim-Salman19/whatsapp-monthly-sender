import { Cron } from 'croner'
import { WASocket } from '@whiskeysockets/baileys'
import { getActiveSchedule, getSendLogForPeriod, getSetting } from '../db/index.js'
import { sendMonthlyMessages, type SendProgress } from '../sender/index.js'
import { EventEmitter } from 'events'

export type SchedulerStatus = 'idle' | 'running' | 'catching_up' | 'paused'

export class MonthlyScheduler extends EventEmitter {
  private cron: Cron | null = null
  private sock: WASocket | null = null
  private _status: SchedulerStatus = 'idle'
  private _lastRun: Date | null = null
  private _nextRun: Date | null = null
  private _currentProgress: SendProgress | null = null
  private _abortController: AbortController | null = null

  constructor() {
    super()
  }

  get status(): SchedulerStatus { return this._status }
  get lastRun(): Date | null { return this._lastRun }
  get nextRun(): Date | null { return this._nextRun }
  get currentProgress(): SendProgress | null { return this._currentProgress }

  start(sock: WASocket) {
    this.sock = sock
    this.schedule()
    this.checkCatchUp()
  }

  updateSocket(sock: WASocket | null) {
    this.sock = sock
    if (sock && this._status === 'idle') {
      this.checkCatchUp()
    }
  }

  stop() {
    this.cron?.stop()
    this.cron = null
  }

  abort(): boolean {
    if (this._abortController && this._status === 'running') {
      this._abortController.abort()
      return true
    }
    return false
  }

  schedule() {
    this.cron?.stop()
    this.cron = null

    const schedule = getActiveSchedule()
    if (!schedule || !schedule.enabled) {
      this._status = 'paused'
      this._nextRun = null
      this.emit('status', this._status)
      return
    }

    const cronExpr = `0 ${schedule.send_minute} ${schedule.send_hour} ${schedule.day_of_month} * *`

    try {
      this.cron = new Cron(
        cronExpr,
        {
          timezone: schedule.timezone,
        },
        async () => {
          await this.runSend()
        }
      )

      const next = this.cron.nextRun()
      this._nextRun = next
      this.emit('next_run', next)
      this.emit('status', this._status)
    } catch (e: any) {
      console.error('Failed to create schedule cron:', e.message)
    }
  }

  async checkCatchUp() {
    const catchupHours = parseInt(getSetting('catchup_hours') || getSetting('catch_up_window_hours') || '72')
    const now = new Date()
    const schedule = getActiveSchedule()

    if (!schedule || !schedule.enabled) return
    if (getSetting('global_paused') === 'true') return

    try {
      const cronExpr = `0 ${schedule.send_minute} ${schedule.send_hour} ${schedule.day_of_month} * *`
      const tempCron = new Cron(cronExpr, { timezone: schedule.timezone })
      const prevRun = tempCron.previousRun()
      if (!prevRun) return

      const elapsedMs = now.getTime() - prevRun.getTime()
      const elapsedHours = elapsedMs / (1000 * 60 * 60)

      if (elapsedHours >= 0 && elapsedHours <= catchupHours) {
        const periodKey = `${prevRun.getFullYear()}-${String(prevRun.getMonth() + 1).padStart(2, '0')}`
        const logs = getSendLogForPeriod(periodKey)
        const sentCount = logs.filter(l => l.status === 'sent').length

        if (sentCount === 0) {
          console.log(`Catch-up needed: Scheduled run was ${elapsedHours.toFixed(1)}h ago and 0 sends logged for ${periodKey}.`)
          this._status = 'catching_up'
          this.emit('status', this._status)
          this.emit('catch_up_needed', { periodKey, hoursSinceSendTime: elapsedHours })
        }
      }
    } catch (e: any) {
      console.error('Error during catch-up calculation:', e.message)
    }
  }

  async runSend(options?: { groupId?: number; targetContactIds?: number[] }): Promise<SendProgress | null> {
    if (!this.sock || this._status === 'running') return null

    const schedule = getActiveSchedule()
    if (!schedule || !schedule.enabled) return null

    this._status = 'running'
    this._abortController = new AbortController()
    this.emit('status', this._status)

    try {
      const progress = await sendMonthlyMessages(
        this.sock,
        (p) => {
          this._currentProgress = p
          this.emit('progress', p)
        },
        {
          groupId: options?.groupId ?? (schedule.group_id ?? undefined),
          targetContactIds: options?.targetContactIds,
          abortSignal: this._abortController.signal,
          getSocket: () => this.sock,
        }
      )

      this._currentProgress = progress
      this._lastRun = new Date()
      return progress
    } finally {
      this._abortController = null
      this._status = 'idle'
      this.emit('status', this._status)
      this.emit('last_run', this._lastRun)
      this.schedule()
    }
  }

  async manualRun(options?: { groupId?: number; targetContactIds?: number[] }): Promise<SendProgress | null> {
    if (!this.sock) {
      throw new Error('Socket not connected')
    }
    return this.runSend(options)
  }

  async getNextRunTime(): Promise<Date | null> {
    this.schedule()
    return this._nextRun
  }
}
