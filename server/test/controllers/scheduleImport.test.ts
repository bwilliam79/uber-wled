import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createGroupRepository } from '../../src/groups/repository.js';
import { createScheduleRepository } from '../../src/schedules/repository.js';
import { parsePresetSchedule, importSchedules } from '../../src/controllers/scheduleImport.js';

const HOST = '10.0.0.50';

afterEach(() => vi.unstubAllGlobals());

describe('parsePresetSchedule', () => {
  it('parses a valid enabled schedule entry', () => {
    const result = parsePresetSchedule({
      presetId: 1, presetName: 'Porch warm',
      raw: { en: true, hour: 18, min: 30, dow: 0b0111110 } // Mon-Fri
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed).toEqual({ presetId: 1, daysOfWeek: [1, 2, 3, 4, 5], timeOfDay: '18:30' });
    }
  });

  it('reports a disabled schedule entry as skipped, not thrown', () => {
    const result = parsePresetSchedule({
      presetId: 2, presetName: 'Unused', raw: { en: false, hour: 10, min: 0, dow: 0b1111111 }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/disabled/i);
  });

  it('reports an entry with an unrecognizable shape as skipped, not thrown', () => {
    const result = parsePresetSchedule({
      presetId: 3, presetName: 'Legacy weirdness', raw: { someUnexpectedField: 'nonsense' }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBeTruthy();
  });

  it('reports an entry with dow=0 (no days set) as skipped', () => {
    const result = parsePresetSchedule({
      presetId: 4, presetName: 'No days', raw: { en: true, hour: 12, min: 0, dow: 0 }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/day/i);
  });
});

describe('importSchedules', () => {
  let db: ReturnType<typeof createDb>;
  let controllerId: string;

  beforeEach(() => {
    db = createDb(':memory:');
    controllerId = createControllerRepository(db).add({ name: 'Porch', host: HOST, source: 'manual' }).id;
  });

  it('imports valid presets into weekly schedules under an auto-created group, and reports skipped entries', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/presets.json')) {
        return {
          ok: true,
          json: async () => ({
            '1': { n: 'Porch warm', en: true, hour: 18, min: 30, dow: 0b0111110 },
            '2': { n: 'Legacy weirdness', someUnexpectedField: 'nonsense' }
          })
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await importSchedules(db, controllerId, { disableOnDevice: false });

    expect(result.imported).toHaveLength(1);
    expect(result.imported[0].triggerType).toBe('weekly');
    expect(result.imported[0].daysOfWeek).toEqual([1, 2, 3, 4, 5]);
    expect(result.imported[0].timeOfDay).toBe('18:30');
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toBeTruthy();

    const groups = createGroupRepository(db).list();
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('Porch (imported)');
    expect(groups[0].members).toEqual([{ controllerId, wledSegId: 0 }]);

    const schedules = createScheduleRepository(db).list();
    expect(schedules).toHaveLength(1);
    expect(schedules[0].groupId).toBe(groups[0].id);
    expect(schedules[0].actionType).toBe('preset');
  });

  it('reuses the same auto-created group on a second import for the same controller', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ '1': { n: 'Porch warm', en: true, hour: 18, min: 30, dow: 0b0111110 } })
    } as Response));
    vi.stubGlobal('fetch', fetchMock);

    await importSchedules(db, controllerId, { disableOnDevice: false });
    await importSchedules(db, controllerId, { disableOnDevice: false });

    expect(createGroupRepository(db).list()).toHaveLength(1);
  });

  it('clears the device schedule fields for imported presets when disableOnDevice is true', async () => {
    const postedBodies: unknown[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/presets.json')) {
        return {
          ok: true,
          json: async () => ({ '1': { n: 'Porch warm', en: true, hour: 18, min: 30, dow: 0b0111110 } })
        } as Response;
      }
      if (url.endsWith('/json/state') && init?.method === 'POST') {
        postedBodies.push(JSON.parse(init.body as string));
        return { ok: true, json: async () => ({ on: true, bri: 128, ps: -1, seg: [] }) } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await importSchedules(db, controllerId, { disableOnDevice: true });

    expect(postedBodies).toEqual([{ psave: 1, en: false }]);
  });
});
