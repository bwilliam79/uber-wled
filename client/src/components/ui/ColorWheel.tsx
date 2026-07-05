import { useEffect, useRef } from 'react';
import iro from '@jaames/iro';

type Rgb = { r: number; g: number; b: number };

interface IroPickerLike {
  color: { rgb: Rgb; set(c: Rgb): void };
  on(evt: 'color:change', fn: (c: { rgb: Rgb }) => void): void;
}

export interface ColorWheelProps {
  color: Rgb;
  onChange: (c: Rgb) => void;
  width?: number;
}

export function ColorWheel({ color, onChange, width = 260 }: ColorWheelProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<IroPickerLike | null>(null);
  const suppressRef = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const createPicker = iro.ColorPicker as unknown as (
      el: HTMLElement,
      opts: Record<string, unknown>
    ) => IroPickerLike;
    const picker = createPicker(mount, {
      width,
      color,
      layout: [{ component: iro.ui.Wheel }]
    });
    picker.on('color:change', (c) => {
      if (suppressRef.current) return;
      onChangeRef.current(c.rgb);
    });
    pickerRef.current = picker;
    return () => {
      pickerRef.current = null;
      mount.innerHTML = '';
    };
    // The picker is created once; prop updates flow through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const picker = pickerRef.current;
    if (!picker) return;
    const current = picker.color.rgb;
    if (current.r === color.r && current.g === color.g && current.b === color.b) return;
    suppressRef.current = true;
    picker.color.set(color);
    suppressRef.current = false;
  }, [color.r, color.g, color.b]);

  return <div ref={mountRef} data-testid="color-wheel" className="color-wheel" />;
}
