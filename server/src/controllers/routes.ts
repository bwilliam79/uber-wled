import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createControllerRepository } from './repository.js';
import { createControllerStatusRepository } from './statusRepository.js';
import { createCapabilitiesRepository } from './capabilitiesRepository.js';
import { refreshCapabilities } from './capabilityService.js';
import { importSchedules } from './scheduleImport.js';
import { createFirmwareRouter } from '../firmware/routes.js';
import { assertValidHost } from './validateHost.js';

export function createControllersRouter(db: Database.Database): Router {
  const router = Router();
  const repo = createControllerRepository(db);
  const statusRepo = createControllerStatusRepository(db);
  const capsRepo = createCapabilitiesRepository(db);

  router.get('/', (_req, res) => {
    res.json(repo.list());
  });

  router.post('/', (req, res) => {
    const { name, host } = req.body;
    if (!name || !host) {
      return res.status(400).json({ error: 'name and host are required' });
    }
    try {
      assertValidHost(host);
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
    const created = repo.add({ name, host, source: 'manual' });
    res.status(201).json(created);
  });

  router.delete('/:id', (req, res) => {
    repo.remove(req.params.id);
    res.status(204).end();
  });

  router.get('/:id/status', (req, res) => {
    const controller = repo.list().find((c) => c.id === req.params.id);
    if (!controller) return res.status(404).json({ error: 'controller not found' });

    const cached = statusRepo.get(controller.id);
    res.json(
      cached ?? { controllerId: controller.id, reachable: false, info: null, state: null, polledAt: null }
    );
  });

  router.get('/:id/capabilities', async (req, res) => {
    const controller = repo.list().find((c) => c.id === req.params.id);
    if (!controller) return res.status(404).json({ error: 'controller not found' });

    const cached = capsRepo.get(controller.id);
    if (cached) return res.json(cached);

    try {
      const fresh = await refreshCapabilities(db, controller);
      res.json(fresh);
    } catch (err: any) {
      res.status(503).json({
        error: `capabilities not cached and device fetch failed: ${err.message}`
      });
    }
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
