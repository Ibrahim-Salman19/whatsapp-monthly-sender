import { getDB } from './index.js'

export interface Group {
  id: number
  name: string
  color: string
  created_at: string
}

export function getGroups(): Group[] {
  return getDB().prepare('SELECT * FROM "groups" ORDER BY name').all() as Group[]
}

export function getGroupById(id: number): Group | undefined {
  return getDB().prepare('SELECT * FROM "groups" WHERE id = ?').get(id) as Group | undefined
}

export function createGroup(name: string, color: string = '#25D366'): Group {
  const result = getDB()
    .prepare('INSERT INTO "groups" (name, color) VALUES (?, ?)')
    .run(name, color)
  return getGroupById(Number(result.lastInsertRowid))!
}

export function updateGroup(id: number, data: Partial<Pick<Group, 'name' | 'color'>>) {
  const ALLOWED = ['name', 'color']
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
  getDB().prepare(`UPDATE "groups" SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
}

export function deleteGroup(id: number) {
  getDB().prepare('DELETE FROM "groups" WHERE id = ?').run(id)
}

export function assignContactToGroup(contactId: number, groupId: number) {
  getDB()
    .prepare('INSERT OR IGNORE INTO contact_groups (contact_id, group_id) VALUES (?, ?)')
    .run(contactId, groupId)
}

export function removeContactFromGroup(contactId: number, groupId: number) {
  getDB()
    .prepare('DELETE FROM contact_groups WHERE contact_id = ? AND group_id = ?')
    .run(contactId, groupId)
}

export function getContactsByGroup(groupId: number): number[] {
  const rows = getDB()
    .prepare('SELECT contact_id FROM contact_groups WHERE group_id = ?')
    .all(groupId) as { contact_id: number }[]
  return rows.map(r => r.contact_id)
}

export function getGroupsForContact(contactId: number): number[] {
  const rows = getDB()
    .prepare('SELECT group_id FROM contact_groups WHERE contact_id = ?')
    .all(contactId) as { group_id: number }[]
  return rows.map(r => r.group_id)
}

export function getContactsByGroupWithDetails(groupId: number) {
  return getDB()
    .prepare(`
      SELECT c.* FROM contacts c
      INNER JOIN contact_groups cg ON c.id = cg.contact_id
      WHERE cg.group_id = ? AND c.active = 1 AND c.opted_out = 0
    `)
    .all(groupId)
}
