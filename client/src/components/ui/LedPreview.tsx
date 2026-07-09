import { useEffect, useRef } from 'react';
import { registerCanvas, unregisterCanvas, paintCanvas, type LedEffect } from '../../lib/ledRenderer';

export interface LedPreviewProps {
  /** Effect name understood by the renderer (see LedEffect). */
  effect: LedEffect | string;
  /** Comma-separated hex colors, e.g. "#ff0000,#ffffff". */
  colors: string;
  /** Number of dots to draw. */
  count?: number;
  /** Animation speed factor. */
  speed?: number;
  className?: string;
  ariaLabel?: string;
}

/**
 * A canvas that animates a WLED-style effect as a row of glowing dots — the
 * design's live LED preview. Registers with the shared renderer loop (one rAF
 * paints all previews); the loop reads the canvas's data-* attributes each
 * frame, so prop changes take effect immediately.
 */
export function LedPreview({
  effect,
  colors,
  count = 40,
  speed = 1,
  className,
  ariaLabel = 'effect preview'
}: LedPreviewProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    registerCanvas(canvas);
    return () => unregisterCanvas(canvas);
  }, []);

  // Keep the static frame (reduced-motion / no-canvas) in sync with params.
  useEffect(() => {
    if (ref.current) {
      try {
        paintCanvas(ref.current, 0);
      } catch {
        /* ignore */
      }
    }
  }, [effect, colors, count, speed]);

  return (
    <canvas
      ref={ref}
      className={className}
      role="img"
      aria-label={ariaLabel}
      data-strip={effect}
      data-count={count}
      data-colors={colors}
      data-speed={speed}
    />
  );
}
