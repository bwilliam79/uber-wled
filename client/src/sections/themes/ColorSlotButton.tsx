import { useEffect, useRef, useState } from 'react';
import { ConicColorWheel } from '../../components/ui/ConicColorWheel';
import { hexToRgb, rgbToHex } from '../../lib/color';

export function ColorSlotButton({
  label,
  color,
  onChange
}: {
  label: string;
  color: string;
  onChange: (hex: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hexDraft, setHexDraft] = useState(color);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => setHexDraft(color), [color]);

  useEffect(() => {
    if (!open) return;
    function onDocPointerDown(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onDocPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const [wheelR, wheelG, wheelB] = hexToRgb(color) ?? [255, 255, 255];

  return (
    <div className="color-slot" ref={wrapRef}>
      <button
        type="button"
        className="color-slot-swatch"
        aria-label={`${label}: ${color}`}
        aria-expanded={open}
        style={{ backgroundColor: color }}
        onClick={() => setOpen((o) => !o)}
      />
      <span className="color-slot-label">{label}</span>
      {open && (
        <div className="color-pop" role="dialog" aria-label={`Pick ${label}`}>
          <ConicColorWheel
            colorHex={rgbToHex([wheelR, wheelG, wheelB])}
            onPick={(rgb) => onChange(rgbToHex(rgb))}
            size={180}
          />
          <input
            className="input color-pop-hex"
            aria-label={`${label} hex`}
            value={hexDraft}
            onChange={(e) => {
              setHexDraft(e.target.value);
              if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) onChange(e.target.value);
            }}
          />
        </div>
      )}
    </div>
  );
}
