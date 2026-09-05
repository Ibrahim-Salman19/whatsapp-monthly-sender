-- Migration 003: Multiple templates support
-- Add group_id to schedules for per-group targeting
ALTER TABLE schedules ADD COLUMN group_id INTEGER REFERENCES "groups"(id);

-- Add group_id to contacts for group assignment
ALTER TABLE contacts ADD COLUMN group_id INTEGER REFERENCES "groups"(id);
