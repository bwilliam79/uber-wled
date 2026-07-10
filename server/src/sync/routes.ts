import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createControllerRepository } from '../controllers/repository.js';
import {
  createSyncGroupRepository, SyncGroupNotFoundError, SyncMemberConflictError
} from './repository.js';
import { NoFreeSyncBitError } from './bitmask.js';

export function createSyncGroupsRouter(db: Database.Database): Router {
  const router = Router();
  const controllers = createControllerRepository(db);
  const repo = createSyncGroupRepository(db, (id) => controllers.list().find((c) => c.id === id)?.host);

  router.get('/', (_req, res) => res.json(repo.list()));

  router.post('/', (req, res) => {
    const { name, memberControllerIds } = req.body ?? {};
    if (typeof name !== 'string' || name.length === 0) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!Array.isArray(memberControllerIds) || memberControllerIds.some((id: unknown) => typeof id !== 'string')) {
      return res.status(400).json({ error: 'memberControllerIds must be an array of controller ids' });
    }
    res.status(201).json(repo.add({ name, memberControllerIds }));
  });

  router.patch('/:id', (req, res) => {
    try {
      let group = repo.get(req.params.id);
      if (typeof req.body?.name === 'string') group = repo.rename(req.params.id, req.body.name);
      if (Array.isArray(req.body?.memberControllerIds)) group = repo.setMembers(req.params.id, req.body.memberControllerIds);
      res.json(group);
    } catch (err: any) {
      if (err instanceof SyncGroupNotFoundError) return res.status(404).json({ error: err.message });
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      await repo.remove(req.params.id);
      res.status(204).end();
    } catch (err: any) {
      if (err instanceof SyncGroupNotFoundError) return res.status(404).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/:id/activate', async (req, res) => {
    try {
      const { group, results } = await repo.activate(req.params.id);
      res.json({ group, results });
    } catch (err: any) {
      if (err instanceof SyncGroupNotFoundError) return res.status(404).json({ error: err.message });
      if (err instanceof SyncMemberConflictError) {
        const name =
          controllers.list().find((c) => c.id === err.controllerId)?.name ?? 'A controller';
        return res.status(409).json({
          error:
            `"${name}" is already active in sync group "${err.otherGroupName}". ` +
            `Deactivate that group first, or remove the shared controller from one of them.`
        });
      }
      if (err instanceof NoFreeSyncBitError) {
        return res.status(409).json({ error: err.message });
      }
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/:id/deactivate', async (req, res) => {
    try {
      const { group, results } = await repo.deactivate(req.params.id);
      res.json({ group, results });
    } catch (err: any) {
      if (err instanceof SyncGroupNotFoundError) return res.status(404).json({ error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
