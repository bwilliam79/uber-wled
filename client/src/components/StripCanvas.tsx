import { useRef, useState } from 'react';
import type { Strip } from '../api/client';

interface Box { x0: number; y0: number; x1: number; y1: number; }

export interface StripCanvasProps {
  strips: Strip[];
  selected: Set<string>;
  staleControllerIds: Set<string>;
  onSelectionChange: (next: Set<string>) => void;
  onMoveStrip?: (id: string, dx: number, dy: number) => void;
  liveColors?: Map<string, string>;
  children?: React.ReactNode;
}

function toCanvas(e: { clientX: number; clientY: number }, svg: SVGSVGElement) {
  const rect = svg.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) / rect.width) * 100,
    y: ((e.clientY - rect.top) / rect.height) * 100
  };
}

export function StripCanvas({ strips, selected, staleControllerIds, onSelectionChange, liveColors, children }: StripCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [marquee, setMarquee] = useState<Box | null>(null);

  function handleBackgroundDown(e: React.MouseEvent<SVGRectElement>) {
    if (!svgRef.current) return;
    const p = toCanvas(e, svgRef.current);
    setMarquee({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  }

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!marquee || !svgRef.current) return;
    const p = toCanvas(e, svgRef.current);
    setMarquee((m) => (m ? { ...m, x1: p.x, y1: p.y } : m));
  }

  function handleUp() {
    if (!marquee) return;
    const minX = Math.min(marquee.x0, marquee.x1);
    const maxX = Math.max(marquee.x0, marquee.x1);
    const minY = Math.min(marquee.y0, marquee.y1);
    const maxY = Math.max(marquee.y0, marquee.y1);
    const next = new Set<string>();
    for (const s of strips) {
      if (s.points.some((pt) => pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY)) next.add(s.id);
    }
    // A zero-area marquee (a plain click on empty canvas) clears the selection.
    onSelectionChange(next);
    setMarquee(null);
  }

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 100 100"
      className="strip-canvas"
      preserveAspectRatio="none"
      onMouseMove={handleMove}
      onMouseUp={handleUp}
      onMouseLeave={() => setMarquee(null)}
    >
      <rect data-testid="canvas-bg" x={0} y={0} width={100} height={100} fill="transparent" onMouseDown={handleBackgroundDown} />
      {strips.map((s) => {
        const isSelected = selected.has(s.id);
        const isStale = staleControllerIds.has(s.controllerId);
        const liveColor = liveColors?.get(s.id);
        const stroke = isStale ? '#475569' : (liveColor ?? (isSelected ? '#ff5ec8' : '#22c55e'));
        return (
          <polyline
            key={s.id}
            data-testid={`strip-${s.id}`}
            data-selected={isSelected ? 'true' : 'false'}
            data-stale={isStale ? 'true' : 'false'}
            className={`strip${isSelected ? ' selected' : ''}${isStale ? ' stale' : ''}`}
            points={s.points.map((pt) => `${pt.x},${pt.y}`).join(' ')}
            style={{ stroke }}
            fill="none"
            onClick={(e) => {
              e.stopPropagation();
              onSelectionChange(new Set([s.id]));
            }}
          />
        );
      })}
      {marquee && (
        <rect
          data-testid="marquee"
          className="strip-marquee"
          x={Math.min(marquee.x0, marquee.x1)}
          y={Math.min(marquee.y0, marquee.y1)}
          width={Math.abs(marquee.x1 - marquee.x0)}
          height={Math.abs(marquee.y1 - marquee.y0)}
        />
      )}
      {children}
    </svg>
  );
}
