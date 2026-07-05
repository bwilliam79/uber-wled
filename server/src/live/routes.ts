import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createLiveSessionManager, type LiveSessionManager } from './sessions.js';

export function createLiveRouter(
  db: Database.Database,
  manager: LiveSessionManager = createLiveSessionManager(db),
  heartbeatMs = 15_000
): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const raw = typeof req.query.controllers === 'string' ? req.query.controllers : '';
    const controllerIds = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (controllerIds.length === 0) {
      return res.status(400).json({ error: 'controllers query parameter is required' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const unsubscribe = manager.subscribe(controllerIds, (event) => {
      res.write(`event: status\ndata: ${JSON.stringify(event)}\n\n`);
    });

    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, heartbeatMs);

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  return router;
}
