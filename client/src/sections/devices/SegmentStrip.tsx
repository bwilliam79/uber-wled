import { useRef, useState } from 'react';
import type { DeviceSegment } from '../../api/client';
import { sortedByStart, clampBoundary, canSplitSegment, splitMidpoint } from './segmentLogic';

interface SegmentStripProps {
  segments: DeviceSegment[];
  ledCount: number;
  busy: boolean;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onSplit: (segId: number, boundary: number) => void;
  onMerge: (leftId: number, rightId: number) => void;
  onBoundary: (leftId: number, rightId: number, boundary: number) => void;
}

/** A segment's first color slot, or null when it has none set (→ accent fill). */
function segColorSlot(seg: DeviceSegment): number[] | null {
  const c = seg.col?.[0];
  return c && (c[0] || c[1] || c[2]) ? c : null;
}

function segColor(seg: DeviceSegment): string {
  const c = segColorSlot(seg);
  return c ? `rgb(${c[0]}, ${c[1]}, ${c[2]})` : 'var(--accent)';
}

/** Dark label on a light zone, white on a dark one (accent counts as light). */
function labelColor(seg: DeviceSegment): string {
  const c = segColorSlot(seg);
  if (!c) return '#04140f';
  const lum = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
  return lum > 0.6 ? '#04140f' : '#ffffff';
}

export function SegmentStrip({
  segments, ledCount, busy, selectedId, onSelect, onSplit, onMerge, onBoundary
}: SegmentStripProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<{ leftId: number; rightId: number; boundary: number } | null>(null);
  const ordered = sortedByStart(segments);
  const span = Math.max(ledCount, 1);
  const pct = (led: number) => `${(led / span) * 100}%`;

  function boundaryFromEvent(clientX: number, leftStart: number, rightStop: number): number {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return leftStart + 1;
    const led = ((clientX - rect.left) / rect.width) * span;
    return clampBoundary(led, leftStart, rightStop);
  }

  return (
    <div className="segment-strip">
      <div className="segment-strip-track" ref={trackRef} data-testid="segment-strip">
        {ordered.map((seg) => {
          // While dragging a shared boundary, show the two affected zones
          // resizing live without committing to the device.
          let start = seg.start;
          let stop = seg.stop;
          if (drag) {
            if (seg.id === drag.leftId) stop = drag.boundary;
            if (seg.id === drag.rightId) start = drag.boundary;
          }
          return (
            <button
              key={seg.id}
              type="button"
              className={`segment-zone${selectedId === seg.id ? ' selected' : ''}${seg.on ? '' : ' off'}`}
              style={{ left: pct(start), width: pct(stop - start), background: segColor(seg), color: labelColor(seg) }}
              onClick={() => onSelect(seg.id)}
              aria-label={`Segment ${seg.id}, LEDs ${start} to ${stop}`}
              aria-pressed={selectedId === seg.id}
            >
              <span className="segment-zone-label">{seg.n || `Seg ${seg.id}`}</span>
            </button>
          );
        })}

        {/* Draggable handles on contiguous boundaries (left.stop === right.start). */}
        {ordered.map((left, i) => {
          const right = ordered[i + 1];
          if (!right || left.stop !== right.start) return null;
          const boundary = drag && drag.leftId === left.id ? drag.boundary : left.stop;
          return (
            <div
              key={`handle-${left.id}-${right.id}`}
              className="segment-handle"
              style={{ left: pct(boundary) }}
              role="slider"
              tabIndex={0}
              aria-label={`Boundary between segment ${left.id} and ${right.id}`}
              aria-valuemin={left.start + 1}
              aria-valuemax={right.stop - 1}
              aria-valuenow={boundary}
              onPointerDown={(e) => {
                if (busy) return;
                e.preventDefault();
                (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                setDrag({ leftId: left.id, rightId: right.id, boundary: left.stop });
              }}
              onPointerMove={(e) => {
                setDrag((d) =>
                  d && d.leftId === left.id
                    ? { ...d, boundary: boundaryFromEvent(e.clientX, left.start, right.stop) }
                    : d
                );
              }}
              onPointerUp={(e) => {
                (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
                setDrag((d) => {
                  if (d && d.leftId === left.id && d.boundary !== left.stop) {
                    onBoundary(left.id, right.id, d.boundary);
                  }
                  return null;
                });
              }}
            />
          );
        })}
      </div>

      <div className="segment-strip-actions">
        {selectedId !== null ? (
          (() => {
            const sel = ordered.find((s) => s.id === selectedId);
            if (!sel) return null;
            const idx = ordered.findIndex((s) => s.id === selectedId);
            const next = ordered[idx + 1];
            return (
              <>
                <span className="segment-strip-sel ui-mono">
                  Seg {sel.id} · {sel.start}–{sel.stop}
                </span>
                <button
                  type="button"
                  className="ui-btn ui-btn-secondary ui-btn-sm"
                  disabled={busy || !canSplitSegment(sel)}
                  onClick={() => onSplit(sel.id, splitMidpoint(sel))}
                >
                  Split
                </button>
                <button
                  type="button"
                  className="ui-btn ui-btn-secondary ui-btn-sm"
                  disabled={busy || !next}
                  onClick={() => next && onMerge(sel.id, next.id)}
                >
                  Merge →
                </button>
              </>
            );
          })()
        ) : (
          <span className="segment-strip-hint">Tap a zone to split or merge · drag a boundary to resize</span>
        )}
      </div>
    </div>
  );
}
