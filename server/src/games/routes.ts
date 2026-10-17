import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createGameSyncLogRepository, createGameTriggerRepository } from './repository.js';
import { syncGames } from './sync.js';

export function createGamesRouter(db: Database.Database): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(createGameTriggerRepository(db).list());
  });

  router.get('/log', (_req, res) => {
    res.json(createGameSyncLogRepository(db).listRecent(200));
  });

  router.get('/preview', async (_req, res) => {
    try {
      res.json(await syncGames(db, new Date(), fetch, { dryRun: true }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'sync failed';
      res.status(502).json({ error: message });
    }
  });

  router.post('/sync', async (req, res) => {
    const body = (req.body ?? {}) as { dryRun?: unknown; skipEventIds?: unknown };
    const dryRun = body.dryRun === true;
    const skipEventIds = Array.isArray(body.skipEventIds)
      ? body.skipEventIds.filter((id): id is string => typeof id === 'string')
      : [];
    try {
      res.json(await syncGames(db, new Date(), fetch, { dryRun, skipEventIds }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'sync failed';
      res.status(502).json({ error: message });
    }
  });

  return router;
}
