import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  Browsers,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import { EventEmitter } from 'events'
import pino from 'pino'
import { mkdir, rm } from 'fs/promises'
import qrcode from 'qrcode-terminal'
import QRCode from 'qrcode'
import { normalizePhone } from '../utils/phone.js'

export type SessionStatus = 'disconnected' | 'connecting' | 'connected' | 'needs_qr' | 'error'

export class SessionManager extends EventEmitter {
  private sock: WASocket | null = null
  private authDir: string
  private phoneNumber: string | undefined
  private logger
  private _status: SessionStatus = 'disconnected'
  private reconnectAttempts = 0
  private _lastQR: string | null = null
  private _qrDataUrl: string | null = null
  private _pairingCode: string | null = null
  private connectionPromise: {
    resolve: () => void
    reject: (e: Error) => void
  } | null = null

  constructor(authDir: string, phoneNumber?: string) {
    super()
    this.authDir = authDir
    this.phoneNumber = phoneNumber ? normalizePhone(phoneNumber) : undefined
    const logLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')
    this.logger = pino({ 
      level: logLevel,
      ...(process.env.NODE_ENV !== 'production' && {
        transport: { target: 'pino-pretty', options: { colorize: true } }
      })
    })
  }

  get status(): SessionStatus {
    return this._status
  }

  get socket(): WASocket | null {
    return this.sock
  }

  get lastQR(): string | null {
    return this._lastQR
  }

  get qrDataUrl(): string | null {
    return this._qrDataUrl
  }

  get pairingCode(): string | null {
    return this._pairingCode
  }

  get linkedNumber(): string | null {
    if (!this.sock?.user?.id) return null
    return this.sock.user.id.split(':')[0] || null
  }

  private setStatus(status: SessionStatus) {
    this._status = status
    this.emit('status', status)
  }

  async connect(): Promise<void> {
    if (this.sock) {
      try {
        this.sock.ws?.close()
      } catch {}
      this.sock = null
    }

    await mkdir(this.authDir, { recursive: true })
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir)

    this.sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, this.logger),
      },
      browser: Browsers.ubuntu('Chrome'),
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      logger: this.logger,
      connectTimeoutMs: 60_000,
      qrTimeout: 60_000,
    })

    this.setStatus('connecting')

    this.sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut

        if (statusCode === DisconnectReason.loggedOut) {
          console.log('\nLogged out. Clearing session — scan QR again to reconnect.')
          await rm(this.authDir, { recursive: true, force: true })
          this.reconnectAttempts = 0
          this._lastQR = null
          this._qrDataUrl = null
          this._pairingCode = null
          this.setStatus('needs_qr')
          this.connect()
          return
        }

        if (shouldReconnect) {
          this.reconnectAttempts++
          // Resilient exponential backoff with a cap of 45 seconds (never give up permanently!)
          const delay = Math.min(2000 * Math.pow(1.6, Math.min(this.reconnectAttempts - 1, 6)), 45_000)
          console.log(`Connection closed. Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts})...`)
          this.setStatus('connecting')
          setTimeout(() => this.connect(), delay)
        } else {
          console.log('Session closed and reconnection disabled.')
          this.setStatus('disconnected')
        }
      } else if (connection === 'open') {
        this.reconnectAttempts = 0
        this._lastQR = null
        this._qrDataUrl = null
        this._pairingCode = null
        this.setStatus('connected')
        this.emit('socket', this.sock)
        this.connectionPromise?.resolve()
        console.log(`Connected to WhatsApp. Logged in as: ${this.linkedNumber || 'unknown'}`)
      }

      if (qr) {
        this._lastQR = qr
        try {
          this._qrDataUrl = await QRCode.toDataURL(qr, { width: 320, margin: 2 })
        } catch {
          this._qrDataUrl = null
        }
        this.setStatus('needs_qr')
        console.log('\nScan this QR code from your phone:\n')
        qrcode.generate(qr, { small: true }, (code: string) => {
          console.log(code)
        })
        this.emit('qr', qr)
        this.emit('qr_data_url', this._qrDataUrl)

        if (this.phoneNumber && !state.creds.registered) {
          try {
            const code = await this.sock!.requestPairingCode(this.phoneNumber)
            this._pairingCode = code
            console.log(`\nOr enter this pairing code on your phone:\n  ${code}\n`)
            this.emit('pairing_code', code)
          } catch {
            // QR-only mode is fine
          }
        }
      }
    })

    this.sock.ev.on('creds.update', saveCreds)

    this.sock.ev.on('messages.upsert', (event) => {
      for (const m of event.messages) {
        if (!m.key.fromMe && event.type === 'notify') {
          this.emit('message', m)
        }
      }
    })
  }

  waitForConnection(): Promise<void> {
    if (this._status === 'connected') return Promise.resolve()
    return new Promise((resolve, reject) => {
      this.connectionPromise = { resolve, reject }
      const onStatus = (s: SessionStatus) => {
        if (s === 'connected') {
          this.off('status', onStatus)
          resolve()
        } else if (s === 'error') {
          this.off('status', onStatus)
          reject(new Error('Session error'))
        }
      }
      this.on('status', onStatus)
    })
  }

  async sendMessage(jid: string, text: string): Promise<boolean> {
    if (!this.sock || this._status !== 'connected') {
      throw new Error('Not connected to WhatsApp')
    }
    try {
      await this.sock.sendMessage(jid, { text })
      return true
    } catch {
      return false
    }
  }

  async relink(): Promise<void> {
    console.log('Relink requested. Clearing session data...')
    try {
      this.sock?.ws?.close()
    } catch {}
    await rm(this.authDir, { recursive: true, force: true })
    this.reconnectAttempts = 0
    this._lastQR = null
    this._qrDataUrl = null
    this._pairingCode = null
    this.setStatus('needs_qr')
    await this.connect()
  }

  async reconnect(): Promise<void> {
    this.reconnectAttempts = 0
    try {
      this.sock?.ws?.close()
    } catch {}
    await this.connect()
  }

  async disconnect(): Promise<void> {
    this.sock?.ws?.close()
    this.setStatus('disconnected')
  }

  async requestPairingCode(phone: string): Promise<string> {
    if (!this.sock) {
      throw new Error('WhatsApp session is not active. Please wait a moment.')
    }
    if (this._status === 'connected') {
      throw new Error('WhatsApp is already connected.')
    }
    const clean = normalizePhone(phone)
    if (!clean || clean.length < 10) {
      throw new Error('Invalid phone number format for pairing (must be 10-15 digits).')
    }
    try {
      const code = await this.sock.requestPairingCode(clean)
      this._pairingCode = code
      this.emit('pairing_code', code)
      return code
    } catch (e: any) {
      throw new Error(`WhatsApp pairing failed: ${e?.message || String(e)}`)
    }
  }

  phoneToJid(phone: string): string {
    const clean = normalizePhone(phone)
    return `${clean}@s.whatsapp.net`
  }
}

