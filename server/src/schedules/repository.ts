import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export interface Schedule {
  id: string;
  name: string;
  triggerType: 'cron' | 'sunrise' | 'sunset' | 'weekly';
  cronExpr: string | null;
  daysOfWeek: number[] | null;
  timeOfDay: string | null;
  offsetMinutes: number;
  latitude: number | null;
  longitude: number | null;
  groupId: string;
  actionType: 'power' | 'brightness' | 'preset' | 'theme';
  actionPayload: unknown;
  enabled: boolean;
}

function fromRow(row: any): Schedule {
  return {
    id: row.id,
    name: row.name,
    triggerType: row.trigger_type,
    cronExpr: row.cron_expr,
    daysOfWeek: row.days_of_week ? JSON.parse(row.days_of_week) : null,
    timeOfDay: row.time_of_day,
    offsetMinutes: row.offset_minutes,
    latitude: row.latitude,
    longitude: row.longitude,
    groupId: row.group_id,
    actionType: row.action_type,
    actionPayload: JSON.parse(row.action_payload),
    enabled: !!row.enabled
  };
}

export function createScheduleRepository(db: Database.Database) {
  return {
    list(): Schedule[] {
      return db.prepare('SELECT * FROM schedules ORDER BY name').all().map(fromRow);
    },
    add(input: Omit<Schedule, 'id'>): Schedule {
      const id = randomUUID();
      db.prepare(
        `INSERT INTO schedules
          (id, name, trigger_type, cron_expr, days_of_week, time_of_day, offset_minutes, latitude, longitude, group_id, action_type, action_payload, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id, input.name, input.triggerType, input.cronExpr,
        input.daysOfWeek ? JSON.stringify(input.daysOfWeek) : null, input.timeOfDay,
        input.offsetMinutes, input.latitude, input.longitude, input.groupId, input.actionType,
        JSON.stringify(input.actionPayload), input.enabled ? 1 : 0
      );
      return { id, ...input };
    },
    update(id: string, patch: Partial<Omit<Schedule, 'id'>>): Schedule {
      const current = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id);
      if (!current) throw new Error(`schedule ${id} not found`);
      const existing = fromRow(current);
      const next = { ...existing, ...patch };
      db.prepare(
        `UPDATE schedules SET name = ?, trigger_type = ?, cron_expr = ?, days_of_week = ?, time_of_day = ?, offset_minutes = ?,
          latitude = ?, longitude = ?, group_id = ?, action_type = ?, action_payload = ?, enabled = ?
         WHERE id = ?`
      ).run(
        next.name, next.triggerType, next.cronExpr,
        next.daysOfWeek ? JSON.stringify(next.daysOfWeek) : null, next.timeOfDay,
        next.offsetMinutes, next.latitude, next.longitude, next.groupId, next.actionType,
        JSON.stringify(next.actionPayload), next.enabled ? 1 : 0, id
      );
      return next;
    },
    remove(id: string): void {
      db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
    }
  };
}
