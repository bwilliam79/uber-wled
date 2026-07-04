import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createPlacementRepository } from './repository.js';
import { createControllerRepository } from '../controllers/repository.js';
import { getState } from '../wled/client.js';
import { recommendSplits, type SplitRecommendation } from '../segments/recommend.js';

export function createPlacementsRouter(db: Database.Database): Router {
  const router = Router({ mergeParams: true });
  const repo = createPlacementRepository(db);
  const controllerRepo = createControllerRepository(db);

  function resolveHost(controllerId: string): string | undefined {
    return controllerRepo.list().find((c) => c.id === controllerId)?.host;
  }

  router.get<{ floorplanId: string }>('/', (req, res) => {
    res.json(repo.listByFloorplan(req.params.floorplanId));
  });

  router.post<{ floorplanId: string }>('/', async (req, res) => {
    const { controllerId, wledSegId, points, lengthMeters } = req.body;
    const placement = repo.add({
      floorplanId: req.params.floorplanId,
      controllerId,
      wledSegId,
      points,
      lengthMeters: lengthMeters ?? null
    });

    let recommendations: SplitRecommendation[] = [];
    const host = resolveHost(controllerId);
    if (host) {
      try {
        const placements = repo.listByFloorplan(req.params.floorplanId);
        const state = await getState(host);
        recommendations = recommendSplits(placements, state.seg);
      } catch {
        // Controller unreachable or returned bad data — the placement itself
        // still saved; the split-recommendation check just can't run right now.
        recommendations = [];
      }
    }

    res.status(201).json({ placement, recommendations });
  });

  router.patch<{ floorplanId: string; id: string }>('/:id', (req, res) => {
    try {
      res.json(repo.update(req.params.id, req.body));
    } catch {
      res.status(404).json({ error: 'placement not found' });
    }
  });

  router.delete<{ floorplanId: string; id: string }>('/:id', (req, res) => {
    repo.remove(req.params.id);
    res.status(204).end();
  });

  return router;
}
