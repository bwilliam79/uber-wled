import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createThemeRepository } from './repository.js';
import { createControllerRepository } from '../controllers/repository.js';
import { getPresets } from '../wled/client.js';

export function createThemesRouter(db: Database.Database): Router {
  const router = Router();
  const repo = createThemeRepository(db);
  const controllers = createControllerRepository(db);

  router.get('/', (_req, res) => res.json(repo.list()));

  router.post('/', (req, res) => {
    const { name, effect, palette, colors, brightness } = req.body;
    res.status(201).json(repo.add({ name, effect, palette, colors, brightness }));
  });

  router.delete('/:id', (req, res) => {
    repo.remove(req.params.id);
    res.status(204).end();
  });

  router.get('/presets/:controllerId', async (req, res) => {
    const controller = controllers.list().find((c) => c.id === req.params.controllerId);
    if (!controller) return res.status(404).json({ error: 'controller not found' });
    res.json(await getPresets(controller.host));
  });

  return router;
}
