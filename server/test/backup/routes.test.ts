import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createDb } from '../../src/db/client.js';
import { createControllerRepository } from '../../src/controllers/repository.js';
import { createThemeRepository } from '../../src/themes/repository.js';
import { createBackupRouter } from '../../src/backup/routes.js';

function buildApp(db: ReturnType<typeof createDb>) {
  const app = express();
  app.use(express.json({ limit: '25mb' }));
  app.use('/api/backup', createBackupRouter(db));
  return app;
}

describe('backup routes', () => {
  let db: ReturnType<typeof createDb>;
  let app: express.Express;

  beforeEach(() => {
    db = createDb(':memory:');
    createControllerRepository(db).add({ name: 'Cabinet', host: '10.0.0.5', source: 'manual' });
    createThemeRepository(db).add({ name: 'Christmas', effect: 84, palette: 0, colors: [[220, 0, 0]], brightness: 185 });
    app = buildApp(db);
  });

  it('GET /api/backup returns a downloadable full backup with the right kind', async () => {
    const res = await request(app).get('/api/backup');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('uber-wled-backup.json');
    expect(res.body.kind).toBe('uber-wled-backup');
    expect(res.body.tables.controllers).toHaveLength(1);
    expect(res.body.tables.themes).toHaveLength(1);
  });

  it('POST /api/backup/restore round-trips and wipes prior state', async () => {
    const backup = (await request(app).get('/api/backup')).body;

    // Mutate the DB after taking the backup, then restore it away.
    createThemeRepository(db).add({ name: 'STRAY', effect: 0, palette: 0, colors: [[1, 1, 1]], brightness: 1 });
    expect(createThemeRepository(db).list()).toHaveLength(2);

    const res = await request(app).post('/api/backup/restore').send(backup);
    expect(res.status).toBe(200);
    expect(res.body.restored.themes).toBe(1);
    expect(createThemeRepository(db).list().map((t) => t.name)).toEqual(['Christmas']);
  });

  it('POST /api/backup/restore rejects a non-backup file with 400', async () => {
    const res = await request(app).post('/api/backup/restore').send({ kind: 'not-ours', tables: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('GET /api/backup/themes then POST /api/backup/themes appends under fresh ids', async () => {
    const themesFile = (await request(app).get('/api/backup/themes')).body;
    expect(themesFile.kind).toBe('uber-wled-themes');

    const res = await request(app).post('/api/backup/themes').send(themesFile);
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    // Appended: original + imported copy.
    expect(createThemeRepository(db).list()).toHaveLength(2);
  });

  it('GET /api/backup/schedules returns schedules and calendarEvents arrays', async () => {
    const res = await request(app).get('/api/backup/schedules');
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('uber-wled-schedules');
    expect(Array.isArray(res.body.schedules)).toBe(true);
    expect(Array.isArray(res.body.calendarEvents)).toBe(true);
  });
});
