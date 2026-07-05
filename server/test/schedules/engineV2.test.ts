import { describe, it, expect, afterEach, vi } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createGroupRepository } from '../../src/groups/repository.js';
import { createScheduleRepository } from '../../src/schedules/repository.js';
import { createCalendarRepository } from '../../src/calendar/repository.js';
import { createThemeRepository } from '../../src/themes/repository.js';
import { SchedulerEngine } from '../../src/schedules/engine.js';
import { applyActionV2, type ControlAction } from '../../src/control/actionMap.js';

function stubFetchByHost(
  handlers: Record<string, (url: string, init?: RequestInit) => { status: number; body?: unknown }>
) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const host = new URL(url).host;
    const handler = handlers[host];
    if (!handler) throw new Error(`no fetch handler stubbed for host ${host}`);
    const { status, body } = handler(url, init);
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const okState = { on: true, bri: 128, ps: -1, seg: [] };

describe('SchedulerEngine wired to applyActionV2 (fan-out v2)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fires a due theme schedule through v2: segment-id targeting + udpn nn', async () => {
    const db = createDb(':memory:');
    const controllerId = createControllerRepository(db)
      .add({ name: 'Porch', host: '10.0.0.60', source: 'manual' }).id;
    const groupId = createGroupRepository(db)
      .add({ name: 'Porch', members: [{ controllerId, wledSegId: 1 }] }).id;
    const theme = createThemeRepository(db)
      .add({ name: 'Sunset', effect: 2, palette: 5, colors: [[255, 100, 0]], brightness: 180 });
    createScheduleRepository(db).add({
      name: 'Evening', triggerType: 'cron', cronExpr: '0 20 * * *',
      daysOfWeek: null, timeOfDay: null, offsetMinutes: 0,
      latitude: null, longitude: null, groupId,
      actionType: 'theme', actionPayload: { themeId: theme.id }, enabled: true
    });

    let captured: any;
    stubFetchByHost({
      '10.0.0.60': (_url, init) => {
        captured = JSON.parse(init?.body as string);
        return { status: 200, body: okState };
      }
    });

    // Exactly the server.ts wiring: engine's applyFn delegates to applyActionV2.
    const engine = new SchedulerEngine(db, (members, action) =>
      applyActionV2(db, members, action as ControlAction));
    await engine.checkAndFireDueSchedules(new Date('2026-07-04T20:00:00'));

    expect(captured).toBeDefined();
    expect(captured.bri).toBe(180);
    expect(captured.udpn).toEqual({ nn: true });
    expect(captured.seg[0]).toEqual(
      expect.objectContaining({ id: 1, fx: 2, pal: 5, col: [[255, 100, 0]] })
    );
  });

  it('fires a due calendar event action through v2 with udpn nn', async () => {
    const db = createDb(':memory:');
    const controllerId = createControllerRepository(db)
      .add({ name: 'Roof', host: '10.0.0.61', source: 'manual' }).id;
    const groupId = createGroupRepository(db)
      .add({ name: 'Roofline', members: [{ controllerId, wledSegId: 0 }] }).id;
    createCalendarRepository(db).add({
      name: 'July 4th', category: 'holiday',
      dateRule: { kind: 'fixed', month: 7, day: 4 },
      recursYearly: true, enabled: true, groupId,
      triggerTime: { type: 'fixed', time: '18:00' },
      actionType: 'power', actionPayload: { on: true }
    });

    let captured: any;
    stubFetchByHost({
      '10.0.0.61': (_url, init) => {
        captured = JSON.parse(init?.body as string);
        return { status: 200, body: okState };
      }
    });

    const engine = new SchedulerEngine(db, (members, action) =>
      applyActionV2(db, members, action as ControlAction));
    await engine.checkAndFireDueSchedules(new Date('2026-07-04T18:00:00'));

    expect(captured).toEqual(expect.objectContaining({ on: true, udpn: { nn: true } }));
  });
});
