import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createRoomLabelRepository } from './repository.js';

export function createRoomLabelsRouter(db: Database.Database): Router {
  const router = Router();
  const repo = createRoomLabelRepository(db);

  router.get('/', (_req, res) => {
    res.json(repo.list());
  });

  router.post('/', (req, res) => {
    const { name, x, y } = req.body;
    if (typeof name !== 'string' || typeof x !== 'number' || typeof y !== 'number') {
      return res.status(400).json({ error: 'name, x, and y are required' });
    }
    res.status(201).json(repo.add({ name, x, y }));
  });

  router.patch<{ id: string }>('/:id', (req, res) => {
    try {
      res.json(repo.update(req.params.id, req.body));
    } catch {
      res.status(404).json({ error: 'room label not found' });
    }
  });

  router.delete<{ id: string }>('/:id', (req, res) => {
    repo.remove(req.params.id);
    res.status(204).end();
  });

  return router;
}
