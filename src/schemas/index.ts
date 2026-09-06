import { z } from 'zod'
import { normalizePhone } from '../utils/phone.js'

export const ContactCreateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100).trim(),
  phone: z.string()
    .transform(v => normalizePhone(v))
    .refine(v => /^\d{10,15}$/.test(v), { message: 'Phone must be 10-15 digits with country code (e.g. 923001234567)' }),
  notes: z.string().max(500).optional().default(''),
  groupId: z.number().int().positive().nullable().optional(),
})

export const ContactUpdateSchema = z.object({
  name: z.string().min(1).max(100).trim().optional(),
  phone: z.string()
    .transform(v => normalizePhone(v))
    .refine(v => /^\d{10,15}$/.test(v), { message: 'Phone must be 10-15 digits with country code' })
    .optional(),
  active: z.number().int().min(0).max(1).optional(),
  opted_out: z.number().int().min(0).max(1).optional(),
  notes: z.string().max(500).optional(),
  groupId: z.number().int().positive().nullable().optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field required' })

export const MessageUpdateSchema = z.object({
  title: z.string().min(1).max(100).trim().optional(),
  body_template: z.string().min(1).max(5000).trim(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field required' })

export const ScheduleUpdateSchema = z.object({
  day_of_month: z.number().int().min(1).max(28).optional(),
  send_hour: z.number().int().min(0).max(23).optional(),
  send_minute: z.number().int().min(0).max(59).optional(),
  timezone: z.string().max(50).optional(),
  enabled: z.number().int().min(0).max(1).optional(),
  message_id: z.number().int().positive().optional(),
  group_id: z.number().int().positive().nullable().optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field required' })

export const ExclusionSchema = z.object({
  contactId: z.number().int().positive(),
  yearMonth: z.string().regex(/^\d{4}-\d{2}$/, 'Format: YYYY-MM'),
})

const ALLOWED_SETTINGS = [
  'delay_min_ms', 'delay_max_ms', 'daily_cap', 'catchup_hours',
  'min_delay_ms', 'max_delay_ms', 'daily_send_limit', 'catch_up_window_hours',
  'global_paused', 'global_paused_until', 'typing_duration_ms', 'max_retries', 'owner_phone',
  'batch_size', 'batch_cooldown_ms', 'quiet_hours_enabled', 'quiet_hours_start', 'quiet_hours_end',
] as const

export const SettingsUpdateSchema = z.object({
  key: z.enum(ALLOWED_SETTINGS),
  value: z.string(),
})

export const SettingsBulkUpdateSchema = z.record(
  z.enum(ALLOWED_SETTINGS),
  z.string()
)

// ── Groups ──

export const GroupCreateSchema = z.object({
  name: z.string().min(1).max(50).trim(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid hex color').optional().default('#25D366'),
})

export const GroupUpdateSchema = z.object({
  name: z.string().min(1).max(50).trim().optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid hex color').optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field required' })

export const ContactGroupSchema = z.object({
  contactId: z.number().int().positive(),
  groupId: z.number().int().positive(),
})

// ── Messages (multi-template) ──

export const MessageCreateSchema = z.object({
  title: z.string().min(1).max(100).trim(),
  body_template: z.string().min(1).max(5000).trim(),
})

// ── Actions ──

export const SendTestSchema = z.object({
  phone: z.string().optional(),
  messageId: z.number().int().positive().optional(),
  customMessage: z.string().max(5000).optional(),
})

export const SendNowSchema = z.object({
  groupId: z.number().int().positive().optional(),
  contactIds: z.array(z.number().int().positive()).optional(),
}).optional()

