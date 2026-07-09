// Animated LED preview renderer — a faithful port of the design prototype's
// canvas engine (design/Uber-WLED Prototype.dc.html). Draws an effect as a row
// of glowing dots. A single shared requestAnimationFrame loop paints every
// registered canvas (like the prototype), so many previews cost one rAF.
//
// Each canvas carries its parameters in data-* attributes:
//   data-strip  = effect name (LedEffect)
//   data-count  = LED count
//   data-colors = comma-separated hex colors
//   data-speed  = speed factor

export type LedEffect =
  | 'rainbow' | 'gradient' | 'comet' | 'wave' | 'breathe'
  | 'chase' | 'sparkle' | 'fire' | 'solid' | 'bands';

export const LED_EFFECTS: LedEffect[] = [
  'rainbow', 'gradient', 'comet', 'wave', 'breathe', 'chase', 'sparkle', 'fire', 'solid', 'bands'
];

/** Effects with no time term — a preview of these should paint once, not animate. */
export function isStaticEffect(fx: string): boolean {
  return fx === 'solid' || fx === 'bands';
}

type RGB = [number, number, number];

export function hexToRgb(h: string): RGB {
  h = (h || '').trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (isNaN(n)) return [255, 255, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hsl(h: number, s: number, l: number): RGB {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [255 * f(0), 255 * f(8), 255 * f(4)];
}

const frac = (x: number) => x - Math.floor(x);
const rand = (i: number, seed: number) => frac(Math.sin((i + 1) * (12.9898 + seed * 0.017) + seed) * 43758.5453);
const lerp = (a: RGB, b: RGB, f: number): RGB => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];

function pal(rgbs: RGB[], p: number): RGB {
  const n = rgbs.length;
  if (n === 1) return rgbs[0];
  const seg = (((p % 1) + 1) % 1) * n;
  const i0 = Math.floor(seg) % n;
  const i1 = (i0 + 1) % n;
  return lerp(rgbs[i0], rgbs[i1], seg - Math.floor(seg));
}

/** Per-LED color + brightness for an effect (verbatim algorithms from the prototype). */
export function led(fx: string, i: number, count: number, t: number, rgbs: RGB[], sp: number): { c: RGB; b: number } {
  switch (fx) {
    case 'rainbow':
      return { c: hsl(((((i / count) * 360 + t * sp * 70) % 360) + 360) % 360, 85, 56), b: 1 };
    case 'gradient':
      return { c: pal(rgbs, i / count + t * sp * 0.12), b: 1 };
    case 'comet': {
      let d = ((t * sp * 0.55 * (count + 22)) % (count + 22)) - i;
      if (d < 0) d += count + 22;
      return { c: rgbs[0], b: d < 15 ? Math.pow(1 - d / 15, 1.7) : 0 };
    }
    case 'wave':
      return { c: rgbs[0], b: 0.14 + 0.86 * (0.5 + 0.5 * Math.sin(i * 0.36 - t * sp * 3)) };
    case 'breathe':
      return { c: rgbs[0], b: 0.18 + 0.82 * (0.5 + 0.5 * Math.sin(t * sp * 1.7)) };
    case 'chase': {
      const on = (i + Math.floor(t * sp * 6)) % 3 === 0;
      return { c: rgbs[i % rgbs.length], b: on ? 1 : 0.08 };
    }
    case 'sparkle': {
      const r = rand(i, Math.floor(t * sp * 8));
      return { c: rgbs[i % rgbs.length], b: r > 0.82 ? Math.min(1, 0.4 + (r - 0.82) * 3.3) : 0.05 };
    }
    case 'fire': {
      const fl = rand(i, Math.floor(t * sp * 11));
      const heat = Math.max(0, Math.min(1, 0.35 + 0.65 * fl * (0.55 + 0.45 * Math.sin(t * sp * 3 + i * 0.7))));
      return { c: hsl(8 + heat * 38, 100, 22 + heat * 34), b: 0.45 + 0.55 * heat };
    }
    case 'solid':
      return { c: rgbs[0], b: 1 };
    case 'bands': {
      // Static discrete color blocks (e.g. Solid Pattern Tri = 3 solid bands),
      // NOT an interpolated gradient — no time term.
      const nb = rgbs.length;
      const idx = Math.min(nb - 1, Math.floor((i / count) * nb));
      return { c: rgbs[idx], b: 1 };
    }
    default:
      return { c: rgbs[0] || [255, 255, 255], b: 1 };
  }
}

function dot(ctx: CanvasRenderingContext2D, x: number, cy: number, r: number, c: RGB, b: number): void {
  ctx.beginPath();
  ctx.arc(x, cy, r, 0, 6.2832);
  ctx.fillStyle = `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0.05, b)})`;
  ctx.shadowBlur = r * 2.4 * b;
  ctx.shadowColor = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
  ctx.fill();
}

/** Paint one canvas from its data-* attributes at time t (seconds). */
export function paintCanvas(canvas: HTMLCanvasElement, t: number): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const fx = canvas.dataset.strip || 'solid';

  // Segmented mode: one strip, each zone running its own effect. Zones come in
  // as JSON on data-zones: [{ start, end, effect, colors, bri (0-100), on }].
  if (fx === 'segmented') {
    const total = parseInt(canvas.dataset.count || '1', 10);
    let zones: Array<{ start: number; end: number; effect: string; colors: string; bri: number; on: boolean }> = [];
    try {
      zones = JSON.parse(canvas.dataset.zones || '[]');
    } catch {
      zones = [];
    }
    const gap = w / total;
    const r = Math.min(gap * 0.36, h * 0.3);
    const cy = h / 2;
    for (let i = 0; i < total; i++) {
      const z = zones.find((s) => i >= s.start && i < s.end);
      let c: RGB = [46, 46, 54];
      let b = 0.1;
      if (z && z.on) {
        const rgbs = (z.colors || '#2ee6c0').split(',').map((s) => hexToRgb(s));
        const o = led(z.effect, i - z.start, Math.max(1, z.end - z.start), t, rgbs, 1);
        c = o.c;
        b = o.b * (z.bri / 100);
      }
      dot(ctx, gap * (i + 0.5), cy, r, c, Math.max(0, Math.min(1, b)));
    }
    ctx.shadowBlur = 0;
    return;
  }

  const count = parseInt(canvas.dataset.count || '48', 10);
  const sp = parseFloat(canvas.dataset.speed || '1') || 1;
  const rgbs = (canvas.dataset.colors || '#2ee6c0').split(',').map((s) => hexToRgb(s));
  const gap = w / count;
  const r = Math.min(gap * 0.34, h * 0.36);
  const cy = h / 2;
  for (let i = 0; i < count; i++) {
    const o = led(fx, i, count, t, rgbs, sp);
    dot(ctx, gap * (i + 0.5), cy, r, o.c, Math.max(0, Math.min(1, o.b)));
  }
  ctx.shadowBlur = 0;
}

// ---- Shared animation loop: one rAF paints every registered canvas ----

const canvases = new Set<HTMLCanvasElement>();
let rafId = 0;
let t0 = 0;
let lastFrame = 0;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

// Canvas support is probed once. jsdom (tests) returns null for getContext, so
// animation is disabled there and the shared rAF loop never spins.
let canvasSupported: boolean | null = null;
function supportsCanvas(): boolean {
  if (canvasSupported === null) {
    try {
      canvasSupported = !!document.createElement('canvas').getContext('2d');
    } catch {
      canvasSupported = false;
    }
  }
  return canvasSupported;
}

function loop(now: number): void {
  rafId = requestAnimationFrame(loop);
  if (now - lastFrame < 33) return; // ~30fps
  lastFrame = now;
  const t = (now - t0) / 1000;
  canvases.forEach((c) => {
    try {
      paintCanvas(c, t);
    } catch {
      /* a detached/zero-size canvas — skip this frame */
    }
  });
}

export function registerCanvas(canvas: HTMLCanvasElement): void {
  canvases.add(canvas);
  // Reduced motion / no canvas support (tests): paint a single static frame,
  // don't animate.
  if (!supportsCanvas() || prefersReducedMotion() || typeof requestAnimationFrame === 'undefined') {
    try {
      paintCanvas(canvas, 0);
    } catch {
      /* ignore */
    }
    return;
  }
  if (rafId === 0) {
    t0 = performance.now();
    lastFrame = 0;
    rafId = requestAnimationFrame(loop);
  }
}

export function unregisterCanvas(canvas: HTMLCanvasElement): void {
  canvases.delete(canvas);
  if (canvases.size === 0 && rafId !== 0) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
}
