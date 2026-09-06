import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { randomBytes } from 'crypto'

const DATA_DIR = join(import.meta.dirname, '..', '..', 'data')
const AUTH_FILE = join(DATA_DIR, 'auth.json')

// Simple in-memory rate limiter for auth attempts
const loginAttempts = new Map<string, { count: number; resetAt: number }>()
const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 15 * 60 * 1000 // 15 minutes

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = loginAttempts.get(ip)
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOCKOUT_MS })
    return true
  }
  if (entry.count >= MAX_ATTEMPTS) return false
  entry.count++
  return true
}

interface AuthFile {
  passwordHash: string
  sessionSecret: string
}

function loadAuth(): AuthFile | null {
  if (!existsSync(AUTH_FILE)) return null
  try {
    return JSON.parse(readFileSync(AUTH_FILE, 'utf-8'))
  } catch {
    return null
  }
}

function saveAuth(auth: AuthFile) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2))
}

export function isFirstBoot(): boolean {
  return loadAuth() === null
}

export function setupPassword(password: string) {
  const hash = bcrypt.hashSync(password, 12)
  const sessionSecret = randomBytes(32).toString('hex')
  saveAuth({ passwordHash: hash, sessionSecret })
}

export function getSessionSecret(): string {
  const auth = loadAuth()
  if (auth?.sessionSecret) return auth.sessionSecret
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET
  if (process.env.SESSION_ENCRYPTION_KEY) return process.env.SESSION_ENCRYPTION_KEY
  return 'wa-sender-persistent-session-secret-fallback'
}

export function verifyPassword(password: string): boolean {
  const auth = loadAuth()
  if (!auth) return false
  return bcrypt.compareSync(password, auth.passwordHash)
}

export function createAuthRoutes(): Router {
  const r = Router()

  // First boot - set password
  r.post('/setup', (req, res) => {
    if (!isFirstBoot()) return res.status(400).json({ error: 'Already configured' })
    const { password } = req.body
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Password required' })
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be 6+ characters' })
    }
    if (password.length > 128) {
      return res.status(400).json({ error: 'Password too long' })
    }
    setupPassword(password)
    req.session = { authenticated: true } as any
    res.json({ ok: true })
  })

  // Quick start for instant 1-click onboarding (sets default password 'admin123' if first boot)
  r.post('/quick-start', (req, res) => {
    if (isFirstBoot()) {
      setupPassword('admin123')
    }
    req.session = { authenticated: true } as any
    res.json({ ok: true, message: 'Welcome! Access granted with default password admin123 (changeable in Settings).' })
  })

  // Change password (authenticated)
  r.post('/change-password', (req, res) => {
    if (req.session?.authenticated !== true) {
      return res.status(401).json({ error: 'Authentication required' })
    }
    const { currentPassword, newPassword } = req.body
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Both current and new password are required' })
    }
    if (!verifyPassword(currentPassword)) {
      return res.status(401).json({ error: 'Current password is incorrect' })
    }
    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' })
    }
    if (newPassword.length > 128) {
      return res.status(400).json({ error: 'New password too long' })
    }
    setupPassword(newPassword)
    req.session = { authenticated: true } as any
    res.json({ ok: true, message: 'Password updated successfully' })
  })

  // Login
  r.post('/login', (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown'
    if (!checkRateLimit(ip)) {
      return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' })
    }
    const { password } = req.body
    if (!password || typeof password !== 'string') {
      return res.status(401).json({ error: 'Invalid password' })
    }
    if (!verifyPassword(password)) {
      return res.status(401).json({ error: 'Invalid password' })
    }
    req.session = { authenticated: true } as any
    loginAttempts.delete(ip)
    res.json({ ok: true })
  })

  // Logout
  r.post('/logout', (req, res) => {
    req.session = null as any
    res.json({ ok: true })
  })

  // Check auth status
  r.get('/status', (req, res) => {
    if (isFirstBoot()) return res.json({ firstBoot: true, authenticated: false })
    const authenticated = (req.session as any)?.authenticated === true
    res.json({ firstBoot: false, authenticated })
  })

  return r
}

export function requireAuth(req: any, res: any, next: any) {
  if (isFirstBoot()) return next() // Allow setup
  if (req.session?.authenticated === true) return next()
  res.status(401).json({ error: 'Authentication required' })
}
