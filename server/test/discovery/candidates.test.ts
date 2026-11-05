import { describe, it, expect, vi } from 'vitest';
import {
  expandCidr,
  inferSlash24s,
  isWledInfo,
  resolveDiscoveryCidrs,
  RFC1918,
  scanCandidateCidrs,
  selectDiscoveryCidrs,
  type InterfaceAddress
} from '../../src/discovery/candidates.js';

function v4(address: string, internal = false): InterfaceAddress {
  return { address, family: 'IPv4', internal };
}

/**
 * A host in an RFC 1918 block. Class B `secondOffset` is added to that block's
 * first second octet (0 is the start of the block). Class C ignores it.
 */
function privateHost(
  block: keyof typeof RFC1918,
  third: number,
  fourth: number,
  secondOffset = 0
): string {
  if (block === 'classA') {
    return `${RFC1918.classA.first}.${secondOffset}.${third}.${fourth}`;
  }
  if (block === 'classC') {
    return `${RFC1918.classC.first}.${RFC1918.classC.second}.${third}.${fourth}`;
  }
  return `${RFC1918.classB.first}.${RFC1918.classB.secondMin + secondOffset}.${third}.${fourth}`;
}

function privateSlash24(block: keyof typeof RFC1918, third: number, secondOffset = 0): string {
  const [a, b, c] = privateHost(block, third, 0, secondOffset).split('.');
  return `${a}.${b}.${c}.0/24`;
}

describe('expandCidr', () => {
  it('expands a /32, a /30, and a /24, and refuses anything wider', () => {
    expect(expandCidr('192.0.2.10/32')).toEqual(['192.0.2.10']);
    expect(expandCidr('192.0.2.10')).toEqual(['192.0.2.10']);
    expect(expandCidr('192.0.2.0/30')).toEqual(['192.0.2.1', '192.0.2.2']);
    expect(expandCidr('192.0.2.0/24')).toHaveLength(254);
    expect(expandCidr('192.0.2.0/24')[0]).toBe('192.0.2.1');
    expect(expandCidr('192.0.2.0/24')[253]).toBe('192.0.2.254');
    expect(expandCidr('192.0.2.0/16')).toEqual([]);
    expect(expandCidr('not-a-cidr')).toEqual([]);
  });
});

describe('inferSlash24s', () => {
  it('keeps the first two private /24s and skips public, loopback, link-local, and IPv6', () => {
    const classC = privateSlash24('classC', 4);
    const classA = privateSlash24('classA', 10, 10);
    const cidrs = inferSlash24s({
      eth0: [v4(privateHost('classC', 4, 15)), v4(privateHost('classC', 4, 40)), { address: '2001:db8::1', family: 'IPv6', internal: false }],
      eth1: [v4(privateHost('classA', 10, 8, 10))],
      eth2: [v4(privateHost('classB', 3, 9)), v4('172.32.0.9')],
      lo: [v4('127.0.0.1', true)],
      docs: [v4('192.0.2.15'), v4('198.51.100.8')],
      linklocal: [v4('169.254.1.10')]
    });
    expect(cidrs).toEqual([classC, classA]);
  });

  it('skips docker, bridge, veth, and colima interfaces and keeps at most two /24s', () => {
    const classC = privateSlash24('classC', 4);
    const classB = privateSlash24('classB', 4);
    const cidrs = inferSlash24s({
      docker0: [v4(privateHost('classB', 0, 1, 1))],
      'br-7f3a': [v4(privateHost('classB', 0, 1, 2))],
      bridge0: [v4(privateHost('classB', 0, 19, 2))],
      veth0abc: [v4('192.0.2.9')],
      col0: [v4('198.51.100.8')],
      colima: [v4('203.0.113.7')],
      eth0: [v4(privateHost('classC', 4, 15))],
      eth1: [v4(privateHost('classB', 4, 8))],
      eth2: [v4(privateHost('classB', 3, 19))]
    });
    expect(cidrs).toEqual([classC, classB]);
  });
});

describe('resolveDiscoveryCidrs', () => {
  const interfaces = { eth0: [v4(privateHost('classC', 4, 15))] };
  const inferred = privateSlash24('classC', 4);

  it('defaults to inferred /24s when unset, and honors an explicit list or off', () => {
    const first = privateSlash24('classB', 8);
    const second = privateSlash24('classB', 3);
    expect(resolveDiscoveryCidrs(undefined, interfaces)).toEqual([inferred]);
    expect(resolveDiscoveryCidrs(`${first}, ${second}`, interfaces)).toEqual([first, second]);
    expect(resolveDiscoveryCidrs('off', interfaces)).toEqual([]);
    expect(resolveDiscoveryCidrs('  ', interfaces)).toEqual([]);
  });

  it('rejects DISCOVERY_CIDR entries outside private LAN ranges', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(resolveDiscoveryCidrs(
        `${inferred}, 192.0.2.10/32, 203.0.113.0/24, 198.51.100.8`,
        interfaces
      )).toEqual([inferred]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('private ranges');
      expect(String(warn.mock.calls[0][0])).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
      // A public-only value does not fall through to interface inference.
      expect(resolveDiscoveryCidrs('203.0.113.0/24', interfaces)).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it('does no unicast sweep and logs a hint when every interface is virtual', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(resolveDiscoveryCidrs(undefined, {
        docker0: [v4(privateHost('classB', 0, 1, 1))],
        col0: [v4('192.0.2.8')],
        veth0abc: [v4('198.51.100.9')]
      })).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('DISCOVERY_CIDR');
      expect(String(warn.mock.calls[0][0])).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
      expect(resolveDiscoveryCidrs('off', { docker0: [v4(privateHost('classB', 0, 1, 1))] })).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('selectDiscoveryCidrs', () => {
  const interfaces = { eth0: [v4(privateHost('classC', 4, 15))] };
  const inferred = privateSlash24('classC', 4);

  it('does not infer a CIDR for an injected scan unless one was configured', () => {
    expect(selectDiscoveryCidrs({
      scanIsDefault: false,
      envValue: undefined,
      interfaces
    })).toEqual([]);
    expect(selectDiscoveryCidrs({
      scanIsDefault: false,
      configured: ['192.0.2.10/32'],
      envValue: 'off',
      interfaces
    })).toEqual(['192.0.2.10/32']);
  });

  it('uses DISCOVERY_CIDR, then inferred /24s, for a real mDNS scan', () => {
    const configured = privateSlash24('classB', 8);
    expect(selectDiscoveryCidrs({
      scanIsDefault: true,
      envValue: configured,
      interfaces
    })).toEqual([configured]);
    expect(selectDiscoveryCidrs({
      scanIsDefault: true,
      envValue: undefined,
      interfaces
    })).toEqual([inferred]);
    expect(selectDiscoveryCidrs({
      scanIsDefault: true,
      envValue: 'off',
      interfaces
    })).toEqual([]);
  });
});

describe('isWledInfo', () => {
  it('accepts a WLED brand or the name/version/leds trio, and rejects other JSON', () => {
    expect(isWledInfo({ brand: 'WLED', name: 'Porch' })).toBe(true);
    expect(isWledInfo({ name: 'Porch', ver: '0.14.4', leds: { count: 30 } })).toBe(true);
    expect(isWledInfo({ name: 'printer' })).toBe(false);
    expect(isWledInfo({})).toBe(false);
    expect(isWledInfo(null)).toBe(false);
  });
});

describe('scanCandidateCidrs', () => {
  it('adds only hosts whose /json/info answers as WLED', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'http://192.0.2.10/json/info') {
        return {
          ok: true,
          json: async () => ({ name: 'Porch', ver: '0.14.4', brand: 'WLED', leds: { count: 30 } })
        } as Response;
      }
      return { ok: true, json: async () => ({ name: 'printer' }) } as Response;
    });

    const found = await scanCandidateCidrs(['192.0.2.10/32', '192.0.2.11/32'], {
      fetchImpl: fetchImpl as typeof fetch,
      concurrency: 2,
      timeoutMs: 50
    });
    expect(found).toEqual([{ host: '192.0.2.10', name: 'Porch' }]);
  });

  it('falls back to WLED when the device name is blank and caps a long name', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'http://192.0.2.10/json/info') {
        return { ok: true, json: async () => ({ brand: 'WLED', name: '   ' }) } as Response;
      }
      return {
        ok: true,
        json: async () => ({ brand: 'WLED', name: 'P'.repeat(80) })
      } as Response;
    });
    const found = await scanCandidateCidrs(['192.0.2.10/32', '192.0.2.11/32'], {
      fetchImpl: fetchImpl as typeof fetch,
      concurrency: 1,
      timeoutMs: 50
    });
    expect(found).toEqual([
      { host: '192.0.2.10', name: 'WLED' },
      { host: '192.0.2.11', name: 'P'.repeat(64) }
    ]);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchImpl = vi.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 15));
      inFlight -= 1;
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });

    await scanCandidateCidrs(['192.0.2.0/29'], {
      fetchImpl: fetchImpl as typeof fetch,
      concurrency: 2,
      timeoutMs: 200
    });

    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it('stops waiting when a candidate does not answer within the timeout', async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        if (init?.signal?.aborted) abort();
        else init?.signal?.addEventListener('abort', abort);
      });
    });

    const started = Date.now();
    const found = await scanCandidateCidrs(['192.0.2.10/32'], {
      fetchImpl: fetchImpl as typeof fetch,
      concurrency: 1,
      timeoutMs: 50
    });
    expect(found).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
