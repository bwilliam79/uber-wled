import { Router } from 'express';
import type Database from 'better-sqlite3';
import { applyControlPatch, GroupNotFoundError, type Target, type ControlPatch } from './applyV2.js';

export function createControlRouter(db: Database.Database): Router {
  const router = Router();

  router.post('/apply', async (req, res) => {
    const { targets, patch } = req.body as { targets?: Target[]; patch?: ControlPatch };
    if (!Array.isArray(targets) || typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
      return res.status(400).json({ error: 'invalid body: expected { targets, patch }' });
    }
    try {
      const results = await applyControlPatch(db, targets, patch);
      res.json({ results });
    } catch (err) {
      if (err instanceof GroupNotFoundError) {
        return res.status(400).json({ error: err.message }); // 'group not found: <id>' — Phase B behavior, keep it
      }
      throw err;
    }
  });

  return router;
}
