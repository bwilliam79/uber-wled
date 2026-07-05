import { describe, it, expect, afterEach, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createDb } from '../../src/db/client.js';
import { createLiveRouter } from '../../src/live/routes.js';
import type { LiveEvent, LiveListener, LiveSessionManager } from '../../src/live/sessions.js';
import type { WledState } from '../../src/wled/types.js';

const STATE: WledState = { on: true, bri: 9, ps: -1, seg: [] };

function makeFakeManager(initialEvents: LiveEvent[]) {
  const unsubscribe = vi.fn();
  const subscribe = vi.fn((_ids: string[], listener: LiveListener) => {
    for (const event of initialEvents) listener(event);
    return unsubscribe;
  });
  const manager = { subscribe, activeSessionCount: () => 0 } as unknown as LiveSessionManager;
  return { manager, subscribe, unsubscribe };
}

describe('live SSE route', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  async function startServer(manager: LiveSessionManager, heartbeatMs?: number): Promise<number> {
    const app = express();
    app.use('/api/live', createLiveRouter(createDb(':memory:'), manager, heartbeatMs));
    const server = app.listen(0);
    servers.push(server);
    await new Promise((resolve) => server.once('listening', resolve));
    return (server.address() as AddressInfo).port;
  }

  it('400s without a controllers query param', async () => {
    const { manager } = makeFakeManager([]);
    const port = await startServer(manager);
    const res = await fetch(`http://127.0.0.1:${port}/api/live`);
    expect(res.status).toBe(400);
  });

  it('streams status events with SSE headers', async () => {
    const { manager, subscribe } = makeFakeManager([{ controllerId: 'c1', reachable: true, state: STATE }]);
    const port = await startServer(manager);
    const abort = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/live?controllers=c1,c2`, { signal: abort.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('cache-control')).toBe('no-cache');

    const reader = res.body!.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain('event: status\n');
    expect(text).toContain('"controllerId":"c1"');
    expect(text).toContain('"reachable":true');
    expect(subscribe).toHaveBeenCalledWith(['c1', 'c2'], expect.any(Function));
    abort.abort();
  });

  it('unsubscribes from the session manager when the client disconnects', async () => {
    const { manager, unsubscribe } = makeFakeManager([{ controllerId: 'c1', reachable: false }]);
    const port = await startServer(manager);
    const abort = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/live?controllers=c1`, { signal: abort.signal });
    await res.body!.getReader().read();
    abort.abort();
    await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(1));
  });

  it('writes heartbeat comments on the configured interval', async () => {
    const { manager } = makeFakeManager([]); // no events → first bytes must be the heartbeat
    const port = await startServer(manager, 25);
    const abort = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/live?controllers=c1`, { signal: abort.signal });
    const { value } = await res.body!.getReader().read();
    expect(new TextDecoder().decode(value)).toContain(': heartbeat');
    abort.abort();
  });
});
