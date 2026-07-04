import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { runDiscoveryCycle } from '../../src/discovery/service.js';

describe('runDiscoveryCycle', () => {
  let db: ReturnType<typeof createDb>;
  let repo: ReturnType<typeof createControllerRepository>;

  beforeEach(() => {
    db = createDb(':memory:');
    repo = createControllerRepository(db);
  });

  it('adds newly discovered controllers', async () => {
    await runDiscoveryCycle(db, async () => [{ host: '10.0.0.50', name: 'Porch' }]);
    const list = repo.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ host: '10.0.0.50', name: 'Porch', source: 'discovered', stale: false });
  });

  it('marks a previously discovered controller stale when it disappears', async () => {
    await runDiscoveryCycle(db, async () => [{ host: '10.0.0.50', name: 'Porch' }]);
    await runDiscoveryCycle(db, async () => []);
    expect(repo.list()[0].stale).toBe(true);
  });

  it('un-stales a controller that reappears', async () => {
    await runDiscoveryCycle(db, async () => [{ host: '10.0.0.50', name: 'Porch' }]);
    await runDiscoveryCycle(db, async () => []);
    await runDiscoveryCycle(db, async () => [{ host: '10.0.0.50', name: 'Porch' }]);
    expect(repo.list()[0].stale).toBe(false);
  });

  it('never removes or stales a manually-added controller', async () => {
    repo.add({ name: 'Deck', host: '10.0.0.60', source: 'manual' });
    await runDiscoveryCycle(db, async () => []);
    const list = repo.list();
    expect(list).toHaveLength(1);
    expect(list[0].stale).toBe(false);
  });
});
