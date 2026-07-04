import { useState } from 'react';
import type { RoomLabel } from '../api/client';

export function RoomLabelLayer({
  labels,
  onMove
}: {
  labels: RoomLabel[];
  onMove: (id: string, x: number, y: number) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  function svgOf(target: EventTarget & Element): SVGSVGElement | null {
    return target.closest('svg');
  }

  function handleDown(e: React.MouseEvent<SVGTextElement>, id: string) {
    e.stopPropagation();
    setDragId(id);
  }

  function handleMove(e: React.MouseEvent<SVGGElement>) {
    if (!dragId) return;
    const svg = svgOf(e.currentTarget);
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    setPos({
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100
    });
  }

  function handleUp() {
    if (dragId && pos) onMove(dragId, pos.x, pos.y);
    setDragId(null);
    setPos(null);
  }

  return (
    <g className="room-label-layer" onMouseMove={handleMove} onMouseUp={handleUp}>
      {labels.map((l) => {
        const x = dragId === l.id && pos ? pos.x : l.x;
        const y = dragId === l.id && pos ? pos.y : l.y;
        return (
          <text
            key={l.id}
            data-testid={`room-label-${l.id}`}
            className="room-label"
            x={x}
            y={y}
            onMouseDown={(e) => handleDown(e, l.id)}
          >
            {l.name}
          </text>
        );
      })}
    </g>
  );
}
