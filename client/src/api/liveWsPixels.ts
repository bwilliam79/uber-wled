import { useEffect, useState } from 'react';

const MAX_BACKOFF_MS = 15_000;

interface HostConnection {
  ws: WebSocket | null;
  timer: ReturnType<typeof setTimeout> | null;
  attempts: number;
  stopped: boolean;
}

/**
 * Real per-pixel live colors via WLED's native live-view WebSocket protocol
 * (the same channel the official WLED app's "Peek" feature and the device's
 * own /liveview page use — confirmed by instrumenting a real device's `ws://`
 * traffic: connecting and sending `{"lv":true}` gets an ack, then the device
 * streams binary frames continuously: byte 0 = 0x4C ('L'), byte 1 = protocol
 * version, followed by one RGB triplet per LED across the device's whole
 * pixel buffer (not per-segment). `/json/live` (HTTP polling) returns 501 on
 * this firmware — this WebSocket channel is the only real live-pixel source).
 *
 * One connection per host, opened directly from the browser (this app is
 * LAN-only over plain HTTP, so no proxying needed) and reopened with backoff
 * on drop. Returns a map of host -> flat RGB byte buffer (3 bytes per LED,
 * device-wide LED order) for whichever hosts currently have a live frame.
 */
export function useLiveWsPixels(hosts: string[]): Map<string, Uint8Array> {
  const [pixels, setPixels] = useState<Map<string, Uint8Array>>(new Map());
  const key = [...new Set(hosts)].filter(Boolean).sort().join(',');

  useEffect(() => {
    const uniqueHosts = key === '' ? [] : key.split(',');
    const connections = new Map<string, HostConnection>();

    const connect = (host: string) => {
      const conn = connections.get(host);
      if (!conn || conn.stopped) return;
      const ws = new WebSocket(`ws://${host}/ws`);
      ws.binaryType = 'arraybuffer';
      conn.ws = ws;
      ws.addEventListener('open', () => {
        conn.attempts = 0;
        ws.send(JSON.stringify({ lv: true }));
      });
      ws.addEventListener('message', (ev) => {
        if (typeof ev.data === 'string') return; // JSON acks/state, not a pixel frame
        const bytes = new Uint8Array(ev.data as ArrayBuffer);
        if (bytes.length < 2 || bytes[0] !== 0x4c) return; // not an 'L'ive frame
        const frame = bytes.subarray(2);
        setPixels((prev) => {
          const next = new Map(prev);
          next.set(host, frame);
          return next;
        });
      });
      ws.addEventListener('close', () => scheduleReconnect(host));
      ws.addEventListener('error', () => ws.close());
    };

    const scheduleReconnect = (host: string) => {
      const conn = connections.get(host);
      if (!conn || conn.stopped) return;
      conn.attempts += 1;
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(conn.attempts, 4));
      conn.timer = setTimeout(() => connect(host), delay);
    };

    for (const host of uniqueHosts) {
      connections.set(host, { ws: null, timer: null, attempts: 0, stopped: false });
      connect(host);
    }

    return () => {
      for (const conn of connections.values()) {
        conn.stopped = true;
        if (conn.timer !== null) clearTimeout(conn.timer);
        if (conn.ws) {
          if (conn.ws.readyState === WebSocket.OPEN) {
            try { conn.ws.send(JSON.stringify({ lv: false })); } catch { /* connection already gone */ }
          }
          conn.ws.close();
        }
      }
      setPixels((prev) => {
        if (prev.size === 0) return prev;
        const next = new Map(prev);
        for (const host of uniqueHosts) next.delete(host);
        return next;
      });
    };
  }, [key]);

  return pixels;
}
