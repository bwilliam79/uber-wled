import { describe, it, expect } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createGroupRepository } from '../../src/groups/repository.js';
import { createThemeRepository } from '../../src/themes/repository.js';
import { createScheduleRepository } from '../../src/schedules/repository.js';
import { createCalendarRepository } from '../../src/calendar/repository.js';
import { createSyncGroupRepository } from '../../src/sync/repository.js';
import { createStripRepository } from '../../src/strips/repository.js';
import { createSettingsRepository } from '../../src/settings/repository.js';
import {
  buildBackup, restoreBackup, buildThemesExport, importThemes,
  buildSchedulesExport, importSchedules, BackupFormatError, BACKUP_KIND
} from '../../src/backup/service.js';

/** Seed a DB with cross-referencing rows and return the key ids. */
function seed(db: ReturnType<typeof createDb>) {
  const controller = createControllerRepository(db).add({ name: 'Cabinet', host: '10.0.0.5', source: 'manual' });
  const group = createGroupRepository(db).add({
    name: 'Living Room',
    members: [{ controllerId: controller.id, wledSegId: 0 }]
  });
  const theme = createThemeRepository(db).add({
    name: 'Christmas Classic', effect: 84, palette: 0, colors: [[220, 0, 0], [0, 160, 40], [255, 255, 255]], brightness: 185
  });
  const schedule = createScheduleRepository(db).add({
    name: 'Evening', triggerType: 'sunset', cronExpr: null, daysOfWeek: null, timeOfDay: null,
    offsetMinutes: 0, latitude: 36.1, longitude: -94.1, groupId: group.id, controllers: null,
    actionType: 'theme', actionPayload: { themeId: theme.id }, enabled: true
  });
  createCalendarRepository(db).add({
    name: 'Christmas Day', category: 'custom', dateRule: { kind: 'fixed', month: 12, day: 25 },
    recursYearly: true, enabled: true, groupId: group.id, controllers: null,
    triggerTime: { type: 'fixed', time: '18:00' }, actionType: 'theme', actionPayload: { themeId: theme.id }
  });
  const sync = createSyncGroupRepository(db, () => undefined).add({ name: 'Downstairs', memberControllerIds: [controller.id] });
  createStripRepository(db).add({ controllerId: controller.id, wledSegId: 0, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], label: 'Shelf' });
  createSettingsRepository(db).update({ homeLatitude: 36.1, homeLongitude: -94.1, livePollIntervalSeconds: 5 });
  return { controllerId: controller.id, groupId: group.id, themeId: theme.id, scheduleId: schedule.id, syncId: sync.id };
}

describe('backup service', () => {
  it('round-trips a full config into a fresh DB, preserving ids and cross-references', () => {
    const src = createDb(':memory:');
    const ids = seed(src);
    const backup = buildBackup(src, '2026-07-09T00:00:00.000Z');

    const dst = createDb(':memory:');
    // Prove the wipe: put a stray row in the destination that must NOT survive.
    createThemeRepository(dst).add({ name: 'STRAY', effect: 0, palette: 0, colors: [[1, 1, 1]], brightness: 1 });

    const result = restoreBackup(dst, backup);

    // The stray theme is gone; the backed-up theme is present with its original id.
    const themes = createThemeRepository(dst).list();
    expect(themes.map((t) => t.name)).toEqual(['Christmas Classic']);
    expect(themes[0].id).toBe(ids.themeId);

    // Controller preserved with its id.
    expect(createControllerRepository(dst).list().map((c) => c.id)).toEqual([ids.controllerId]);

    // Group + its membership preserved, still pointing at the same controller.
    const group = createGroupRepository(dst).list()[0];
    expect(group.id).toBe(ids.groupId);
    expect(group.members).toEqual([{ controllerId: ids.controllerId, wledSegId: 0 }]);

    // Schedule preserved with its id and its group reference intact.
    const schedule = createScheduleRepository(dst).list()[0];
    expect(schedule.id).toBe(ids.scheduleId);
    expect(schedule.groupId).toBe(ids.groupId);

    // Sync group + member preserved.
    const sync = createSyncGroupRepository(dst, () => undefined).list()[0];
    expect(sync.id).toBe(ids.syncId);
    expect(sync.memberControllerIds).toEqual([ids.controllerId]);

    // Settings restored.
    expect(createSettingsRepository(dst).get().livePollIntervalSeconds).toBe(5);

    expect(result.restored.controllers).toBe(1);
    expect(result.restored.schedules).toBe(1);
  });

  it('excludes runtime/cache tables from the backup', () => {
    const db = createDb(':memory:');
    const backup = buildBackup(db, 'x');
    expect(Object.keys(backup.tables)).not.toContain('wled_releases');
    expect(Object.keys(backup.tables)).not.toContain('app_update_cache');
    expect(Object.keys(backup.tables)).not.toContain('controller_status');
    expect(Object.keys(backup.tables)).not.toContain('controller_capabilities');
    expect(Object.keys(backup.tables)).toContain('controllers');
    expect(Object.keys(backup.tables)).toContain('themes');
  });

  it('rejects a file that is not an uber-wled backup', () => {
    const db = createDb(':memory:');
    expect(() => restoreBackup(db, { kind: 'something-else', tables: {} })).toThrow(BackupFormatError);
    expect(() => restoreBackup(db, null)).toThrow(BackupFormatError);
    expect(() => restoreBackup(db, { kind: BACKUP_KIND })).toThrow(BackupFormatError);
  });

  it('exports and re-imports themes under fresh ids (append, no collision)', () => {
    const src = createDb(':memory:');
    createThemeRepository(src).add({ name: 'Halloween', effect: 66, palette: 35, colors: [[255, 90, 0]], brightness: 185 });
    const exported = buildThemesExport(src, 'x');

    const dst = createDb(':memory:');
    createThemeRepository(dst).add({ name: 'Existing', effect: 0, palette: 0, colors: [[1, 1, 1]], brightness: 100 });
    const result = importThemes(dst, exported);

    expect(result.imported).toBe(1);
    const names = createThemeRepository(dst).list().map((t) => t.name).sort();
    // Appended, not replaced — the pre-existing theme survives.
    expect(names).toEqual(['Existing', 'Halloween']);
    // Fresh id, not the source theme's id.
    const imported = createThemeRepository(dst).list().find((t) => t.name === 'Halloween')!;
    expect(imported.id).not.toBe(createThemeRepository(src).list()[0].id);
  });

  it('rejects a themes import file with the wrong kind', () => {
    const db = createDb(':memory:');
    expect(() => importThemes(db, { kind: 'uber-wled-backup', themes: [] })).toThrow(BackupFormatError);
  });

  it('re-imports schedules + calendar events into the same instance (references resolve, rows appended)', () => {
    const src = createDb(':memory:');
    seed(src);
    const exported = buildSchedulesExport(src, 'x');
    expect(exported.schedules).toHaveLength(1);
    expect(exported.calendarEvents.length).toBeGreaterThanOrEqual(1);

    const before = createScheduleRepository(src).list().length;
    const result = importSchedules(src, exported);

    // Referenced group still exists here, so the row imports (as a duplicate).
    expect(result.schedules).toBe(1);
    expect(result.skipped).toBe(0);
    expect(createScheduleRepository(src).list().length).toBe(before + 1);
  });

  it('skips (does not fail) schedule rows whose referenced group/controller is missing on this instance', () => {
    const src = createDb(':memory:');
    seed(src);
    const exported = buildSchedulesExport(src, 'x');

    // A different instance with no matching group/controller ids.
    const other = createDb(':memory:');
    const result = importSchedules(other, exported);

    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(result.schedules).toBe(0);
    // The import didn't throw and left the instance usable.
    expect(createScheduleRepository(other).list()).toEqual([]);
  });

  it('rejects a schedules import file with the wrong kind', () => {
    const db = createDb(':memory:');
    expect(() => importSchedules(db, { kind: 'nope', schedules: [], calendarEvents: [] })).toThrow(BackupFormatError);
  });
});
