import { useEffect, useRef } from 'react';
import { registerCanvas, unregisterCanvas, paintCanvas, isStaticEffect, type LedEffect } from '../../lib/ledRenderer';

export interface LedPreviewProps {
  /** Effect name understood by the renderer (see LedEffect). */
  effect: LedEffect | string;
  /** Comma-separated hex colors, e.g. "#ff0000,#ffffff". */
  colors: string;
  /** Number of dots to draw. */
  count?: number;
  /** Animation speed factor. */
  speed?: number;
  /** WLED effect intensity (0–255); drives density-type effects. */
  intensity?: number;
  /** For effect="segmented": JSON of zones [{start,end,effect,colors,bri,on}]. */
  zones?: string;
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
  intensity = 128,
  zones,
  className,
  ariaLabel = 'effect preview'
}: LedPreviewProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  // Only animated effects join the shared rAF loop; static ones (solid/bands)
  // paint a single frame (see the effect below) and never re-paint.
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || isStaticEffect(effect)) return;
    registerCanvas(canvas);
    return () => unregisterCanvas(canvas);
  }, [effect]);

  // Keep the static frame (reduced-motion / no-canvas) in sync with params.
  useEffect(() => {
    if (ref.current) {
      try {
        paintCanvas(ref.current, 0);
      } catch {
        /* ignore */
      }
    }
  }, [effect, colors, count, speed, intensity, zones]);

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
      data-intensity={intensity}
      data-zones={zones}
    />
  );
}
