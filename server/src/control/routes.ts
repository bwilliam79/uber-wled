import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createControllerRepository } from '../controllers/repository.js';
import { createThemeRepository } from '../themes/repository.js';
import { setState, applyPreset } from '../wled/client.js';
import type { WledState, WledSegment } from '../wled/types.js';
import { applyControlPatch, GroupNotFoundError, type Target, type ControlPatch } from './applyV2.js';

export type ControlAction =
  | { type: 'power'; on: boolean }
  | { type: 'brightness'; value: number }
  | { type: 'preset'; presetId: number }
  | { type: 'theme'; themeId: string }
  | { type: 'effect'; effectId: number };

export interface Member {
  controllerId: string;
  wledSegId: number;
}

async function applyToMember(
  host: string,
  member: Member,
  action: ControlAction,
  resolveTheme: (id: string) => { effect: number; palette: number; colors: number[][]; brightness: number } | undefined
): Promise<WledState> {
  switch (action.type) {
    case 'power':
      return setState(host, { on: action.on });
    case 'brightness':
      return setState(host, { bri: action.value });
    case 'preset':
      return applyPreset(host, action.presetId);
    case 'theme': {
      const theme = resolveTheme(action.themeId);
      if (!theme) throw new Error(`theme ${action.themeId} not found`);
      const segPatch: Partial<WledSegment> = { fx: theme.effect, pal: theme.palette, col: theme.colors };
      return setState(host, { bri: theme.brightness, seg: [segPatch] });
    }
    case 'effect': {
      const segPatch: Partial<WledSegment> = { fx: action.effectId };
      return setState(host, { seg: [segPatch] });
    }
  }
}

export async function applyToMembers(
  db: Database.Database,
  members: Member[],
  action: ControlAction
): Promise<{ controllerId: string; wledSegId: number; ok: boolean; error?: string }[]> {
  const controllers = createControllerRepository(db);
  const themes = createThemeRepository(db);
  const resolveTheme = (id: string) => themes.get(id);

  return Promise.all(
    members.map(async (member) => {
      const controller = controllers.list().find((c) => c.id === member.controllerId);
      if (!controller) {
        return { controllerId: member.controllerId, wledSegId: member.wledSegId, ok: false, error: 'controller not found' };
      }
      try {
        await applyToMember(controller.host, member, action, resolveTheme);
        return { controllerId: member.controllerId, wledSegId: member.wledSegId, ok: true };
      } catch {
        try {
          await applyToMember(controller.host, member, action, resolveTheme);
          return { controllerId: member.controllerId, wledSegId: member.wledSegId, ok: true };
        } catch (secondError: any) {
          return { controllerId: member.controllerId, wledSegId: member.wledSegId, ok: false, error: secondError.message ?? 'unknown error' };
        }
      }
    })
  );
}

export function createControlRouter(db: Database.Database): Router {
  const router = Router();

  router.post('/apply', async (req, res) => {
    const body = req.body ?? {};

    if (Array.isArray(body.targets)) {
      // v2: { targets: Target[], patch: ControlPatch }
      if (typeof body.patch !== 'object' || body.patch === null) {
        return res.status(400).json({ error: 'patch is required' });
      }
      try {
        const results = await applyControlPatch(db, body.targets as Target[], body.patch as ControlPatch);
        return res.json({ results });
      } catch (err) {
        if (err instanceof GroupNotFoundError) {
          return res.status(400).json({ error: err.message });
        }
        throw err;
      }
    }

    if (Array.isArray(body.members)) {
      // v1: { members: Member[], action: ControlAction } — unchanged until Phase I
      const results = await applyToMembers(db, body.members as Member[], body.action as ControlAction);
      return res.json({ results });
    }

    return res.status(400).json({ error: 'body must be {targets,patch} (v2) or {members,action} (v1)' });
  });

  return router;
}
