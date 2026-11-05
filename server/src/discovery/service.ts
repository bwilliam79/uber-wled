import type Database from 'better-sqlite3';
import { createControllerRepository } from '../controllers/repository.js';
import {
  readHostInterfaces,
  scanCandidateCidrs,
  selectDiscoveryCidrs
} from './candidates.js';
import { scanOnce } from './mdns.js';

export interface DiscoveryCycleOptions {
  /**
   * IPv4 CIDRs (/24–/32) or bare addresses to probe with GET /json/info.
   * Omit to use DISCOVERY_CIDR, or the host's inferred /24s, on a real
   * mDNS scan. An injected scan with this omitted does not touch the network.
   */
  cidrs?: string[];
  probeTimeoutMs?: number;
  concurrency?: number;
}

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
  scan: () => Promise<{ host: string; name: string }[]> = scanOnce,
  options?: DiscoveryCycleOptions
): Promise<void> {
  const repo = createControllerRepository(db);
  const found = await scan();
  const foundHosts = new Set(found.map((f) => f.host));

  // mDNS multicast often never reaches a Colima VM. Probe a unicast CIDR for
  // controllers this process has not seen yet, and keep mDNS results.
  const cidrs = selectDiscoveryCidrs({
    scanIsDefault: scan === scanOnce,
    configured: options?.cidrs,
    envValue: process.env.DISCOVERY_CIDR,
    interfaces: readHostInterfaces()
  });
  if (cidrs.length > 0) {
    const candidates = await scanCandidateCidrs(cidrs, {
      timeoutMs: options?.probeTimeoutMs,
      concurrency: options?.concurrency
    });
    for (const candidate of candidates) {
      if (foundHosts.has(candidate.host)) continue;
      foundHosts.add(candidate.host);
      found.push(candidate);
    }
  }

  // Also treat known discovered controllers as present when HTTP /json/info
  // answers, including hosts outside the candidate CIDR.
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
