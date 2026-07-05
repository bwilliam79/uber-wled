import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';

export interface SliderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  disabled?: boolean;
  fillColor?: string;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
}

const COMMIT_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'];

export function Slider({
  value, min = 0, max = 255, step = 1, label, disabled, fillColor, onChange, onCommit
}: SliderProps) {
  const pct = max === min ? 0 : ((value - min) / (max - min)) * 100;
  const style = {
    '--ui-slider-fill': `${pct}%`,
    '--ui-slider-color': fillColor ?? 'var(--accent)'
  } as CSSProperties;

  function handlePointerUp(e: PointerEvent<HTMLInputElement>) {
    onCommit?.(Number(e.currentTarget.value));
  }

  function handleKeyUp(e: KeyboardEvent<HTMLInputElement>) {
    if (COMMIT_KEYS.includes(e.key)) onCommit?.(Number(e.currentTarget.value));
  }

  return (
    <input
      type="range"
      className="ui-slider"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      style={style}
      onChange={(e) => onChange(Number(e.target.value))}
      onPointerUp={handlePointerUp}
      onKeyUp={handleKeyUp}
    />
  );
}
