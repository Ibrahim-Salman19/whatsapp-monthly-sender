import express from 'express'
import cookieSession from 'cookie-session'
import { join } from 'path'
import { existsSync } from 'fs'
import { createAPIRoutes } from './routes.js'
import { createAuthRoutes, requireAuth, isFirstBoot, getSessionSecret } from './auth.js'
import { rateLimit } from 'express-rate-limit'

export function createServer(port: number = parseInt(process.env.PORT || '3000')) {
  const app = express()

  // Body size limit
  app.use(express.json({ limit: '2mb' }))

  // Rate limiting
  const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 1000,
    standardHeaders: 'draft-8',
  })
  app.use(globalLimiter)

  // Session middleware — MUST be mounted before auth routes and API routes
  app.use(cookieSession({
    name: 'wa_session',
    keys: [getSessionSecret()],
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    httpOnly: true,
    sameSite: 'lax',
  }))

  // Auth routes (has full session access for setup, login, logout, change-password)
  app.use('/api/auth', createAuthRoutes())

  // Route-specific rate limiters
  const sendNowLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    message: { error: 'Too many send requests. Please wait a moment.' },
  })

  const contactsLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
  })

  // Protected API routes
  app.use('/api', requireAuth, createAPIRoutes(sendNowLimiter, contactsLimiter))

  // Dashboard file path resolution (works in dev and dist)
  const dashboardPath = existsSync(join(import.meta.dirname, 'dashboard.html'))
    ? join(import.meta.dirname, 'dashboard.html')
    : join(import.meta.dirname, '..', '..', 'src', 'api', 'dashboard.html')

  app.get('/', (_req, res) => res.sendFile(dashboardPath))
  app.get('/dashboard', (_req, res) => res.sendFile(dashboardPath))

  // Health check
  app.get('/health', (_req, res) => res.json({ ok: true }))

  return { app, port }
}

