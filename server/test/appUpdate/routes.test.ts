import { describe, it, expect, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createDb } from '../../src/db/client.js';
import { createAppUpdateRouter, isNewerVersion } from '../../src/appUpdate/routes.js';
import { CURRENT_APP_VERSION } from '../../src/appVersion.js';

function githubResponse(version: string) {
  return { ok: true, json: async () => ({ version }) } as Response;
}

afterEach(() => vi.unstubAllGlobals());

function buildApp() {
  const db = createDb(':memory:');
  const app = express();
  app.use('/api/app-update', createAppUpdateRouter(db));
  return app;
}

describe('GET /api/app-update', () => {
  it('reports updateAvailable when the tip of main has a newer version than this instance', async () => {
    const [maj, min, patch] = CURRENT_APP_VERSION.split('.').map(Number);
    const newer = `${maj}.${min}.${patch + 1}`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(githubResponse(newer)));

    const app = buildApp();
    const res = await request(app).get('/api/app-update');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      currentVersion: CURRENT_APP_VERSION,
      latestVersion: newer,
      updateAvailable: true,
      repoUrl: 'https://github.com/bwilliam79/uber-wled'
    });
  });

  it('reports updateAvailable false when already on the latest version', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(githubResponse(CURRENT_APP_VERSION)));

    const app = buildApp();
    const res = await request(app).get('/api/app-update');

    expect(res.body.updateAvailable).toBe(false);
    expect(res.body.latestVersion).toBe(CURRENT_APP_VERSION);
  });

  it('caches the GitHub check instead of refetching on every request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(githubResponse(CURRENT_APP_VERSION));
    vi.stubGlobal('fetch', fetchMock);

    const app = buildApp();
    await request(app).get('/api/app-update');
    await request(app).get('/api/app-update');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('serves updateAvailable false without erroring when the GitHub check fails and nothing is cached yet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

    const app = buildApp();
    const res = await request(app).get('/api/app-update');

    expect(res.status).toBe(200);
    expect(res.body.currentVersion).toBe(CURRENT_APP_VERSION);
    expect(res.body.latestVersion).toBeNull();
    expect(res.body.updateAvailable).toBe(false);
  });
});

describe('isNewerVersion', () => {
  it('treats a higher patch, minor, or major as newer', () => {
    expect(isNewerVersion('1.5.3', '1.5.2')).toBe(true);
    expect(isNewerVersion('1.6.0', '1.5.9')).toBe(true);
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(true);
  });

  it('treats equal or lower versions as not newer', () => {
    expect(isNewerVersion('1.5.2', '1.5.2')).toBe(false);
    expect(isNewerVersion('1.4.9', '1.5.0')).toBe(false);
  });
});
