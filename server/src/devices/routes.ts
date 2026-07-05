import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createControllerRepository } from '../controllers/repository.js';
import { getPresetsRaw, savePreset, deletePreset } from '../wled/client.js';
import { parsePresetsJson } from './presets.js';

export function createDevicesRouter(db: Database.Database): Router {
  const router = Router({ mergeParams: true });
  const repo = createControllerRepository(db);

  function resolveHost(controllerId: string): string | undefined {
    return repo.list().find((c) => c.id === controllerId)?.host;
  }

  router.get<{ controllerId: string }>('/presets', async (req, res) => {
    const host = resolveHost(req.params.controllerId);
    if (!host) return res.status(404).json({ error: 'controller not found' });
    try {
      res.json({ presets: parsePresetsJson(await getPresetsRaw(host)) });
    } catch (err: any) {
      res.status(502).json({ error: err.message });
    }
  });

  router.post<{ controllerId: string }>('/presets', async (req, res) => {
    const host = resolveHost(req.params.controllerId);
    if (!host) return res.status(404).json({ error: 'controller not found' });
    const { id, name, includeBrightness, saveSegmentBounds } = req.body ?? {};
    if (typeof name !== 'string' || name.length === 0) {
      return res.status(400).json({ error: 'name is required' });
    }
    try {
      // Slot picking (id omitted → next free 1-250) happens inside savePreset (Phase A).
      const saved = await savePreset(host, {
        id: typeof id === 'number' ? id : undefined,
        name,
        includeBrightness: !!includeBrightness,
        saveSegmentBounds: !!saveSegmentBounds
      });
      res.status(201).json({ id: saved.id, name });
    } catch (err: any) {
      res.status(502).json({ error: err.message });
    }
  });

  router.delete<{ controllerId: string; presetId: string }>('/presets/:presetId', async (req, res) => {
    const host = resolveHost(req.params.controllerId);
    if (!host) return res.status(404).json({ error: 'controller not found' });
    try {
      await deletePreset(host, Number(req.params.presetId));
      res.status(204).end();
    } catch (err: any) {
      res.status(502).json({ error: err.message });
    }
  });

  return router;
}
