import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createControllerRepository } from '../controllers/repository.js';
import { createThemeRepository } from '../themes/repository.js';
import { setState, applyPreset } from '../wled/client.js';
import type { WledState, WledSegment } from '../wled/types.js';

export type ControlAction =
  | { type: 'power'; on: boolean }
  | { type: 'brightness'; value: number }
  | { type: 'preset'; presetId: number }
  | { type: 'theme'; themeId: string };

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
    const { members, action } = req.body as { members: Member[]; action: ControlAction };
    const results = await applyToMembers(db, members, action);
    res.json({ results });
  });

  return router;
}
