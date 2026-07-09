import { useEffect, useState } from 'react';
import { rememberDeviceName } from '../lib/deviceNames';

export interface LiveNightlight { on: boolean; dur: number; mode: 0 | 1 | 2 | 3; tbri: number; rem: number }

export interface LiveSegment {
  id: number; start: number; stop: number; len?: number;
  on: boolean; bri: number; col: number[][];
  fx: number; sx: number; ix: number; pal: number;
  c1: number; c2: number; c3: number;
  o1: boolean; o2: boolean; o3: boolean;
  cct?: number; rev?: boolean; mi?: boolean; n?: string;
}

export interface LiveState {
  on: boolean; bri: number; transition: number; ps: number; pl: number;
  nl: LiveNightlight; mainseg: number; seg: LiveSegment[];
}

export interface LiveInfo {
  name: string; ver: string; vid?: number;
  leds: {
    count: number; rgbw: boolean; cct: number | boolean; seglc?: number[];
    fps?: number; pwr?: number; maxseg?: number;
  };
  wifi?: { bssid?: string; rssi?: number; signal: number; channel: number };
  fs?: { u: number; t: number };
  arch?: string; core?: string; mac?: string; ip?: string;
  uptime?: number; freeheap?: number;
  u?: Record<string, unknown>;
}

export interface LiveStatusEntry { reachable: boolean; state?: LiveState; info?: LiveInfo }

interface StatusEvent { controllerId: string; reachable: boolean; state?: LiveState; info?: LiveInfo }

const MAX_BACKOFF_MS = 30_000;

export function useLiveStatus(controllerIds: string[]): Map<string, LiveStatusEntry> {
  const [statuses, setStatuses] = useState<Map<string, LiveStatusEntry>>(new Map());
  const key = [...controllerIds].sort().join(',');

  useEffect(() => {
    setStatuses(new Map());
    if (key === '') return;

    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      source = new EventSource(`/api/live?controllers=${key}`);
      source.addEventListener('status', (ev) => {
        attempts = 0;
        const data = JSON.parse((ev as MessageEvent).data) as StatusEvent;
        // Cache the friendly device name so name-showing pages render it
        // immediately next time instead of flashing the stored mDNS name.
        rememberDeviceName(data.controllerId, data.info?.name);
        setStatuses((prev) => {
          const next = new Map(prev);
          const existing = next.get(data.controllerId);
          next.set(data.controllerId, {
            reachable: data.reachable,
            state: data.state ?? existing?.state,
            info: data.info ?? existing?.info
          });
          return next;
        });
      });
      source.onerror = () => {
        source?.close();
        attempts += 1;
        const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(attempts, 5));
        timer = setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      source?.close();
    };
  }, [key]);

  return statuses;
}
