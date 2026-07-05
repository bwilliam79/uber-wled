import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createControllerRepository } from '../controllers/repository.js';
import { getState, setState } from '../wled/client.js';
import type { WledSegment } from '../wled/types.js';

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

    const body = req.body ?? {};
    const seg: Partial<WledSegment> = { id: Number(req.params.segId) };
    if (body.start !== undefined) seg.start = Number(body.start);
    if (body.stop !== undefined) seg.stop = Number(body.stop);
    if (body.grp !== undefined) seg.grp = Number(body.grp);
    if (body.spc !== undefined) seg.spc = Number(body.spc);
    if (body.of !== undefined) seg.of = Number(body.of);
    if (body.bri !== undefined) seg.bri = Number(body.bri);
    if (body.on !== undefined) seg.on = !!body.on;
    if (body.rev !== undefined) seg.rev = !!body.rev;
    if (body.mi !== undefined) seg.mi = !!body.mi;
    if (body.name !== undefined) seg.n = String(body.name);
    if (body.n !== undefined) seg.n = String(body.n);

    const state = await setState(host, { udpn: { nn: true }, seg: [seg] });
    res.json(state.seg);
  });

  router.post<{ controllerId: string }>('/', async (req, res) => {
    const host = resolveHost(req.params.controllerId);
    if (!host) return res.status(404).json({ error: 'controller not found' });
    const { start, stop } = req.body ?? {};
    if (typeof start !== 'number' || typeof stop !== 'number') {
      return res.status(400).json({ error: 'start and stop are required numbers' });
    }
    const current = await getState(host);
    const nextId = current.seg.length === 0 ? 0 : Math.max(...current.seg.map((s) => s.id)) + 1;
    const state = await setState(host, { udpn: { nn: true }, seg: [{ id: nextId, start, stop }] });
    res.status(201).json(state.seg);
  });

  router.delete<{ controllerId: string; segId: string }>('/:segId', async (req, res) => {
    const host = resolveHost(req.params.controllerId);
    if (!host) return res.status(404).json({ error: 'controller not found' });
    // WLED deletes a segment when it receives stop: 0 for that id.
    const state = await setState(host, { udpn: { nn: true }, seg: [{ id: Number(req.params.segId), stop: 0 }] });
    res.json(state.seg);
  });

  return router;
}
