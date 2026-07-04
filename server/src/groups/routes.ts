import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createGroupRepository } from './repository.js';

export function createGroupsRouter(db: Database.Database): Router {
  const router = Router();
  const repo = createGroupRepository(db);

  router.get('/', (_req, res) => res.json(repo.list()));

  router.post('/', (req, res) => {
    const created = repo.add({ name: req.body.name, members: req.body.members ?? [] });
    res.status(201).json(created);
  });

  router.patch('/:id', (req, res) => {
    try {
      res.json(repo.update(req.params.id, req.body));
    } catch {
      res.status(404).json({ error: 'group not found' });
    }
  });

  router.delete('/:id', (req, res) => {
    repo.remove(req.params.id);
    res.status(204).end();
  });

  return router;
}
