import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createGroupRepository } from '../../src/groups/repository.js';
import { createScheduleRepository } from '../../src/schedules/repository.js';
import { createSettingsRepository } from '../../src/settings/repository.js';
import { parseTimerEntry, importSchedules } from '../../src/controllers/scheduleImport.js';

const HOST = '10.0.0.50';

const presetName = (macro: number) => (macro === 1 ? 'Porch warm' : `Preset ${macro}`);

// Full-year date range, as WLED sets by default when a timer has no explicit
// date restriction (trimmed verbatim from a real /json/cfg capture).
const YEAR_ROUND = { start: { mon: 1, day: 1 }, end: { mon: 12, day: 31 } };

afterEach(() => vi.unstubAllGlobals());

describe('parseTimerEntry', () => {
  it('parses an enabled weekly (real clock hour) timer entry', () => {
    const result = parseTimerEntry(
      { index: 0, raw: { en: 1, hour: 18, min: 30, macro: 1, dow: 0b0111110, ...YEAR_ROUND } },
      presetName
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed).toEqual({
        macro: 1,
        triggerType: 'weekly',
        daysOfWeek: [1, 2, 3, 4, 5],
        timeOfDay: '18:30',
        offsetMinutes: 0,
        nameNote: ''
      });
    }
  });

  it('parses an enabled sunrise (hour=255) timer with a minute offset', () => {
    const result = parseTimerEntry(
      { index: 1, raw: { en: 1, hour: 255, min: 15, macro: 1, dow: 127, ...YEAR_ROUND } },
      presetName
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.triggerType).toBe('sunrise');
      expect(result.parsed.offsetMinutes).toBe(15);
      expect(result.parsed.timeOfDay).toBeNull();
      expect(result.parsed.daysOfWeek).toBeNull();
      expect(result.parsed.nameNote).toBe('');
    }
  });

  it('parses an enabled sunset (hour=254) timer', () => {
    const result = parseTimerEntry(
      { index: 2, raw: { en: 1, hour: 254, min: 0, macro: 1, dow: 127, ...YEAR_ROUND } },
      presetName
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.triggerType).toBe('sunset');
      expect(result.parsed.offsetMinutes).toBe(0);
    }
  });

  it('reports a disabled (en=0) timer entry as skipped, not thrown', () => {
    const result = parseTimerEntry(
      { index: 3, raw: { en: 0, hour: 255, min: 0, macro: 0, dow: 127, ...YEAR_ROUND } },
      presetName
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/disabled/i);
  });

  it('reports an entry with an unrecognizable shape as skipped, not thrown', () => {
    const result = parseTimerEntry({ index: 4, raw: { someUnexpectedField: 'nonsense' } }, presetName);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBeTruthy();
  });

  it('reports an entry with dow=0 (no days set) as skipped', () => {
    const result = parseTimerEntry(
      { index: 5, raw: { en: 1, hour: 12, min: 0, macro: 1, dow: 0, ...YEAR_ROUND } },
      presetName
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/day/i);
  });

  it('appends a date-limited note when start/end is not the full year', () => {
    const result = parseTimerEntry(
      {
        index: 6,
        raw: { en: 1, hour: 18, min: 0, macro: 1, dow: 127, start: { mon: 3, day: 15 }, end: { mon: 9, day: 20 } }
      },
      presetName
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.nameNote).toBe(' (date-limited on device: 3/15–9/20 — imported as year-round)');
    }
  });

  it('appends a "restricted to specific days" note for a sunrise timer with dow != 127', () => {
    const result = parseTimerEntry(
      { index: 7, raw: { en: 1, hour: 255, min: 0, macro: 1, dow: 0b0111110, ...YEAR_ROUND } },
      presetName
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.nameNote).toBe(' (device restricted this to specific days — imported as every day)');
    }
  });

  it('does not append a days-restricted note for a weekly timer with dow != 127 (already represented)', () => {
    const result = parseTimerEntry(
      { index: 8, raw: { en: 1, hour: 18, min: 0, macro: 1, dow: 0b0111110, ...YEAR_ROUND } },
      presetName
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.parsed.nameNote).toBe('');
  });

  it('rejects an hour outside 0-23 that is not the 255/254 sentinel', () => {
    const result = parseTimerEntry(
      { index: 9, raw: { en: 1, hour: 253, min: 0, macro: 1, dow: 127, ...YEAR_ROUND } },
      presetName
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/hour/i);
  });
});

describe('importSchedules', () => {
  let db: ReturnType<typeof createDb>;
  let controllerId: string;

  beforeEach(() => {
    db = createDb(':memory:');
    controllerId = createControllerRepository(db).add({ name: 'Porch', host: HOST, source: 'manual' }).id;
  });

  function stubDeviceFetch(
    cfg: Record<string, unknown>,
    presets: Record<string, unknown> = { '1': { n: 'Porch warm' } },
    liveName = 'Porch'
  ) {
    const postedPatches: unknown[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/json/cfg') && (!init || init.method === undefined)) {
        return { ok: true, json: async () => cfg } as Response;
      }
      if (url.endsWith('/presets.json')) {
        return { ok: true, json: async () => presets } as Response;
      }
      if (url.endsWith('/json/info')) {
        return { ok: true, json: async () => ({ name: liveName, ver: '16.0.0', leds: { count: 30 }, arch: 'esp32' }) } as Response;
      }
      if (url.endsWith('/json/cfg') && init?.method === 'POST') {
        const body = JSON.parse(init.body as string);
        postedPatches.push(body);
        return { ok: true, json: async () => ({ success: true }) } as Response;
      }
      throw new Error(`unexpected fetch: ${url} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    return { fetchMock, postedPatches };
  }

  it('throws a 404 error when the controller id does not exist', async () => {
    await expect(importSchedules(db, 'does-not-exist', { disableOnDevice: false })).rejects.toMatchObject({
      statusCode: 404
    });
  });

  it('throws a 503 error when the device is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response)
    );
    await expect(importSchedules(db, controllerId, { disableOnDevice: false })).rejects.toMatchObject({
      statusCode: 503
    });
  });

  it('imports timers from cfg.json timers.ins[] into schedules under an auto-created group, skipping disabled/malformed entries and the countdown timer', async () => {
    // Trimmed/adapted from a real captured /json/cfg.
    const cfg = {
      timers: {
        cntdwn: { goal: [20, 1, 1, 0, 0, 0], macro: 0 },
        ins: [
          { en: 1, hour: 18, min: 30, macro: 1, dow: 0b0111110, ...YEAR_ROUND }, // Mon-Fri weekly
          { en: 0, hour: 254, min: 0, macro: 1, dow: 127, ...YEAR_ROUND }, // disabled
          { someUnexpectedField: 'nonsense' } // malformed
        ]
      }
    };
    stubDeviceFetch(cfg);

    const result = await importSchedules(db, controllerId, { disableOnDevice: false });

    expect(result.imported).toHaveLength(1);
    expect(result.imported[0].triggerType).toBe('weekly');
    expect(result.imported[0].daysOfWeek).toEqual([1, 2, 3, 4, 5]);
    expect(result.imported[0].timeOfDay).toBe('18:30');
    expect(result.imported[0].name).toBe('Porch warm');
    expect(result.imported[0].actionPayload).toEqual({ presetId: 1 });

    expect(result.skipped).toHaveLength(3); // cntdwn + disabled + malformed
    expect(result.skipped.some((s) => /countdown/i.test(s.reason))).toBe(true);
    expect(result.skipped.some((s) => /disabled/i.test(s.reason))).toBe(true);
    expect(result.skipped.some((s) => /unrecognized/i.test(s.reason))).toBe(true);

    const groups = createGroupRepository(db).list();
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('Porch schedule');
    expect(groups[0].members).toEqual([{ controllerId, wledSegId: 0 }]);

    const schedules = createScheduleRepository(db).list();
    expect(schedules).toHaveLength(1);
    expect(schedules[0].groupId).toBe(groups[0].id);
    expect(schedules[0].actionType).toBe('preset');
  });

  it('names the auto-created group from the live device-reported name, not the stored mDNS-derived controller name', async () => {
    // Regression: the group name used to be built from controller.name,
    // which is frozen at add/discovery time (often the raw mDNS hostname,
    // e.g. "fp-shelves-left") and can be stale — the device's actual
    // "Server Description" (what the rest of the app shows everywhere else)
    // could be something completely different, e.g. "Fireplace Shelves Left".
    stubDeviceFetch(
      { timers: { ins: [{ en: 1, hour: 18, min: 30, macro: 1, dow: 127, ...YEAR_ROUND }] } },
      { '1': { n: 'Porch warm' } },
      'Fireplace Shelves Left'
    );
    await importSchedules(db, controllerId, { disableOnDevice: false });
    const groups = createGroupRepository(db).list();
    expect(groups[0].name).toBe('Fireplace Shelves Left schedule');
  });

  it('imports a sunrise timer using the configured home latitude/longitude', async () => {
    createSettingsRepository(db).update({ homeLatitude: 47.6, homeLongitude: -122.3 });
    const cfg = {
      timers: {
        ins: [{ en: 1, hour: 255, min: 20, macro: 1, dow: 127, ...YEAR_ROUND }]
      }
    };
    stubDeviceFetch(cfg);

    const result = await importSchedules(db, controllerId, { disableOnDevice: false });

    expect(result.imported).toHaveLength(1);
    expect(result.imported[0].triggerType).toBe('sunrise');
    expect(result.imported[0].offsetMinutes).toBe(20);
    expect(result.imported[0].latitude).toBe(47.6);
    expect(result.imported[0].longitude).toBe(-122.3);
  });

  it('falls back to preset id in the name when the preset is not found', async () => {
    const cfg = { timers: { ins: [{ en: 1, hour: 18, min: 0, macro: 9, dow: 127, ...YEAR_ROUND }] } };
    stubDeviceFetch(cfg, {});

    const result = await importSchedules(db, controllerId, { disableOnDevice: false });
    expect(result.imported[0].name).toBe('Preset 9');
  });

  it('reuses the same auto-created group on a second import for the same controller', async () => {
    const cfg = { timers: { ins: [{ en: 1, hour: 18, min: 30, macro: 1, dow: 0b0111110, ...YEAR_ROUND }] } };
    stubDeviceFetch(cfg);

    await importSchedules(db, controllerId, { disableOnDevice: false });
    await importSchedules(db, controllerId, { disableOnDevice: false });

    expect(createGroupRepository(db).list()).toHaveLength(1);
  });

  it('clears only the imported timer indexes on the device by index, not by preset id, when disableOnDevice is true', async () => {
    const cfg = {
      timers: {
        ins: [
          { en: 1, hour: 18, min: 30, macro: 1, dow: 0b0111110, ...YEAR_ROUND }, // index 0: imported
          { en: 0, hour: 254, min: 0, macro: 1, dow: 127, ...YEAR_ROUND } // index 1: skipped (disabled)
        ]
      }
    };
    const { postedPatches } = stubDeviceFetch(cfg);

    await importSchedules(db, controllerId, { disableOnDevice: true });

    // Only one PATCH, for timer index 0 (the imported one) — index 1 (skipped,
    // never imported) must be left untouched, and the untouched ins[1] entry
    // must be preserved verbatim in the same PATCH's array.
    expect(postedPatches).toEqual([
      {
        timers: {
          ins: [
            { en: 0, hour: 18, min: 30, macro: 1, dow: 0b0111110, ...YEAR_ROUND },
            { en: 0, hour: 254, min: 0, macro: 1, dow: 127, ...YEAR_ROUND }
          ]
        }
      }
    ]);
  });
});
