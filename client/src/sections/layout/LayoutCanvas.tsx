import { useEffect, useState, type RefObject } from 'react';
import type { RoomLabel, Strip } from '../../api/client';
import { HIT_TOLERANCE_PX, computeGridStep, screenToWorld, type Point, type Rect, type Viewport } from './geometry';
import { stripStrokeColor, type LiveControllerStatus } from './stripColors';
import { RoomLabels } from './RoomLabels';

/** Tracks an element's CSS pixel size (0,0 until the ref mounts). */
export function useElementSize(ref: RefObject<Element | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

export interface GridLine { pos: number; major: boolean }

/** World-space coordinates of every grid line that should be visible for the
 *  given canvas size + viewport — was previously a hardcoded 0..100 box that
 *  had nothing to do with where strips actually are (real strip coordinates
 *  match screen pixels at the default scale:1 viewport, i.e. commonly in the
 *  hundreds), which made the grid render as a tiny corner square instead of
 *  covering the visible canvas. Major lines land on absolute multiples of the
 *  step so alignment stays stable as the user pans, not just relative to
 *  whatever's currently in view. Exported for direct unit testing.
 *
 *  Uses the SAME effective step as computeGridStep (geometry.ts), which is
 *  also what actual point-snapping uses — the visible grid and the snap
 *  target must always agree, or "Snap to grid" silently snaps to a grid
 *  finer than what's drawn and never lands on a visible intersection. */
export function computeGridLines(
  canvasSize: { width: number; height: number },
  vp: Viewport
): { vertical: GridLine[]; horizontal: GridLine[] } {
  const corner1 = screenToWorld(vp, { x: 0, y: 0 });
  const corner2 = screenToWorld(vp, { x: canvasSize.width, y: canvasSize.height });
  const minXRaw = Math.min(corner1.x, corner2.x);
  const maxXRaw = Math.max(corner1.x, corner2.x);
  const minYRaw = Math.min(corner1.y, corner2.y);
  const maxYRaw = Math.max(corner1.y, corner2.y);

  const step = computeGridStep(canvasSize, vp);
  const majorStep = step * 4;

  const build = (minRaw: number, maxRaw: number): GridLine[] => {
    const min = Math.floor(minRaw / step) * step;
    const max = Math.ceil(maxRaw / step) * step;
    const lines: GridLine[] = [];
    for (let pos = min; pos <= max; pos += step) {
      lines.push({ pos, major: pos % majorStep === 0 });
    }
    return lines;
  };

  return { vertical: build(minXRaw, maxXRaw), horizontal: build(minYRaw, maxYRaw) };
}

export interface LayoutCanvasProps {
  strips: Strip[];
  labels: RoomLabel[];
  live: Map<string, LiveControllerStatus>;
  selection: string[];
  viewport: Viewport;
  gridSnap: boolean;
  /** Non-null while in draw mode (may be empty before the first click). */
  drawVertices: Point[] | null;
  /** Rubber-band endpoint, already snapped by the container. */
  drawCursor: Point | null;
  /** Marquee rect in world coordinates, or null. */
  marqueeRect: Rect | null;
  svgRef: RefObject<SVGSVGElement | null>;
  toWorld(clientX: number, clientY: number): Point;
  onStripPointerDown(stripId: string, e: React.PointerEvent): void;
  onVertexPointerDown(stripId: string, vertexIndex: number, e: React.PointerEvent): void;
  onBackgroundPointerDown(e: React.PointerEvent): void;
  onPointerMove(e: React.PointerEvent): void;
  onPointerUp(e: React.PointerEvent): void;
  onCanvasClick(e: React.MouseEvent): void;
  onCanvasDoubleClick(e: React.MouseEvent): void;
  onMoveLabel(id: string, x: number, y: number): void;
  onRenameLabel(id: string, name: string): void;
  onDeleteLabel(id: string): void;
}

export function LayoutCanvas(props: LayoutCanvasProps) {
  const vp = props.viewport;
  const canvasSize = useElementSize(props.svgRef);
  const drawing = props.drawVertices !== null;
  const lastDrawVertex =
    props.drawVertices && props.drawVertices.length > 0
      ? props.drawVertices[props.drawVertices.length - 1]
      : null;

  return (
    <svg
      ref={props.svgRef}
      data-testid="layout-canvas"
      className="layout-canvas"
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onPointerLeave={props.onPointerUp}
      onClick={props.onCanvasClick}
      onDoubleClick={props.onCanvasDoubleClick}
    >
      <defs>
        <filter id="strip-glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect
        data-testid="canvas-bg"
        x={0}
        y={0}
        width="100%"
        height="100%"
        fill="transparent"
        onPointerDown={props.onBackgroundPointerDown}
      />
      <g data-testid="world-group" transform={`translate(${vp.tx} ${vp.ty}) scale(${vp.scale})`}>
        {props.gridSnap && canvasSize.width > 0 && canvasSize.height > 0 && (() => {
          const { vertical, horizontal } = computeGridLines(canvasSize, vp);
          const minY = horizontal.length > 0 ? horizontal[0].pos : 0;
          const maxY = horizontal.length > 0 ? horizontal[horizontal.length - 1].pos : 0;
          const minX = vertical.length > 0 ? vertical[0].pos : 0;
          const maxX = vertical.length > 0 ? vertical[vertical.length - 1].pos : 0;
          return (
            <g data-testid="layout-grid" className="layout-grid">
              {vertical.map(({ pos, major }) => (
                <line key={`v${pos}`}
                  className={`layout-grid-line${major ? ' layout-grid-line-major' : ''}`}
                  x1={pos} y1={minY} x2={pos} y2={maxY} vectorEffect="non-scaling-stroke" />
              ))}
              {horizontal.map(({ pos, major }) => (
                <line key={`h${pos}`}
                  className={`layout-grid-line${major ? ' layout-grid-line-major' : ''}`}
                  x1={minX} y1={pos} x2={maxX} y2={pos} vectorEffect="non-scaling-stroke" />
              ))}
            </g>
          );
        })()}
        {props.strips.map((s) => {
          const isSelected = props.selection.includes(s.id);
          const stroke = stripStrokeColor(s, props.live);
          const pointsAttr = s.points.map((p) => `${p.x},${p.y}`).join(' ');
          return (
            <g key={s.id}>
              <polyline
                data-testid={`strip-${s.id}`}
                data-selected={isSelected ? 'true' : 'false'}
                className={`strip-line${isSelected ? ' selected' : ''}`}
                points={pointsAttr}
                fill="none"
                vectorEffect="non-scaling-stroke"
                style={{ stroke }}
                filter={isSelected ? 'url(#strip-glow)' : undefined}
                pointerEvents="none"
              />
              <polyline
                data-testid={`strip-hit-${s.id}`}
                className="strip-hit"
                points={pointsAttr}
                fill="none"
                stroke="transparent"
                strokeWidth={(HIT_TOLERANCE_PX * 2) / vp.scale}
                pointerEvents={drawing ? 'none' : 'stroke'}
                onPointerDown={(e) => props.onStripPointerDown(s.id, e)}
              />
              {isSelected &&
                s.points.map((p, i) => (
                  <circle
                    key={i}
                    data-testid={`vertex-${s.id}-${i}`}
                    className="vertex-handle"
                    cx={p.x}
                    cy={p.y}
                    r={5 / vp.scale}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      props.onVertexPointerDown(s.id, i, e);
                    }}
                  />
                ))}
            </g>
          );
        })}
        {props.drawVertices && (
          <g data-testid="draw-preview" className="draw-preview">
            <polyline
              data-testid="draw-line"
              className="draw-line"
              points={props.drawVertices.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              vectorEffect="non-scaling-stroke"
            />
            {lastDrawVertex && props.drawCursor && (
              <line
                data-testid="draw-rubber"
                className="draw-rubber"
                x1={lastDrawVertex.x}
                y1={lastDrawVertex.y}
                x2={props.drawCursor.x}
                y2={props.drawCursor.y}
                vectorEffect="non-scaling-stroke"
              />
            )}
            {props.drawVertices.map((p, i) => (
              <circle key={i} className="draw-vertex" cx={p.x} cy={p.y} r={4 / vp.scale} />
            ))}
          </g>
        )}
        {props.marqueeRect && (
          <rect
            data-testid="marquee"
            className="marquee-rect"
            x={props.marqueeRect.x}
            y={props.marqueeRect.y}
            width={props.marqueeRect.w}
            height={props.marqueeRect.h}
            vectorEffect="non-scaling-stroke"
          />
        )}
        <RoomLabels
          labels={props.labels}
          toWorld={props.toWorld}
          onMove={props.onMoveLabel}
          onRename={props.onRenameLabel}
          onDelete={props.onDeleteLabel}
        />
      </g>
    </svg>
  );
}
