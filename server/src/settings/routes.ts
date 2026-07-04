import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createSettingsRepository } from './repository.js';
import { createControllerRepository } from '../controllers/repository.js';
import { runDiscoveryCycle } from '../discovery/service.js';

export function createSettingsRouter(db: Database.Database): Router {
  const router = Router();
  const repo = createSettingsRepository(db);

  router.get('/', (_req, res) => {
    res.json(repo.get());
  });

  router.patch('/', (req, res) => {
    res.json(repo.update(req.body));
  });

  router.post('/rescan', async (_req, res) => {
    await runDiscoveryCycle(db);
    res.json({ controllers: createControllerRepository(db).list() });
  });

  return router;
}
