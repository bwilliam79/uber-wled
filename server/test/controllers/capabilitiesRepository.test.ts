import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createCapabilitiesRepository } from '../../src/controllers/capabilitiesRepository.js';
import { parseFxData, type ControllerCapabilities } from '../../src/wled/capabilities.js';

function sampleCaps(): ControllerCapabilities {
  return {
    vid: 2605030,
    effects: ['Solid', 'Blink'],
    palettes: ['Default', '* Random Cycle'],
    fxMeta: parseFxData(['', '!,Duty cycle;!,!;!;01'], ['Solid', 'Blink']),
    palettePreviews: {
      0: { type: 'stops', stops: [[0, 155, 0, 213], [240, 0, 50, 252]] },
      1: { type: 'random' }
    },
    fetchedAt: '2026-07-04T22:00:00.000Z'
  };
}

describe('capabilities repository', () => {
  let db: ReturnType<typeof createDb>;
  let repo: ReturnType<typeof createCapabilitiesRepository>;
  let controllerId: string;

  beforeEach(() => {
    db = createDb(':memory:');
    repo = createCapabilitiesRepository(db);
    controllerId = createControllerRepository(db)
      .add({ name: 'Cabinet Lights', host: '10.0.0.50', source: 'manual' }).id;
  });

  it('get returns undefined before any upsert', () => {
    expect(repo.get(controllerId)).toBeUndefined();
  });

  it('round-trips a full ControllerCapabilities object through JSON columns', () => {
    const caps = sampleCaps();
    repo.upsert(controllerId, caps);
    expect(repo.get(controllerId)).toEqual(caps);
  });

  it('upsert overwrites the existing row on conflict (new vid wins)', () => {
    repo.upsert(controllerId, sampleCaps());
    const updated: ControllerCapabilities = {
      ...sampleCaps(),
      vid: 2605031,
      effects: ['Solid', 'Blink', 'Breathe'],
      fetchedAt: '2026-07-05T01:00:00.000Z'
    };
    repo.upsert(controllerId, updated);
    const row = repo.get(controllerId);
    expect(row?.vid).toBe(2605031);
    expect(row?.effects).toEqual(['Solid', 'Blink', 'Breathe']);
    expect(row?.fetchedAt).toBe('2026-07-05T01:00:00.000Z');
  });
});
