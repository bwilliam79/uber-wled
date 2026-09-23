import type Database from 'better-sqlite3';
import { createControllerRepository } from '../controllers/repository.js';
import { scanOnce } from './mdns.js';

async function probeHttpReachable(host: string, timeoutMs = 2000): Promise<boolean> {
  try {
    const res = await fetch(`http://${host}/json/info`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function runDiscoveryCycle(
  db: Database.Database,
  scan: () => Promise<{ host: string; name: string }[]> = scanOnce
): Promise<void> {
  const repo = createControllerRepository(db);
  const found = await scan();
  const foundHosts = new Set(found.map((f) => f.host));

  // Colima/Docker bridge often drops mDNS multicast. Also treat known
  // discovered controllers as present when HTTP /json/info answers.
  for (const controller of repo.list()) {
    if (controller.source !== 'discovered') continue;
    if (foundHosts.has(controller.host)) continue;
    if (await probeHttpReachable(controller.host)) {
      foundHosts.add(controller.host);
      found.push({ host: controller.host, name: controller.name });
    }
  }

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
