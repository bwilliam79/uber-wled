import type Database from 'better-sqlite3';
import { createControllerRepository } from '../controllers/repository.js';
import { scanOnce } from './mdns.js';

export async function runDiscoveryCycle(
  db: Database.Database,
  scan: () => Promise<{ host: string; name: string }[]> = scanOnce
): Promise<void> {
  const repo = createControllerRepository(db);
  const found = await scan();
  const foundHosts = new Set(found.map((f) => f.host));

  for (const { host, name } of found) {
    const existing = repo.findByHost(host);
    if (!existing) {
      repo.add({ name, host, source: 'discovered' });
    } else if (existing.source === 'discovered' && existing.stale) {
      repo.markStale(existing.id, false);
    }
  }

  for (const controller of repo.list()) {
    if (controller.source === 'discovered' && !foundHosts.has(controller.host) && !controller.stale) {
      repo.markStale(controller.id, true);
    }
  }
}
