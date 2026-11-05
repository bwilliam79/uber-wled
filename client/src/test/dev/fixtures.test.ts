import { describe, expect, it } from 'vitest';
import { FIXTURE_LIVE, fixtureJson } from '../../dev/fixtures';

const DOC_IP = /\b(?:192\.0\.2|198\.51\.100|203\.0\.113)\.\d{1,3}\b/g;
const OTHER_IP = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
const MAC = /\b[0-9a-f]{2}(?::[0-9a-f]{2}){5}\b/i;

function dump(): string {
  const paths = [
    '/api/controllers', '/api/themes', '/api/schedules', '/api/calendar-events',
    '/api/groups', '/api/sync-groups', '/api/settings', '/api/controllers/fx-a/firmware',
    '/api/controllers/fx-a/status'
  ];
  return JSON.stringify({
    lists: paths.map((path) => fixtureJson(path, 'GET')),
    live: FIXTURE_LIVE
  });
}

describe('dev fixtures', () => {
  it('returns populated lists and ignores writes', () => {
    const controllers = fixtureJson('/api/controllers', 'GET') as { name: string }[];
    expect(controllers.map((item) => item.name)).toEqual(['Controller A', 'Controller B']);
    expect((fixtureJson('/api/themes', 'GET') as unknown[]).length).toBeGreaterThan(0);
    expect((fixtureJson('/api/schedules', 'GET') as unknown[]).length).toBeGreaterThan(0);
    expect((fixtureJson('/api/sync-groups', 'GET') as unknown[]).length).toBeGreaterThan(0);
    expect(fixtureJson('/api/controllers', 'POST')).toBeUndefined();
  });

  it('uses only documentation addresses and no MAC addresses', () => {
    const text = dump();
    const ips = text.match(OTHER_IP) ?? [];
    expect(ips.length).toBeGreaterThan(0);
    for (const ip of ips) expect(ip).toMatch(/^(192\.0\.2|198\.51\.100|203\.0\.113)\./);
    expect(text.match(DOC_IP)?.length).toBe(ips.length);
    expect(text).not.toMatch(MAC);
    expect(text).not.toMatch(/@/);
  });
});
