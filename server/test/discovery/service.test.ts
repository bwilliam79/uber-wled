import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

  afterEach(() => {
    vi.unstubAllGlobals();
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

  it('mDNS returns nothing and a candidate host answers as WLED, so the controller gets added', async () => {
    // TEST-NET-1 (RFC 5737). Never a real LAN address.
    const host = '192.0.2.10';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === `http://${host}/json/info`) {
          return {
            ok: true,
            json: async () => ({
              name: 'Porch',
              ver: '0.14.4',
              brand: 'WLED',
              leds: { count: 30 }
            })
          } as Response;
        }
        return { ok: false, status: 404, json: async () => ({}) } as Response;
      })
    );

    await runDiscoveryCycle(db, async () => [], { cidrs: [`${host}/32`] });

    const list = repo.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      host,
      name: 'Porch',
      source: 'discovered',
      stale: false
    });
  });

  it('does not add a candidate whose /json/info is not a WLED response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === 'http://192.0.2.11/json/info') {
          return { ok: true, json: async () => ({ name: 'printer' }) } as Response;
        }
        return { ok: false, status: 404, json: async () => ({}) } as Response;
      })
    );

    await runDiscoveryCycle(db, async () => [], { cidrs: ['192.0.2.11/32'] });
    expect(repo.list()).toHaveLength(0);
  });

  it('keeps mDNS results and adds a separate unicast WLED candidate', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === 'http://192.0.2.10/json/info') {
          return {
            ok: true,
            json: async () => ({ name: 'Porch', ver: '0.14.4', brand: 'WLED', leds: { count: 30 } })
          } as Response;
        }
        return { ok: false, status: 404, json: async () => ({}) } as Response;
      })
    );

    await runDiscoveryCycle(db, async () => [{ host: '192.0.2.20', name: 'Hall' }], {
      cidrs: ['192.0.2.10/32']
    });

    const list = repo.list();
    expect(list).toHaveLength(2);
    expect(list.map((controller) => controller.host).sort()).toEqual(['192.0.2.10', '192.0.2.20']);
    expect(repo.findByHost('192.0.2.20')).toMatchObject({ name: 'Hall', source: 'discovered' });
    expect(repo.findByHost('192.0.2.10')).toMatchObject({ name: 'Porch', source: 'discovered' });
  });

  it('keeps the mDNS name when that host also answers the candidate scan', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ name: 'FromHttp', ver: '0.14.4', brand: 'WLED', leds: { count: 1 } })
      }) as Response)
    );

    await runDiscoveryCycle(db, async () => [{ host: '192.0.2.10', name: 'FromMdns' }], {
      cidrs: ['192.0.2.10/32']
    });

    expect(repo.list()).toHaveLength(1);
    expect(repo.list()[0]).toMatchObject({ host: '192.0.2.10', name: 'FromMdns', source: 'discovered' });
  });

  it('does not replace a manual controller when that host answers as WLED', async () => {
    repo.add({ name: 'Deck', host: '192.0.2.10', source: 'manual' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ name: 'Porch', ver: '0.14.4', brand: 'WLED', leds: { count: 30 } })
      }) as Response)
    );

    await runDiscoveryCycle(db, async () => [], { cidrs: ['192.0.2.10/32'] });

    const list = repo.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Deck', host: '192.0.2.10', source: 'manual', stale: false });
  });

  it('does not probe candidates when mDNS is injected and no CIDR is configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await runDiscoveryCycle(db, async () => []);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(repo.list()).toHaveLength(0);
  });

  it('still clears stale on a known controller outside the candidate CIDR', async () => {
    await runDiscoveryCycle(db, async () => [{ host: '192.0.2.40', name: 'Hall' }]);
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('down');
    }));
    await runDiscoveryCycle(db, async () => [], { cidrs: ['192.0.2.10/32'], probeTimeoutMs: 50 });
    expect(repo.findByHost('192.0.2.40')?.stale).toBe(true);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === 'http://192.0.2.40/json/info') {
          return { ok: true, json: async () => ({}) } as Response;
        }
        return { ok: false, status: 404, json: async () => ({}) } as Response;
      })
    );

    await runDiscoveryCycle(db, async () => [], { cidrs: ['192.0.2.10/32'] });
    expect(repo.findByHost('192.0.2.40')).toMatchObject({ name: 'Hall', stale: false });
  });
});
