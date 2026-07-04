import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDb } from '../../src/db/client.js';
import { createFloorplansRouter } from '../../src/floorplans/routes.js';

describe('floorplans routes', () => {
  let app: express.Express;
  let uploadDir: string;

  beforeEach(() => {
    uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uber-wled-'));
    const db = createDb(':memory:');
    app = express();
    app.use(express.json());
    app.use('/api/floorplans', createFloorplansRouter(db, uploadDir));
  });

  afterEach(() => fs.rmSync(uploadDir, { recursive: true, force: true }));

  it('uploads an image and lists it', async () => {
    const post = await request(app)
      .post('/api/floorplans')
      .field('name', 'Main Floor')
      .attach('image', Buffer.from('fake-png-bytes'), 'floorplan.png');
    expect(post.status).toBe(201);
    expect(post.body.name).toBe('Main Floor');
    expect(fs.existsSync(post.body.imagePath)).toBe(true);

    const get = await request(app).get('/api/floorplans');
    expect(get.body).toHaveLength(1);
  });

  it('updates crop/rotate/zoom metadata', async () => {
    const post = await request(app)
      .post('/api/floorplans')
      .field('name', 'Main Floor')
      .attach('image', Buffer.from('fake-png-bytes'), 'floorplan.png');

    const patch = await request(app)
      .patch(`/api/floorplans/${post.body.id}`)
      .send({ cropX: 0.1, rotation: 90, zoom: 1.5 });
    expect(patch.status).toBe(200);
    expect(patch.body.cropX).toBe(0.1);
    expect(patch.body.rotation).toBe(90);
    expect(patch.body.zoom).toBe(1.5);
  });

  it('rejects an upload with no image file attached', async () => {
    const post = await request(app)
      .post('/api/floorplans')
      .field('name', 'Main Floor');
    expect(post.status).toBe(400);
    expect(post.body.error).toBeTruthy();
  });

  it('returns 404 when patching a nonexistent floorplan id', async () => {
    const patch = await request(app)
      .patch('/api/floorplans/does-not-exist')
      .send({ cropX: 0.1, rotation: 90, zoom: 1.5 });
    expect(patch.status).toBe(404);
    expect(patch.body.error).toBeTruthy();
  });
});
