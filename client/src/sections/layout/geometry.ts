export interface Point { x: number; y: number }

/** screen = world * scale + (tx, ty) */
export interface Viewport { scale: number; tx: number; ty: number }

/** Axis-aligned rect in world coordinates. */
export interface Rect { x: number; y: number; w: number; h: number }

export const IDENTITY_VIEWPORT: Viewport = { scale: 1, tx: 0, ty: 0 };
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 40;
/** World units between grid lines (legacy world box is 0..100). */
export const GRID_SIZE = 2;
/** Screen-pixel hit slop; divide by viewport.scale to get world tolerance. */
export const HIT_TOLERANCE_PX = 6;

export function worldToScreen(vp: Viewport, p: Point): Point {
  return { x: p.x * vp.scale + vp.tx, y: p.y * vp.scale + vp.ty };
}

export function screenToWorld(vp: Viewport, p: Point): Point {
  return { x: (p.x - vp.tx) / vp.scale, y: (p.y - vp.ty) / vp.scale };
}

/** Zoom by `factor` keeping the world point under `screenPt` stationary. */
export function zoomAt(vp: Viewport, screenPt: Point, factor: number): Viewport {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, vp.scale * factor));
  const k = scale / vp.scale;
  return {
    scale,
    tx: screenPt.x - (screenPt.x - vp.tx) * k,
    ty: screenPt.y - (screenPt.y - vp.ty) * k
  };
}

export function panBy(vp: Viewport, dxScreen: number, dyScreen: number): Viewport {
  return { scale: vp.scale, tx: vp.tx + dxScreen, ty: vp.ty + dyScreen };
}

/** Constrain `p` to the nearest 45-degree ray from `anchor`, preserving distance. */
export function snapAngle(anchor: Point, p: Point): Point {
  const dx = p.x - anchor.x;
  const dy = p.y - anchor.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: anchor.x, y: anchor.y };
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: anchor.x + len * Math.cos(angle), y: anchor.y + len * Math.sin(angle) };
}

export function snapToGrid(p: Point, grid: number = GRID_SIZE): Point {
  return { x: Math.round(p.x / grid) * grid, y: Math.round(p.y / grid) * grid };
}

/** Max grid lines drawn per axis before the step doubles — keeps a
 *  far-zoomed-out view from rendering (and snapping to) thousands of lines. */
export const MAX_GRID_LINES_PER_AXIS = 150;

/**
 * The actual on-screen grid spacing for the given canvas size + viewport —
 * GRID_SIZE (2 world units) coarsened by doubling until the visible line
 * count fits MAX_GRID_LINES_PER_AXIS (see LayoutCanvas's computeGridLines,
 * which renders exactly this step). Snapping must use this same effective
 * step, not the raw GRID_SIZE constant: at typical canvas sizes and the
 * default 1:1 viewport, real strip coordinates span hundreds of world units
 * (they're built from screen pixels), so GRID_SIZE=2 alone coarsens the
 * *rendered* grid to something like every 16-64 units for legibility — but a
 * point snapped to a bare 2-unit grid almost never lands on one of those
 * visible intersections, making "Snap to grid" look like it does nothing.
 */
export function computeGridStep(
  canvasSize: { width: number; height: number },
  vp: Viewport
): number {
  const corner1 = screenToWorld(vp, { x: 0, y: 0 });
  const corner2 = screenToWorld(vp, { x: canvasSize.width, y: canvasSize.height });
  const spanX = Math.abs(corner2.x - corner1.x);
  const spanY = Math.abs(corner2.y - corner1.y);
  let step = GRID_SIZE;
  while (spanX / step > MAX_GRID_LINES_PER_AXIS || spanY / step > MAX_GRID_LINES_PER_AXIS) {
    step *= 2;
  }
  return step;
}

export function distToSegment(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}

export function hitTestPolyline(points: Point[], p: Point, tolerance: number): boolean {
  if (points.length === 0) return false;
  if (points.length === 1) return Math.hypot(p.x - points[0].x, p.y - points[0].y) <= tolerance;
  for (let i = 0; i < points.length - 1; i++) {
    if (distToSegment(p, points[i], points[i + 1]) <= tolerance) return true;
  }
  return false;
}

export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y)
  };
}

function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

function orient(a: Point, b: Point, c: Point): number {
  return Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
}

function onSegment(p: Point, q: Point, r: Point): boolean {
  return (
    orient(p, q, r) === 0 &&
    r.x >= Math.min(p.x, q.x) && r.x <= Math.max(p.x, q.x) &&
    r.y >= Math.min(p.y, q.y) && r.y <= Math.max(p.y, q.y)
  );
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

/** Marquee test: any vertex inside the rect, or any polyline segment crossing a rect edge. */
export function polylineIntersectsRect(points: Point[], rect: Rect): boolean {
  if (points.some((p) => pointInRect(p, rect))) return true;
  const corners: Point[] = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h }
  ];
  for (let i = 0; i < points.length - 1; i++) {
    for (let j = 0; j < 4; j++) {
      if (segmentsIntersect(points[i], points[i + 1], corners[j], corners[(j + 1) % 4])) return true;
    }
  }
  return false;
}

/** Viewport that fits the bounds of `points` (min 1x1) into viewW x viewH, centered, clamped to scale limits. */
export function fitAllViewport(points: Point[], viewW: number, viewH: number, paddingPx = 24): Viewport {
  const pts = points.length > 0 ? points : [{ x: 0, y: 0 }, { x: 100, y: 100 }];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const w = Math.max(maxX - minX, 1);
  const h = Math.max(maxY - minY, 1);
  const raw = Math.min((viewW - 2 * paddingPx) / w, (viewH - 2 * paddingPx) / h);
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, raw));
  return {
    scale,
    tx: (viewW - w * scale) / 2 - minX * scale,
    ty: (viewH - h * scale) / 2 - minY * scale
  };
}
