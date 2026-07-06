/**
 * Real cfg.json payloads captured read-only from production uber-wled
 * (GET http://media-server:8081/api/controllers/<id>/config, which itself
 * proxies GET http://<device-ip>/json/cfg) on 2026-07-06. Sanitized: WLED's
 * cfg GET never includes plaintext passwords, only `pskl` (password length),
 * so nothing was stripped.
 *
 * Three representative shapes, chosen to cover the encodings the structured
 * config forms must round-trip:
 *
 * - cabinet-lights: RGBW (SK6812/WS2814, type 30), TWO hw.led.ins outputs,
 *   order 34 (0x22 = BRG + "W & G" white swap), relay + audio-reactive usermod.
 * - desk-lights: an OLDER firmware build (vid 2605010 vs 2605030 elsewhere) —
 *   missing nw.espnow/linked_remote and if.va/if.mqtt/if.hue entirely, ap.pskl
 *   0 (no AP password set), a single TYPE_ANALOG_5CH (45) PWM output driven
 *   over 5 GPIO pins with order 1 (RGB, no white swap) and a nonzero `freq`.
 * - tv-lights: plain RGB (order 0, per-output rgbwm 0 = no auto-white) on the
 *   same SK6812 bus type, with a nonzero per-output AND global `maxpwr`
 *   (5000) to prove those two are bound independently.
 */
import cabinetLightsRaw from './cabinet-lights.json';
import deskLightsRaw from './desk-lights.json';
import tvLightsRaw from './tv-lights.json';

export type RawCfg = Record<string, any>;

/** Deep copy so tests can mutate freely without cross-test bleed. */
export function cabinetLightsCfg(): RawCfg {
  return structuredClone(cabinetLightsRaw) as RawCfg;
}

export function deskLightsCfg(): RawCfg {
  return structuredClone(deskLightsRaw) as RawCfg;
}

export function tvLightsCfg(): RawCfg {
  return structuredClone(tvLightsRaw) as RawCfg;
}

export interface RealConfigCase {
  name: string;
  cfg: () => RawCfg;
}

/** Every captured real config, for fixture-driven "render + assert real values" tests. */
export const REAL_CONFIGS: RealConfigCase[] = [
  { name: 'cabinet-lights', cfg: cabinetLightsCfg },
  { name: 'desk-lights', cfg: deskLightsCfg },
  { name: 'tv-lights', cfg: tvLightsCfg }
];
