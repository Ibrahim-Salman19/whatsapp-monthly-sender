import Database from 'better-sqlite3'
import { join } from 'path'
import { readdirSync, readFileSync, mkdirSync } from 'fs'

const DATA_DIR = join(import.meta.dirname, '..', '..', 'data')
const DB_PATH = join(DATA_DIR, 'sender.db')

export function openDB(): Database.Database {
  mkdirSync(DATA_DIR, { recursive: true })
  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  seedDefaults(db)
  return db
}

function getMigrationVersion(db: Database.Database): number {
  const row = db.pragma('user_version', { simple: true }) as any
  return row ?? 0
}

function setMigrationVersion(db: Database.Database, version: number) {
  db.pragma(`user_version = ${version}`)
}

interface EmbeddedMigration {
  version: number
  name: string
  up: (db: Database.Database) => void
}

const EMBEDDED_MIGRATIONS: EmbeddedMigration[] = [
  {
    version: 1,
    name: '001_initial',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS contacts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          phone TEXT NOT NULL UNIQUE,
          active INTEGER NOT NULL DEFAULT 1,
          opted_out INTEGER NOT NULL DEFAULT 0,
          notes TEXT DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          body_template TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS schedules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          message_id INTEGER NOT NULL REFERENCES messages(id),
          day_of_month INTEGER NOT NULL DEFAULT 1,
          send_hour INTEGER NOT NULL DEFAULT 10,
          send_minute INTEGER NOT NULL DEFAULT 0,
          timezone TEXT NOT NULL DEFAULT 'Asia/Karachi',
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS exclusions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          contact_id INTEGER NOT NULL REFERENCES contacts(id),
          year_month TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(contact_id, year_month)
        );
        CREATE TABLE IF NOT EXISTS send_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          schedule_id INTEGER NOT NULL REFERENCES schedules(id),
          contact_id INTEGER NOT NULL REFERENCES contacts(id),
          period_key TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('sent','failed','skipped','opted_out')),
          sent_at TEXT,
          error TEXT DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(schedule_id, contact_id, period_key)
        );
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_contacts_active ON contacts(active, opted_out);
        CREATE INDEX IF NOT EXISTS idx_send_log_period ON send_log(period_key);
        CREATE INDEX IF NOT EXISTS idx_send_log_status ON send_log(status);
        CREATE INDEX IF NOT EXISTS idx_exclusions_month ON exclusions(year_month);
      `)
    },
  },
  {
    version: 2,
    name: '002_groups',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS "groups" (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          color TEXT DEFAULT '#25D366',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS contact_groups (
          contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
          group_id INTEGER NOT NULL REFERENCES "groups"(id) ON DELETE CASCADE,
          PRIMARY KEY (contact_id, group_id)
        );
        INSERT OR IGNORE INTO "groups" (name, color) VALUES ('Default', '#25D366');
      `)
    },
  },
  {
    version: 3,
    name: '003_multi_template',
    up: (db) => {
      const schedCols = (db.pragma('table_info(schedules)') as any[]).map(c => c.name)
      if (!schedCols.includes('group_id')) {
        db.exec('ALTER TABLE schedules ADD COLUMN group_id INTEGER REFERENCES "groups"(id);')
      }
      const contactCols = (db.pragma('table_info(contacts)') as any[]).map(c => c.name)
      if (!contactCols.includes('group_id')) {
        db.exec('ALTER TABLE contacts ADD COLUMN group_id INTEGER REFERENCES "groups"(id);')
      }
    },
  },
]

export function runMigrations(db: Database.Database) {
  const currentVersion = getMigrationVersion(db)

  // 1. Run embedded migrations safely
  for (const m of EMBEDDED_MIGRATIONS) {
    if (m.version > currentVersion) {
      console.log(`Running migration ${m.name} (v${m.version})...`)
      db.transaction(() => {
        m.up(db)
        setMigrationVersion(db, m.version)
      })()
    }
  }

  // 2. Also check if any external migration files exist beyond embedded version
  const migrationsDirs = [
    join(import.meta.dirname, 'migrations'),
    join(import.meta.dirname, '..', '..', 'src', 'db', 'migrations'),
  ]

  for (const dir of migrationsDirs) {
    let files: string[] = []
    try {
      files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
    } catch {
      continue
    }

    const latestVersion = getMigrationVersion(db)
    for (const file of files) {
      const match = file.match(/^(\d+)_/)
      if (!match) continue
      const version = parseInt(match[1])
      if (version <= latestVersion) continue

      console.log(`Running disk migration ${file}...`)
      const sql = readFileSync(join(dir, file), 'utf-8')
      db.transaction(() => {
        const statements = sql.split(';').filter(s => s.trim())
        for (const stmt of statements) {
          if (stmt.trim()) db.exec(stmt.trim())
        }
        setMigrationVersion(db, version)
      })()
    }
    break
  }
}


function seedDefaults(db: Database.Database) {
  // Seed default message if none exists
  const msgCount = db.prepare('SELECT COUNT(*) as c FROM messages').get() as { c: number }
  if (msgCount.c === 0) {
    db.prepare(`
      INSERT INTO messages (title, body_template) VALUES (?, ?)
    `).run(
      'Monthly Aeanat Reminder',
      'Assalamoalikum {{name}}, umeed hai aap khairiyat se honge. {{month}} ki aeanat de dein. JazakAllah khair'
    )
  }

  // Seed default schedule if none exists
  const schedCount = db.prepare('SELECT COUNT(*) as c FROM schedules').get() as { c: number }
  if (schedCount.c === 0) {
    const msgId = db.prepare('SELECT id FROM messages LIMIT 1').get() as { id: number }
    db.prepare(`
      INSERT INTO schedules (message_id, day_of_month, send_hour, send_minute, timezone, enabled)
      VALUES (?, 1, 10, 0, 'Asia/Karachi', 1)
    `).run(msgId.id)
  }

  // Seed default settings
  const defaults: Record<string, string> = {
    'delay_min_ms': '30000',
    'delay_max_ms': '90000',
    'daily_cap': '100',
    'catchup_hours': '72',
    'global_paused': 'false',
    'global_paused_until': '',
    'typing_duration_ms': '3000',
    'max_retries': '3',
  }

  const upsertSetting = db.prepare(`
    INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)
  `)
  for (const [k, v] of Object.entries(defaults)) {
    upsertSetting.run(k, v)
  }
}
