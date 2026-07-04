import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';

describe('controller repository', () => {
  let db: ReturnType<typeof createDb>;
  let repo: ReturnType<typeof createControllerRepository>;

  beforeEach(() => {
    db = createDb(':memory:');
    repo = createControllerRepository(db);
  });

  it('adds and lists a manual controller', () => {
    const created = repo.add({ name: 'Porch', host: '10.0.0.50', source: 'manual' });
    expect(created.id).toBeTruthy();
    expect(repo.list()).toEqual([created]);
  });

  it('finds a controller by host', () => {
    const created = repo.add({ name: 'Porch', host: '10.0.0.50', source: 'manual' });
    expect(repo.findByHost('10.0.0.50')).toEqual(created);
    expect(repo.findByHost('missing')).toBeUndefined();
  });

  it('marks a controller stale', () => {
    const created = repo.add({ name: 'Porch', host: '10.0.0.50', source: 'discovered' });
    repo.markStale(created.id, true);
    expect(repo.list()[0].stale).toBe(true);
  });

  it('removes a controller', () => {
    const created = repo.add({ name: 'Porch', host: '10.0.0.50', source: 'manual' });
    repo.remove(created.id);
    expect(repo.list()).toEqual([]);
  });

  it('stores and reads a pinned asset pattern, defaulting to null', () => {
    const created = repo.add({ name: 'Porch', host: '10.0.0.50', source: 'manual' });
    expect(created.pinnedAssetPattern).toBeNull();

    repo.setPinnedAssetPattern(created.id, 'ESP02');
    expect(repo.list()[0].pinnedAssetPattern).toBe('ESP02');
  });
});
