import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { TriggerTime } from '../calendar/repository.js';

export interface ScheduleControllerTarget {
  controllerId: string;
  /** null = whole-controller target (every segment). */
  wledSegId: number | null;
}

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
  /** Exactly one of groupId / controllers (non-empty) should be set — a
   *  schedule targets either a Room group or a list of specific controllers
   *  directly, with no group required. Mirrors the Target union
   *  control/applyV2.ts already uses for /api/control/apply; engine.ts
   *  converts whichever is set into that same Target[] shape. */
  groupId: string | null;
  controllers: ScheduleControllerTarget[] | null;
  actionType: 'power' | 'brightness' | 'preset' | 'theme';
  actionPayload: unknown;
  /** Optional paired power-off: fires on the same active days at this trigger
   *  time (fixed clock or sunrise/sunset ± offset). null = no auto-off. */
  offTrigger: TriggerTime | null;
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
    controllers: row.target_controllers ? JSON.parse(row.target_controllers) : null,
    actionType: row.action_type,
    actionPayload: JSON.parse(row.action_payload),
    offTrigger: row.off_trigger ? JSON.parse(row.off_trigger) : null,
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
          (id, name, trigger_type, cron_expr, days_of_week, time_of_day, offset_minutes, latitude, longitude,
           group_id, target_controllers, action_type, action_payload, off_trigger, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id, input.name, input.triggerType, input.cronExpr,
        input.daysOfWeek ? JSON.stringify(input.daysOfWeek) : null, input.timeOfDay,
        input.offsetMinutes, input.latitude, input.longitude,
        input.groupId, input.controllers ? JSON.stringify(input.controllers) : null, input.actionType,
        JSON.stringify(input.actionPayload), input.offTrigger ? JSON.stringify(input.offTrigger) : null,
        input.enabled ? 1 : 0
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
          latitude = ?, longitude = ?, group_id = ?, target_controllers = ?,
          action_type = ?, action_payload = ?, off_trigger = ?, enabled = ?
         WHERE id = ?`
      ).run(
        next.name, next.triggerType, next.cronExpr,
        next.daysOfWeek ? JSON.stringify(next.daysOfWeek) : null, next.timeOfDay,
        next.offsetMinutes, next.latitude, next.longitude,
        next.groupId, next.controllers ? JSON.stringify(next.controllers) : null, next.actionType,
        JSON.stringify(next.actionPayload), next.offTrigger ? JSON.stringify(next.offTrigger) : null,
        next.enabled ? 1 : 0, id
      );
      return next;
    },
    remove(id: string): void {
      db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
    }
  };
}
