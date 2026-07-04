import express from 'express';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { createControllersRouter } from './controllers/routes.js';
import { createSegmentsRouter } from './segments/routes.js';

export function createApp(db: Database.Database) {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/controllers', createControllersRouter(db));
  app.use('/api/controllers/:controllerId/segments', createSegmentsRouter(db));

  const staticDir = process.env.STATIC_DIR;
  if (staticDir) {
    app.use(express.static(staticDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  return app;
}
