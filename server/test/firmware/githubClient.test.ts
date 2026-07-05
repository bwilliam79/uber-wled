import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { fetchLatestRelease } from '../../src/firmware/githubClient.js';

const GITHUB_RESPONSE = [
  {
    tag_name: 'v0.15.1-b3', prerelease: true, published_at: '2026-06-15T00:00:00Z',
    assets: [{ name: 'WLED_0.15.1-b3_ESP32.bin', browser_download_url: 'https://example.com/beta-ESP32.bin' }]
  },
  {
    tag_name: 'v0.15.0', prerelease: false, published_at: '2026-06-01T00:00:00Z',
    assets: [
      { name: 'WLED_0.15.0_ESP8266.bin', browser_download_url: 'https://example.com/ESP8266.bin' },
      { name: 'WLED_0.15.0_ESP32.bin', browser_download_url: 'https://example.com/ESP32.bin' }
    ]
  },
  {
    tag_name: 'v0.14.0', prerelease: false, published_at: '2026-01-01T00:00:00Z', assets: []
  }
];

afterEach(() => vi.unstubAllGlobals());

describe('fetchLatestRelease', () => {
  let db: ReturnType<typeof createDb>;

  beforeEach(() => {
    db = createDb(':memory:');
  });

  it('fetches and caches the newest release when there is no cache yet', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => GITHUB_RESPONSE
    });
    vi.stubGlobal('fetch', fetchMock);

    const release = await fetchLatestRelease(db);

    expect(release.tag).toBe('v0.15.0');
    expect(release.assets).toEqual([
      { name: 'WLED_0.15.0_ESP8266.bin', downloadUrl: 'https://example.com/ESP8266.bin' },
      { name: 'WLED_0.15.0_ESP32.bin', downloadUrl: 'https://example.com/ESP32.bin' }
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns the cached release without refetching when the cache is fresh', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => GITHUB_RESPONSE });
    vi.stubGlobal('fetch', fetchMock);

    await fetchLatestRelease(db);
    await fetchLatestRelease(db);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refetches when forceRefresh is true even if the cache is fresh', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => GITHUB_RESPONSE });
    vi.stubGlobal('fetch', fetchMock);

    await fetchLatestRelease(db);
    await fetchLatestRelease(db, { forceRefresh: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to the cache when a refetch fails', async () => {
    const okFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => GITHUB_RESPONSE });
    vi.stubGlobal('fetch', okFetch);
    await fetchLatestRelease(db); // seed the cache

    const failingFetch = vi.fn().mockRejectedValue(new Error('rate limited'));
    vi.stubGlobal('fetch', failingFetch);

    const release = await fetchLatestRelease(db, { forceRefresh: true });
    expect(release.tag).toBe('v0.15.0'); // served from cache, not thrown
  });

  it('rethrows when a fetch fails and there is no cache to fall back to', async () => {
    const failingFetch = vi.fn().mockRejectedValue(new Error('rate limited'));
    vi.stubGlobal('fetch', failingFetch);

    await expect(fetchLatestRelease(db)).rejects.toThrow('rate limited');
  });

  it('selects the newest stable release by default, skipping pre-releases', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => GITHUB_RESPONSE }));
    const release = await fetchLatestRelease(db);
    expect(release.tag).toBe('v0.15.0');
    expect(release.prerelease).toBe(false);
  });

  it('selects the newest release including pre-releases when includePrerelease is true', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => GITHUB_RESPONSE }));
    const release = await fetchLatestRelease(db, { includePrerelease: true });
    expect(release.tag).toBe('v0.15.1-b3');
    expect(release.prerelease).toBe(true);
  });

  // Regression: a real deployment cached a single "nightly" release, incorrectly
  // flagged prerelease:false by that fetch, and served it as the latest stable
  // build for hours despite includePrereleaseFirmware being off — because
  // fetchFromGithub() returned something incomplete/anomalous (no stable release
  // at all, one entry) and the app trusted and cached it for the full 6-hour
  // window regardless. A healthy fetch of an actively-maintained project's
  // releases always includes at least one stable release; a fetch with none is
  // treated as unreliable and must not overwrite a better existing cache, nor
  // get cached as truth itself.
  const SUSPICIOUS_RESPONSE = [
    { tag_name: 'nightly', prerelease: false, published_at: '2026-07-04T00:00:00Z', assets: [] }
  ];

  it('does not let a fetch with zero stable releases overwrite an existing cached stable release', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => GITHUB_RESPONSE }));
    await fetchLatestRelease(db); // seed a healthy cache containing v0.15.0 (stable)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => SUSPICIOUS_RESPONSE }));
    const release = await fetchLatestRelease(db, { forceRefresh: true });

    expect(release.tag).toBe('v0.15.0');
    expect(release.prerelease).toBe(false);
  });

  it('does not cache a fetch with zero stable releases, so the next call retries instead of reusing it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => SUSPICIOUS_RESPONSE }));
    const first = await fetchLatestRelease(db); // nothing cached yet — best available info is the suspicious result
    expect(first.tag).toBe('nightly');

    const secondFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => GITHUB_RESPONSE });
    vi.stubGlobal('fetch', secondFetch);
    const second = await fetchLatestRelease(db); // should retry live, not serve a poisoned "fresh" cache

    expect(secondFetch).toHaveBeenCalledTimes(1);
    expect(second.tag).toBe('v0.15.0');
  });
});
