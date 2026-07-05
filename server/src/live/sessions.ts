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

  async function poll(session: Session): Promise<void> {
    const includeInfo = session.tick % INFO_EVERY_N_TICKS === 0;
    session.tick += 1;
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
        const session = sessions.get(id) ?? startSession(id, controller.host);
        session.refCount += 1;
        session.listeners.add(listener);
        joined.push(session);
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
