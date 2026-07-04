import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createPlacementRepository } from './repository.js';

export function createPlacementsRouter(db: Database.Database): Router {
  const router = Router({ mergeParams: true });
  const repo = createPlacementRepository(db);

  router.get<{ floorplanId: string }>('/', (req, res) => {
    res.json(repo.listByFloorplan(req.params.floorplanId));
  });

  router.post<{ floorplanId: string }>('/', (req, res) => {
    const { controllerId, wledSegId, points, lengthMeters } = req.body;
    const placement = repo.add({
      floorplanId: req.params.floorplanId,
      controllerId,
      wledSegId,
      points,
      lengthMeters: lengthMeters ?? null
    });
    res.status(201).json({ placement, recommendations: [] });
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
