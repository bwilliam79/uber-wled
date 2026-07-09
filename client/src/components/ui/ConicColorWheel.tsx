import { useRef } from 'react';

/** HSL (h 0–360, s/l 0–100) → RGB 0–255. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))];
}

export interface ConicColorWheelProps {
  /** Current color as a CSS color string (shown in the center). */
  colorHex: string;
  /** Called with a full-saturation RGB for the picked hue. */
  onPick: (rgb: [number, number, number]) => void;
  size?: number;
}

/**
 * The design's conic hue wheel: click/drag around the ring to pick a hue; the
 * center shows the current color + hex. Precise color (saturation/white/CCT)
 * lives in the Advanced controls. Pure CSS — no canvas/SVG sizing races.
 */
export function ConicColorWheel({ colorHex, onPick, size = 200 }: ConicColorWheelProps) {
  const ref = useRef<HTMLDivElement>(null);

  function pickFrom(clientX: number, clientY: number) {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    // Angle with 0° at the top, increasing clockwise, to match the gradient.
    let deg = (Math.atan2(clientY - cy, clientX - cx) * 180) / Math.PI + 90;
    if (deg < 0) deg += 360;
    onPick(hslToRgb(deg, 100, 50));
  }

  return (
    <div
      ref={ref}
      className="cs-wheel"
      style={{ width: size, height: size }}
      role="slider"
      aria-label="Hue wheel"
      tabIndex={0}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        pickFrom(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1) pickFrom(e.clientX, e.clientY);
      }}
    >
      <div className="cs-wheel-center">
        <span className="cs-wheel-swatch" style={{ background: colorHex, color: colorHex }} />
        <span className="cs-wheel-hex ui-mono">{colorHex}</span>
      </div>
    </div>
  );
}
