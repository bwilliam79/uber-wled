import { useRef, useState } from 'react';
import type { DeviceSegment } from '../../api/client';
import type { LedEffect } from '../../lib/ledRenderer';
import { rgbToHex } from '../../lib/color';
import { LedPreview } from '../../components/ui/LedPreview';
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
  /** Maps a segment to the closest preview animation (via its effect name). */
  effectFor: (seg: DeviceSegment) => LedEffect;
}

/** A segment's non-black color slots as a comma hex string, defaulting to teal. */
function segColorsStr(seg: DeviceSegment): string {
  const hexes = (seg.col || [])
    .filter((c) => c && (c[0] || c[1] || c[2]))
    .map((c) => rgbToHex([c[0], c[1], c[2]]));
  return hexes.length > 0 ? hexes.join(',') : '#2ee6c0';
}

export function SegmentStrip({
  segments, ledCount, busy, selectedId, onSelect, onSplit, onMerge, onBoundary, effectFor
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

  // Zone geometry, applying a live drag to the two affected boundaries.
  const zones = ordered.map((seg) => {
    let start = seg.start;
    let stop = seg.stop;
    if (drag) {
      if (seg.id === drag.leftId) stop = drag.boundary;
      if (seg.id === drag.rightId) start = drag.boundary;
    }
    return { seg, start, stop };
  });

  const zonesJson = JSON.stringify(
    zones.map(({ seg, start, stop }) => ({
      start,
      end: stop,
      effect: effectFor(seg),
      colors: segColorsStr(seg),
      bri: Math.round((seg.bri / 255) * 100),
      on: seg.on
    }))
  );

  return (
    <div className="segment-strip">
      {/* Zone label chips hanging over the strip (click to select). */}
      <div className="segment-chips">
        {zones.map(({ seg, start, stop }) => (
          <button
            key={seg.id}
            type="button"
            className={`segment-chip${selectedId === seg.id ? ' selected' : ''}${seg.on ? '' : ' off'}`}
            style={{ left: pct(start), width: pct(stop - start) }}
            onClick={() => onSelect(seg.id)}
            aria-label={`Segment ${seg.id}, LEDs ${start} to ${stop}`}
            aria-pressed={selectedId === seg.id}
          >
            <span className="segment-chip-label">{seg.n || `Seg ${seg.id}`}</span>
          </button>
        ))}
      </div>

      {/* Animated segmented strip: each zone runs its own effect. */}
      <div className="segment-strip-track" ref={trackRef} data-testid="segment-strip">
        <LedPreview
          effect="segmented"
          colors="#2ee6c0"
          count={ledCount}
          zones={zonesJson}
          className="segment-strip-canvas"
          ariaLabel="Segment layout preview"
        />
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

      <div className="segment-scale ui-mono">
        <span>0</span>
        <span>{ledCount} px</span>
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
                <span className="segment-strip-sel ui-mono">Seg {sel.id} · {sel.start}–{sel.stop}</span>
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
