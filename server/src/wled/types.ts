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
}

export interface WledState {
  on: boolean;
  bri: number;
  ps: number;
  seg: WledSegment[];
}

export interface WledInfo {
  name: string;
  ver: string;
  leds: { count: number };
  arch: string;
}

export interface WledPreset {
  id: number;
  name: string;
}
