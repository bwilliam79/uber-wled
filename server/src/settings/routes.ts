import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createSettingsRepository } from './repository.js';
import { createControllerRepository } from '../controllers/repository.js';
import { runDiscoveryCycle } from '../discovery/service.js';
import { geocodeAddress } from './geocode.js';

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

  // Server-side proxy for OpenStreetMap Nominatim geocoding — see geocode.ts
  // for why this isn't called directly from the browser. This is the one
  // user-initiated, opt-in outbound call this route makes; it is never
  // triggered automatically.
  router.get('/geocode', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) return res.status(400).json({ error: 'q (address query) is required' });

    try {
      const results = await geocodeAddress(q);
      res.json({ results });
    } catch {
      res.status(502).json({ error: 'geocoding service unavailable' });
    }
  });

  return router;
}
