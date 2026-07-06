import type { RefObject } from 'react';
import type { RoomLabel, Strip } from '../../api/client';
import { GRID_SIZE, HIT_TOLERANCE_PX, type Point, type Rect, type Viewport } from './geometry';
import { stripStrokeColor, type LiveControllerStatus } from './stripColors';
import { RoomLabels } from './RoomLabels';

/** Legacy world box: existing strip data lives in 0..100. */
const WORLD_BOX = 100;

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
        {props.gridSnap && (
          <g data-testid="layout-grid" className="layout-grid">
            {Array.from({ length: WORLD_BOX / GRID_SIZE + 1 }, (_, idx) => {
              const c = idx * GRID_SIZE;
              const lineClass = `layout-grid-line${idx % 4 === 0 ? ' layout-grid-line-major' : ''}`;
              return (
                <g key={c}>
                  <line className={lineClass} x1={c} y1={0} x2={c} y2={WORLD_BOX} vectorEffect="non-scaling-stroke" />
                  <line className={lineClass} x1={0} y1={c} x2={WORLD_BOX} y2={c} vectorEffect="non-scaling-stroke" />
                </g>
              );
            })}
          </g>
        )}
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
