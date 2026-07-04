import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { DateRule } from './dateRules.js';
import { seedHolidays } from './holidaySeeds.js';

export interface CalendarEvent {
  id: string;
  name: string;
  category: 'holiday' | 'custom';
  dateRule: DateRule;
  recursYearly: boolean;
  enabled: boolean;
  groupId: string | null;
  triggerTime: { type: 'fixed'; time: string } | { type: 'sunset' | 'sunrise'; offsetMinutes: number };
  actionType: 'power' | 'brightness' | 'preset' | 'theme' | null;
  actionPayload: unknown;
}

function fromRow(row: any): CalendarEvent {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    dateRule: JSON.parse(row.date_rule),
    recursYearly: !!row.recurs_yearly,
    enabled: !!row.enabled,
    groupId: row.group_id,
    triggerTime: JSON.parse(row.trigger_time),
    actionType: row.action_type,
    actionPayload: row.action_payload ? JSON.parse(row.action_payload) : null
  };
}

export function createCalendarRepository(db: Database.Database) {
  return {
    list(): CalendarEvent[] {
      return db.prepare('SELECT * FROM calendar_events ORDER BY name').all().map(fromRow);
    },
    get(id: string): CalendarEvent | undefined {
      const row = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(id);
      return row ? fromRow(row) : undefined;
    },
    isEmpty(): boolean {
      const row: any = db.prepare('SELECT COUNT(*) as count FROM calendar_events').get();
      return row.count === 0;
    },
    add(input: Omit<CalendarEvent, 'id'>): CalendarEvent {
      const id = randomUUID();
      db.prepare(
        `INSERT INTO calendar_events
          (id, name, category, date_rule, recurs_yearly, enabled, group_id, trigger_time, action_type, action_payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id, input.name, input.category, JSON.stringify(input.dateRule),
        input.recursYearly ? 1 : 0, input.enabled ? 1 : 0, input.groupId,
        JSON.stringify(input.triggerTime), input.actionType,
        input.actionPayload !== null && input.actionPayload !== undefined ? JSON.stringify(input.actionPayload) : null
      );
      return { id, ...input };
    },
    update(id: string, patch: Partial<Omit<CalendarEvent, 'id'>>): CalendarEvent {
      const current = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(id);
      if (!current) throw new Error(`calendar event ${id} not found`);
      const existing = fromRow(current);
      const next = { ...existing, ...patch };
      db.prepare(
        `UPDATE calendar_events SET name = ?, category = ?, date_rule = ?, recurs_yearly = ?,
          enabled = ?, group_id = ?, trigger_time = ?, action_type = ?, action_payload = ?
         WHERE id = ?`
      ).run(
        next.name, next.category, JSON.stringify(next.dateRule), next.recursYearly ? 1 : 0,
        next.enabled ? 1 : 0, next.groupId, JSON.stringify(next.triggerTime), next.actionType,
        next.actionPayload !== null && next.actionPayload !== undefined ? JSON.stringify(next.actionPayload) : null,
        id
      );
      return next;
    },
    remove(id: string): void {
      db.prepare('DELETE FROM calendar_events WHERE id = ?').run(id);
    }
  };
}

export function seedHolidaysIfEmpty(db: Database.Database): void {
  const repo = createCalendarRepository(db);
  if (!repo.isEmpty()) return;
  for (const holiday of seedHolidays()) {
    repo.add(holiday);
  }
}
