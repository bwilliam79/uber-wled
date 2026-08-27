import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createDb } from '../src/db/client.js';

describe('GET /health', () => {
  it('returns ok status', async () => {
    const app = createApp(createDb(':memory:'));
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('GET /api/version', () => {
  it('returns the running server package version and forbids caching', async () => {
    const { CURRENT_APP_VERSION } = await import('../src/appVersion.js');
    const app = createApp(createDb(':memory:'));
    const res = await request(app).get('/api/version');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ version: CURRENT_APP_VERSION });
    expect(res.headers['cache-control']).toMatch(/no-store/);
  });
});
