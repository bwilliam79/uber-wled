import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createControllerRepository } from '../controllers/repository.js';
import { getState, setSegment } from '../wled/client.js';

export function createSegmentsRouter(db: Database.Database): Router {
  const router = Router({ mergeParams: true });
  const repo = createControllerRepository(db);

  function resolveHost(controllerId: string): string | undefined {
    return repo.list().find((c) => c.id === controllerId)?.host;
  }

  router.get<{ controllerId: string }>('/', async (req, res) => {
    const host = resolveHost(req.params.controllerId);
    if (!host) return res.status(404).json({ error: 'controller not found' });
    const state = await getState(host);
    res.json(state.seg);
  });

  router.put<{ controllerId: string; segId: string }>('/:segId', async (req, res) => {
    const host = resolveHost(req.params.controllerId);
    if (!host) return res.status(404).json({ error: 'controller not found' });
    const { start, stop } = req.body;
    const state = await setSegment(host, { id: Number(req.params.segId), start, stop });
    res.json(state.seg);
  });

  return router;
}
