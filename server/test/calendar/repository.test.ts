import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { createCalendarRepository } from '../../src/calendar/repository.js';

describe('calendar repository', () => {
  let db: ReturnType<typeof createDb>;
  let repo: ReturnType<typeof createCalendarRepository>;

  beforeEach(() => {
    db = createDb(':memory:');
    repo = createCalendarRepository(db);
  });

  it('is empty on a fresh db', () => {
    expect(repo.isEmpty()).toBe(true);
  });

  it('adds and lists a custom calendar event', () => {
    const created = repo.add({
      name: "Anniversary", category: 'custom',
      dateRule: { kind: 'fixed', month: 9, day: 12 },
      recursYearly: true, enabled: true, groupId: null, controllers: null,
      triggerTime: { type: 'fixed', time: '19:00' },
      actionType: 'power', actionPayload: { on: true }
    });
    expect(created.id).toBeTruthy();
    expect(repo.list()).toEqual([created]);
    expect(repo.isEmpty()).toBe(false);
  });

  it('round-trips an optional off trigger (on at sunset, off at a fixed time)', () => {
    const created = repo.add({
      name: 'Christmas', category: 'holiday',
      dateRule: { kind: 'fixed', month: 12, day: 25 },
      recursYearly: true, enabled: true, groupId: null, controllers: null,
      triggerTime: { type: 'sunset', offsetMinutes: -15 },
      offTrigger: { type: 'fixed', time: '23:30' },
      actionType: 'theme', actionPayload: { themeId: 'xmas' }
    });
    expect(created.offTrigger).toEqual({ type: 'fixed', time: '23:30' });
    expect(repo.list()[0].offTrigger).toEqual({ type: 'fixed', time: '23:30' });

    // Clearing it back to null persists too.
    const cleared = repo.update(created.id, { offTrigger: null });
    expect(cleared.offTrigger).toBeNull();
    expect(repo.get(created.id)!.offTrigger).toBeNull();
  });

  it('updates a calendar event', () => {
    const created = repo.add({
      name: "Anniversary", category: 'custom',
      dateRule: { kind: 'fixed', month: 9, day: 12 },
      recursYearly: true, enabled: false, groupId: null, controllers: null,
      triggerTime: { type: 'fixed', time: '19:00' },
      actionType: 'power', actionPayload: { on: true }
    });
    const updated = repo.update(created.id, { enabled: true });
    expect(updated.enabled).toBe(true);
  });

  it('removes a calendar event', () => {
    const created = repo.add({
      name: "X", category: 'custom',
      dateRule: { kind: 'fixed', month: 1, day: 1 },
      recursYearly: true, enabled: true, groupId: null, controllers: null,
      triggerTime: { type: 'fixed', time: '09:00' },
      actionType: null, actionPayload: null
    });
    repo.remove(created.id);
    expect(repo.list()).toEqual([]);
  });
});
