import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createControllerRepository } from './repository.js';
import { importSchedules } from './scheduleImport.js';
import { createFirmwareRouter } from '../firmware/routes.js';

export function createControllersRouter(db: Database.Database): Router {
  const router = Router();
  const repo = createControllerRepository(db);

  router.get('/', (_req, res) => {
    res.json(repo.list());
  });

  router.post('/', (req, res) => {
    const { name, host } = req.body;
    if (!name || !host) {
      return res.status(400).json({ error: 'name and host are required' });
    }
    const created = repo.add({ name, host, source: 'manual' });
    res.status(201).json(created);
  });

  router.delete('/:id', (req, res) => {
    repo.remove(req.params.id);
    res.status(204).end();
  });

  router.post('/:id/import-schedules', async (req, res) => {
    try {
      const result = await importSchedules(db, req.params.id, { disableOnDevice: !!req.body?.disableOnDevice });
      res.json(result);
    } catch (err: any) {
      const status = err.statusCode ?? 500;
      res.status(status).json({ error: err.message });
    }
  });

  router.use('/:id/firmware', createFirmwareRouter(db));

  return router;
}
