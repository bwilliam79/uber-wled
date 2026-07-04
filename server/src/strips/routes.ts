import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createStripRepository } from './repository.js';
import { createControllerRepository } from '../controllers/repository.js';
import { getState } from '../wled/client.js';
import { recommendSplits, type SplitRecommendation } from '../segments/recommend.js';

export function createStripsRouter(db: Database.Database): Router {
  const router = Router();
  const repo = createStripRepository(db);
  const controllerRepo = createControllerRepository(db);

  function resolveHost(controllerId: string): string | undefined {
    return controllerRepo.list().find((c) => c.id === controllerId)?.host;
  }

  router.get('/', (_req, res) => {
    res.json(repo.list());
  });

  router.post('/', async (req, res) => {
    const { controllerId, wledSegId, points, label } = req.body;
    const strip = repo.add({ controllerId, wledSegId, points, label: label ?? null });

    let recommendations: SplitRecommendation[] = [];
    const host = resolveHost(controllerId);
    if (host) {
      try {
        const sameController = repo.list().filter((s) => s.controllerId === controllerId);
        const state = await getState(host);
        recommendations = recommendSplits(sameController, state.seg);
      } catch {
        // Controller unreachable — the strip still saved; skip recommendations.
        recommendations = [];
      }
    }

    res.status(201).json({ strip, recommendations });
  });

  router.patch<{ id: string }>('/:id', (req, res) => {
    try {
      res.json(repo.update(req.params.id, req.body));
    } catch {
      res.status(404).json({ error: 'strip not found' });
    }
  });

  router.delete<{ id: string }>('/:id', (req, res) => {
    repo.remove(req.params.id);
    res.status(204).end();
  });

  return router;
}
