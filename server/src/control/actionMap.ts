import type Database from 'better-sqlite3';
import { createThemeRepository } from '../themes/repository.js';
import { applyControlPatch, type Target, type ControlPatch, type ApplyResult } from './applyV2.js';

/**
 * The v1 action union. It survives ONLY as the persisted shape of
 * schedules.action_type/action_payload and calendar_events rows — the wire
 * API and all client code use ControlPatch. Do not export from routes.ts.
 */
export type ControlAction =
  | { type: 'power'; on: boolean }
  | { type: 'brightness'; value: number }
  | { type: 'preset'; presetId: number }
  | { type: 'theme'; themeId: string }
  | { type: 'effect'; effectId: number };

export interface Member {
  controllerId: string;
  /** null = whole-controller target (every segment), matching Target's
   *  'controller' kind — same convention as applyV2.ts's ResolvedTarget. */
  wledSegId: number | null;
}

export function actionToPatch(
  action: ControlAction,
  resolveTheme: (id: string) => { effect: number; palette: number; colors: number[][]; brightness: number } | undefined
): ControlPatch {
  switch (action.type) {
    case 'power':
      return { on: action.on };
    case 'brightness':
      return { bri: action.value };
    case 'preset':
      // WLED presets are device-level: top-level `ps`, wledSegId is ignored
      // by the device — identical to v1's applyPreset(host, id) semantics.
      return { ps: action.presetId };
    case 'effect':
      return { seg: { fxId: action.effectId } };
    case 'theme': {
      const theme = resolveTheme(action.themeId);
      if (!theme) throw new Error(`theme ${action.themeId} not found`);
      return {
        bri: theme.brightness,
        seg: { fxId: theme.effect, palId: theme.palette, col: theme.colors }
      };
    }
  }
}

/**
 * v1-shaped entry point for the scheduler engine and calendar trigger path.
 * Maps members → segment or controller Targets (never group-kind — the
 * scheduler/calendar engine already resolved any group into concrete
 * members via expandTargets before calling this) and the action → a
 * ControlPatch, then delegates to applyControlPatch (per-target isolation,
 * one retry, and udpn:{nn:true} on every device write). Targets are never
 * group-kind, so applyControlPatch's GroupNotFoundError can never throw
 * from here.
 */
export async function applyActionV2(
  db: Database.Database,
  members: Member[],
  action: ControlAction
): Promise<ApplyResult[]> {
  const themes = createThemeRepository(db);
  let patch: ControlPatch;
  try {
    patch = actionToPatch(action, (id) => themes.get(id));
  } catch (err) {
    // v1 parity: an unresolvable theme fails every member; it never throws
    // out of the batch.
    const message = err instanceof Error ? err.message : 'unknown error';
    return members.map((m) => ({
      controllerId: m.controllerId,
      wledSegId: m.wledSegId,
      ok: false,
      error: message
    }));
  }

  const targets: Target[] = members.map((m) =>
    m.wledSegId === null
      ? { kind: 'controller', controllerId: m.controllerId }
      : { kind: 'segment', controllerId: m.controllerId, wledSegId: m.wledSegId }
  );
  return applyControlPatch(db, targets, patch);
}
