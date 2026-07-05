import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createCapabilitiesRepository } from '../../src/controllers/capabilitiesRepository.js';
import {
  refreshCapabilities,
  maybeRefreshCapabilities,
  type CapabilityFetchers
} from '../../src/controllers/capabilityService.js';
import { parseFxData, type PalettePreview } from '../../src/wled/capabilities.js';

const INFO = {
  name: 'Cabinet Lights', ver: '16.0.0', vid: 2605030,
  leds: { count: 48, rgbw: true }, arch: 'esp32'
};
const EFFECTS = ['Solid', 'Blink'];
const PALETTES = ['Default', '* Random Cycle'];
const FXDATA = ['', '!,Duty cycle;!,!;!;01'];
const PREVIEWS: Record<number, PalettePreview> = {
  0: { type: 'stops', stops: [[0, 155, 0, 213], [240, 0, 50, 252]] },
  1: { type: 'random' }
};

function fakeFetchers(overrides: Partial<CapabilityFetchers> = {}): CapabilityFetchers {
  return {
    getInfo: vi.fn(async () => INFO),
    getEffects: vi.fn(async () => EFFECTS),
    getPalettes: vi.fn(async () => PALETTES),
    getFxData: vi.fn(async () => FXDATA),
    getPalettePreviews: vi.fn(async () => PREVIEWS),
    ...overrides
  } as CapabilityFetchers;
}

describe('capability service', () => {
  let db: ReturnType<typeof createDb>;
  let capsRepo: ReturnType<typeof createCapabilitiesRepository>;
  let controller: { id: string; host: string };

  beforeEach(() => {
    db = createDb(':memory:');
    capsRepo = createCapabilitiesRepository(db);
    const added = createControllerRepository(db)
      .add({ name: 'Cabinet Lights', host: '10.0.0.50', source: 'manual' });
    controller = { id: added.id, host: added.host };
  });

  it('refreshCapabilities fetches all five datasets, parses, persists and returns', async () => {
    const caps = await refreshCapabilities(db, controller, fakeFetchers());

    expect(caps.vid).toBe(2605030);
    expect(caps.effects).toEqual(EFFECTS);
    expect(caps.palettes).toEqual(PALETTES);
    expect(caps.fxMeta).toEqual(parseFxData(FXDATA, EFFECTS));
    expect(caps.palettePreviews).toEqual(PREVIEWS);
    expect(caps.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(capsRepo.get(controller.id)).toEqual(caps);
  });

  it('refreshCapabilities throws and caches nothing when info has no vid', async () => {
    const fetchers = fakeFetchers({
      getInfo: vi.fn(async () => ({ name: 'Old', ver: '0.9.0', leds: { count: 30 }, arch: 'esp8266' })) as any
    });
    await expect(refreshCapabilities(db, controller, fetchers)).rejects.toThrow(/no vid/);
    expect(capsRepo.get(controller.id)).toBeUndefined();
  });

  it('maybeRefreshCapabilities refreshes when no row is cached', async () => {
    await maybeRefreshCapabilities(db, controller, 2605030, fakeFetchers());
    expect(capsRepo.get(controller.id)?.vid).toBe(2605030);
  });

  it('maybeRefreshCapabilities is a no-op when the cached vid matches', async () => {
    await refreshCapabilities(db, controller, fakeFetchers());
    const before = capsRepo.get(controller.id);

    const fetchers = fakeFetchers();
    await maybeRefreshCapabilities(db, controller, 2605030, fetchers);

    expect(fetchers.getEffects).not.toHaveBeenCalled();
    expect(fetchers.getInfo).not.toHaveBeenCalled();
    expect(capsRepo.get(controller.id)).toEqual(before);
  });

  it('maybeRefreshCapabilities re-fetches when the seen vid differs from the cache', async () => {
    await refreshCapabilities(db, controller, fakeFetchers());

    const newInfo = { ...INFO, vid: 2605031 };
    const fetchers = fakeFetchers({ getInfo: vi.fn(async () => newInfo) });
    await maybeRefreshCapabilities(db, controller, 2605031, fetchers);

    expect(capsRepo.get(controller.id)?.vid).toBe(2605031);
  });

  it('maybeRefreshCapabilities swallows fetch failures (poll must never break)', async () => {
    const fetchers = fakeFetchers({
      getFxData: vi.fn(async () => { throw new Error('ECONNREFUSED'); })
    });
    await expect(
      maybeRefreshCapabilities(db, controller, 2605030, fetchers)
    ).resolves.toBeUndefined();
    expect(capsRepo.get(controller.id)).toBeUndefined();
  });
});
