export interface WledNightlight {
  on: boolean;
  dur: number;
  mode: 0 | 1 | 2 | 3;
  tbri: number;
  rem?: number;
}

export interface WledUdpn {
  send?: boolean;
  recv?: boolean;
  sgrp?: number;
  rgrp?: number;
  /** Per-request "no notify": suppresses UDP sync echo for this one write. */
  nn?: boolean;
}

export interface WledSegment {
  id: number;
  start: number;
  stop: number;
  len: number;
  on: boolean;
  bri: number;
  fx: number;
  pal: number;
  col: number[][];
  // Full per-segment field set (spec "verified device facts"). Optional:
  // older firmware or partial state responses may omit any of them.
  grp?: number;
  spc?: number;
  of?: number;
  frz?: boolean;
  cct?: number;
  set?: number;
  n?: string;
  sx?: number;
  ix?: number;
  c1?: number;
  c2?: number;
  c3?: number;
  sel?: boolean;
  rev?: boolean;
  mi?: boolean;
  o1?: boolean;
  o2?: boolean;
  o3?: boolean;
  /** Light-capabilities bitmask in state responses: 1=RGB, 2=white, 4=CCT. */
  lc?: number;
}

export interface WledState {
  on: boolean;
  bri: number;
  ps: number;
  seg: WledSegment[];
  transition?: number;
  pl?: number;
  nl?: WledNightlight;
  udpn?: WledUdpn;
  lor?: 0 | 1 | 2;
  mainseg?: number;
}

/** Partial segment for writes: any subset of segment fields (plus id). */
export type WledSegmentPatch = Partial<WledSegment>;

/** Body accepted by POST /json/state (the fields uber-wled writes). */
export interface WledStatePatch {
  on?: boolean;
  bri?: number;
  transition?: number;
  /** Apply device preset id — Phase B's ControlPatch.ps lands here. */
  ps?: number;
  pl?: number;
  nl?: Partial<WledNightlight>;
  udpn?: WledUdpn;
  lor?: 0 | 1 | 2;
  mainseg?: number;
  seg?: WledSegmentPatch[];
}

export interface WledInfo {
  name: string;
  ver: string;
  leds: {
    count: number;
    rgbw?: boolean;
    cct?: number;
    maxseg?: number;
    fps?: number;
    pwr?: number;
    seglc?: number[];
    lc?: number;
  };
  arch: string;
  /** Build id (e.g. 2605030 on WLED 16.0.0) — drives capability-cache refresh. */
  vid?: number;
  /** True while the device is being driven by realtime data (E1.31/DDP/UDP,
   *  e.g. HyperHDR ambilight) — app writes are overwritten frame-by-frame.
   *  `lip` is the source IP, `lm` the source/protocol label. */
  live?: boolean;
  lip?: string;
  lm?: string;
}

export interface WledPreset {
  id: number;
  name: string;
}

/** GET /json — the combined object. */
export interface WledFullState {
  state: WledState;
  info: WledInfo;
  effects: string[];
  palettes: string[];
}
