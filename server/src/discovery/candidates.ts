import os from 'node:os';

/** Addresses considered at once while probing a candidate CIDR. */
export const DEFAULT_PROBE_CONCURRENCY = 32;
/** Per-host budget for GET /json/info during a candidate scan. */
export const DEFAULT_PROBE_TIMEOUT_MS = 800;

const MAX_CONCURRENCY = 64;
const MIN_TIMEOUT_MS = 50;
const MAX_TIMEOUT_MS = 5_000;
/** Wider than /24 is rejected so a typo cannot sweep a /16. */
const MIN_PREFIX = 24;
const MAX_PREFIX = 32;

/**
 * RFC 1918 blocks, as octets. Discovery treats only these as a LAN.
 * Class B's second octet runs from `secondMin` through `secondMax`.
 */
export const RFC1918 = {
  classA: { first: 10 },
  classB: { first: 172, secondMin: 16, secondMax: 31 },
  classC: { first: 192, second: 168 },
} as const;

const DISABLED_ENV = new Set(['off', 'none', 'false', '0']);

export interface InterfaceAddress {
  address: string;
  family: string | number;
  internal: boolean;
}

export interface CandidateController {
  host: string;
  name: string;
}

export interface CandidateScanOptions {
  timeoutMs?: number;
  concurrency?: number;
  fetchImpl?: typeof fetch;
}

/**
 * A WLED `/json/info` body. Current firmware sets `brand` to `WLED`. Older
 * builds still carry the name/version/leds trio this app already models.
 */
export function isWledInfo(body: unknown): body is { name?: unknown } {
  if (!body || typeof body !== 'object') return false;
  const info = body as Record<string, unknown>;
  if (info.brand === 'WLED') return true;
  return typeof info.name === 'string'
    && typeof info.ver === 'string'
    && !!info.leds
    && typeof info.leds === 'object';
}

export function expandCidr(cidr: string): string[] {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/.exec(cidr.trim());
  if (!match) return [];
  const octets = [1, 2, 3, 4].map((i) => Number(match[i]));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return [];
  const prefix = match[5] === undefined ? 32 : Number(match[5]);
  if (!Number.isInteger(prefix) || prefix < MIN_PREFIX || prefix > MAX_PREFIX) return [];

  const ip = octets.reduce((acc, octet) => ((acc << 8) | octet) >>> 0, 0);
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  const network = (ip & mask) >>> 0;
  const size = 2 ** (32 - prefix);
  const last = (network + size - 1) >>> 0;
  // /31 and /32 have no distinct network/broadcast hosts to skip.
  const start = prefix <= 30 ? (network + 1) >>> 0 : network;
  const end = prefix <= 30 ? (last - 1) >>> 0 : last;

  const hosts: string[] = [];
  for (let n = start; n <= end; n++) {
    hosts.push(`${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`);
  }
  return hosts;
}

/** Docker, bridge, veth, and Colima/Lima interfaces are not the house LAN. */
const VIRTUAL_INTERFACE = /^(docker|br-|br\d|bridge|veth|colima|col\d|lima)/i;
const MAX_INFERRED_CIDRS = 2;
const NO_CIDR_HINT =
  'discovery: no unicast sweep. Set DISCOVERY_CIDR to the LAN that holds the WLED controllers.';
const PUBLIC_CIDR_HINT =
  'discovery: ignoring DISCOVERY_CIDR entries outside private ranges (10/8, 172.16/12, 192.168/16).';

/** True for RFC1918. Discovery never probes a public address. */
function isPrivateLan(first: number, second: number): boolean {
  if (first === RFC1918.classA.first) return true;
  if (
    first === RFC1918.classB.first
    && second >= RFC1918.classB.secondMin
    && second <= RFC1918.classB.secondMax
  ) return true;
  return first === RFC1918.classC.first && second === RFC1918.classC.second;
}

function isPrivateCidr(cidr: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/.exec(cidr.trim());
  if (!match) return false;
  const octets = [1, 2, 3, 4].map((i) => Number(match[i]));
  if (octets.some((n) => !Number.isInteger(n) || n > 255)) return false;
  return isPrivateLan(octets[0], octets[1]);
}

/**
 * Up to two /24s from non-internal private IPv4 interfaces, skipping
 * docker/bridge/veth/colima-style names.
 */
export function inferSlash24s(interfaces: NodeJS.Dict<readonly InterfaceAddress[]>): string[] {
  const cidrs: string[] = [];
  const seen = new Set<string>();
  for (const [name, entries] of Object.entries(interfaces)) {
    if (VIRTUAL_INTERFACE.test(name)) continue;
    for (const entry of entries ?? []) {
      const isV4 = entry.family === 'IPv4' || entry.family === 4;
      if (!isV4 || entry.internal) continue;
      const parts = entry.address.split('.').map((part) => Number(part));
      if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) continue;
      const [a, b, c] = parts;
      if (!isPrivateLan(a, b)) continue;
      const cidr = `${a}.${b}.${c}.0/24`;
      if (seen.has(cidr)) continue;
      seen.add(cidr);
      cidrs.push(cidr);
      if (cidrs.length >= MAX_INFERRED_CIDRS) return cidrs;
    }
  }
  return cidrs;
}

export function resolveDiscoveryCidrs(
  envValue: string | undefined,
  interfaces: NodeJS.Dict<readonly InterfaceAddress[]>
): string[] {
  if (envValue !== undefined) {
    const trimmed = envValue.trim();
    if (!trimmed || DISABLED_ENV.has(trimmed.toLowerCase())) return [];
    const requested = trimmed.split(',').map((part) => part.trim()).filter(Boolean);
    const cidrs = requested.filter(isPrivateCidr);
    if (cidrs.length !== requested.length) console.warn(PUBLIC_CIDR_HINT);
    return cidrs;
  }
  const cidrs = inferSlash24s(interfaces);
  if (cidrs.length === 0) console.warn(NO_CIDR_HINT);
  return cidrs;
}

export function selectDiscoveryCidrs(input: {
  scanIsDefault: boolean;
  configured?: string[];
  envValue: string | undefined;
  interfaces: NodeJS.Dict<readonly InterfaceAddress[]>;
}): string[] {
  if (input.configured !== undefined) return input.configured;
  if (!input.scanIsDefault) return [];
  return resolveDiscoveryCidrs(input.envValue, input.interfaces);
}

export function readHostInterfaces(): NodeJS.Dict<os.NetworkInterfaceInfo[]> {
  try {
    return os.networkInterfaces();
  } catch {
    return {};
  }
}

function clampTimeout(timeoutMs: number | undefined): number {
  const value = timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  if (!Number.isFinite(value)) return DEFAULT_PROBE_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, value));
}

function clampConcurrency(concurrency: number | undefined): number {
  const value = concurrency ?? DEFAULT_PROBE_CONCURRENCY;
  if (!Number.isFinite(value)) return DEFAULT_PROBE_CONCURRENCY;
  return Math.min(MAX_CONCURRENCY, Math.max(1, Math.floor(value)));
}

function nameFromInfo(body: { name?: unknown }): string {
  if (typeof body.name !== 'string') return 'WLED';
  const trimmed = body.name.trim().slice(0, 64);
  return trimmed || 'WLED';
}

export async function probeWledHost(
  host: string,
  timeoutMs: number,
  fetchImpl: typeof fetch
): Promise<CandidateController | null> {
  try {
    const res = await fetchImpl(`http://${host}/json/info`, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual'
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (!isWledInfo(body)) return null;
    return { host, name: nameFromInfo(body) };
  } catch {
    return null;
  }
}

/** Probe every host in the CIDRs. Overlapping ranges are probed once. */
export async function scanCandidateCidrs(
  cidrs: readonly string[],
  options: CandidateScanOptions = {}
): Promise<CandidateController[]> {
  const timeoutMs = clampTimeout(options.timeoutMs);
  const concurrency = clampConcurrency(options.concurrency);
  const fetchImpl = options.fetchImpl ?? fetch;
  const hosts = [...new Set(cidrs.flatMap(expandCidr))];
  if (hosts.length === 0) return [];

  const results: Array<CandidateController | null> = new Array(hosts.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < hosts.length) {
      const index = next;
      next += 1;
      results[index] = await probeWledHost(hosts[index], timeoutMs, fetchImpl);
    }
  }

  const workers = Math.min(concurrency, hosts.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results.filter((hit): hit is CandidateController => hit !== null);
}
