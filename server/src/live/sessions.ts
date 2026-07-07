import type Database from 'better-sqlite3';
import { createControllerRepository } from '../controllers/repository.js';
import { createSettingsRepository } from '../settings/repository.js';
import { getInfo, getState } from '../wled/client.js';
import type { WledInfo, WledState } from '../wled/types.js';

export interface LiveEvent {
  controllerId: string;
  reachable: boolean;
  state?: WledState;
  info?: WledInfo;
}

export type LiveListener = (event: LiveEvent) => void;

export interface WledLiveClient {
  getState(host: string): Promise<WledState>;
  getInfo(host: string): Promise<WledInfo>;
}

interface Session {
  controllerId: string;
  host: string;
  timer: ReturnType<typeof setInterval>;
  tick: number;
  refCount: number;
  listeners: Set<LiveListener>;
}

const INFO_EVERY_N_TICKS = 10;

export function createLiveSessionManager(
  db: Database.Database,
  wled: WledLiveClient = { getState, getInfo }
) {
  const sessions = new Map<string, Session>();
  const controllers = createControllerRepository(db);
  const settings = createSettingsRepository(db);

  async function poll(
    session: Session,
    opts: { forceInfo?: boolean; countsAsTick?: boolean } = {}
  ): Promise<void> {
    const countsAsTick = opts.countsAsTick ?? true;
    const includeInfo = opts.forceInfo || session.tick % INFO_EVERY_N_TICKS === 0;
    if (countsAsTick) session.tick += 1;
    let event: LiveEvent;
    try {
      const state = await wled.getState(session.host);
      event = { controllerId: session.controllerId, reachable: true, state };
      if (includeInfo) event.info = await wled.getInfo(session.host);
    } catch {
      event = { controllerId: session.controllerId, reachable: false };
    }
    for (const listener of session.listeners) listener(event);
  }

  function startSession(controllerId: string, host: string): Session {
    const intervalMs = settings.get().livePollIntervalSeconds * 1000;
    const session: Session = {
      controllerId,
      host,
      tick: 0,
      refCount: 0,
      listeners: new Set(),
      timer: setInterval(() => {
        void poll(session);
      }, intervalMs)
    };
    sessions.set(controllerId, session);
    // Immediate first poll so subscribers see data (and info) right away.
    queueMicrotask(() => {
      void poll(session);
    });
    return session;
  }

  return {
    subscribe(controllerIds: string[], listener: LiveListener): () => void {
      const known = new Map(controllers.list().map((c) => [c.id, c]));
      const joined: Session[] = [];
      for (const id of controllerIds) {
        const controller = known.get(id);
        if (!controller) {
          listener({ controllerId: id, reachable: false });
          continue;
        }
        const existingSession = sessions.get(id);
        const session = existingSession ?? startSession(id, controller.host);
        session.refCount += 1;
        session.listeners.add(listener);
        joined.push(session);
        if (existingSession) {
          // A brand-new session already does an immediate first poll (see
          // startSession) so its subscriber sees data right away. A listener
          // joining an ALREADY-RUNNING session (kept alive by some other
          // subscriber — another tab, another page) wouldn't otherwise see
          // anything until that session's next regularly scheduled tick,
          // which can be seconds away — and even then only carries `info`
          // once every INFO_EVERY_N_TICKS. Give this new listener an
          // immediate, info-inclusive catch-up without disturbing the
          // session's regular tick cadence (countsAsTick: false).
          queueMicrotask(() => {
            void poll(session, { forceInfo: true, countsAsTick: false });
          });
        }
      }
      let closed = false;
      return () => {
        if (closed) return;
        closed = true;
        for (const session of joined) {
          session.refCount -= 1;
          session.listeners.delete(listener);
          if (session.refCount <= 0) {
            clearInterval(session.timer);
            sessions.delete(session.controllerId);
          }
        }
      };
    },
    activeSessionCount(): number {
      return sessions.size;
    }
  };
}

export type LiveSessionManager = ReturnType<typeof createLiveSessionManager>;
