import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ControlSurface } from '../../control/ControlSurface';
import { CAPS_A, CAPS_B, makeSeg, makeState, liveEntry } from '../fixtures/capabilities';
import type { ControllerCapabilities, Target } from '../../api/client';
import type { LiveStatusEntry } from '../../api/live';
import { applyControl } from '../../api/client';
import {
  useControllers, useGroups, useThemes, useCapabilitiesMap, useDevicePresets
} from '../../api/queries';
import { useLiveStatus } from '../../api/live';

vi.mock('../../api/live', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/live')>();
  return { ...actual, useLiveStatus: vi.fn() };
});
vi.mock('../../api/queries', () => ({
  useControllers: vi.fn(),
  useGroups: vi.fn(),
  useThemes: vi.fn(),
  useCapabilitiesMap: vi.fn(),
  useDevicePresets: vi.fn()
}));
vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client')>();
  return {
    ...actual,
    applyControl: vi.fn(async () => ({ results: [] }))
  };
});

const CONTROLLERS = [
  { id: 'cA', name: 'Cabinet', host: '192.168.1.86', source: 'manual' as const, stale: false, pinnedAssetPattern: null },
  { id: 'cB', name: 'Porch', host: '192.168.1.87', source: 'manual' as const, stale: false, pinnedAssetPattern: null }
];
const TWO_TARGETS: Target[] = [
  { kind: 'controller', controllerId: 'cA' },
  { kind: 'controller', controllerId: 'cB' }
];

function setupMocks(live: Map<string, LiveStatusEntry>) {
  vi.mocked(useControllers).mockReturnValue({ data: CONTROLLERS } as never);
  vi.mocked(useGroups).mockReturnValue({ data: [] } as never);
  vi.mocked(useThemes).mockReturnValue({
    data: [{ id: 't1', name: 'Sunset', effect: 2, palette: 5, colors: [[255, 100, 0]], brightness: 180 }]
  } as never);
  vi.mocked(useCapabilitiesMap).mockReturnValue(
    new Map<string, ControllerCapabilities>([['cA', CAPS_A], ['cB', CAPS_B]])
  );
  vi.mocked(useDevicePresets).mockReturnValue({ data: [] } as never);
  vi.mocked(useLiveStatus).mockReturnValue(live);
}

describe('ControlSurface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(applyControl).mockResolvedValue({ results: [] });
  });

  it('shows a Mixed chip for disagreeing brightness and is write-only until the user sets a value (then optimistic + fanned out)', () => {
    setupMocks(new Map([
      ['cA', liveEntry(makeState([makeSeg(0)], { bri: 10 }))],
      ['cB', liveEntry(makeState([makeSeg(0)], { bri: 200 }))]
    ]));
    render(<ControlSurface targets={TWO_TARGETS} open onClose={vi.fn()} />);
    expect(screen.getAllByText('Mixed').length).toBeGreaterThan(0);
    const slider = screen.getByLabelText('Brightness') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '150' } });
    expect(applyControl).toHaveBeenCalledWith(TWO_TARGETS, { bri: 150 });
    expect(slider.value).toBe('150'); // optimistic
  });

  it('sends a top-level power patch from the master toggle', () => {
    setupMocks(new Map([
      ['cA', liveEntry(makeState([makeSeg(0, { on: false })], { on: false }))],
      ['cB', liveEntry(makeState([makeSeg(0, { on: false })], { on: false }))]
    ]));
    render(<ControlSurface targets={TWO_TARGETS} open onClose={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Power'));
    expect(applyControl).toHaveBeenCalledWith(TWO_TARGETS, { on: true });
  });

  it('throttles rapid slider drags to the leading call (trailing fires later)', () => {
    setupMocks(new Map([['cA', liveEntry(makeState([makeSeg(0)], { bri: 10 }))]]));
    render(<ControlSurface targets={[TWO_TARGETS[0]]} open onClose={vi.fn()} />);
    const slider = screen.getByLabelText('Brightness');
    fireEvent.change(slider, { target: { value: '50' } });
    fireEvent.change(slider, { target: { value: '60' } });
    fireEvent.change(slider, { target: { value: '70' } });
    expect(applyControl).toHaveBeenCalledTimes(1); // leading edge only; trailing waits 250ms
    expect(applyControl).toHaveBeenCalledWith([TWO_TARGETS[0]], { bri: 50 });
  });

  it('prefers the live device-reported name over the stored controller name for target chips', () => {
    // CONTROLLERS[0].name is 'Cabinet' (stored); liveEntry()'s default info
    // reports 'Cabinet Lights' — the chip should show the live name.
    setupMocks(new Map([['cA', liveEntry(makeState([makeSeg(0)]))]]));
    render(<ControlSurface targets={[TWO_TARGETS[0]]} open onClose={vi.fn()} />);
    expect(screen.getByText('Cabinet Lights')).toBeTruthy();
    expect(screen.queryByText('Cabinet', { exact: true })).toBeNull();
  });

  it('removing a target chip narrows subsequent writes', () => {
    setupMocks(new Map([
      ['cA', liveEntry(makeState([makeSeg(0)]))],
      ['cB', liveEntry(makeState([makeSeg(0)]))]
    ]));
    render(<ControlSurface targets={TWO_TARGETS} open onClose={vi.fn()} />);
    fireEvent.click(screen.getAllByLabelText('Remove')[1]); // drop Porch (kit Chip remove button)
    fireEvent.click(screen.getByLabelText('Power'));
    expect(applyControl).toHaveBeenCalledWith([TWO_TARGETS[0]], expect.any(Object));
  });

  it('surfaces partial failures in an expandable notice', async () => {
    setupMocks(new Map([
      ['cA', liveEntry(makeState([makeSeg(0)]))],
      ['cB', liveEntry(makeState([makeSeg(0)]))]
    ]));
    vi.mocked(applyControl).mockResolvedValue({
      results: [
        { controllerId: 'cA', wledSegId: null, ok: true },
        { controllerId: 'cB', wledSegId: 0, ok: false, error: 'timeout' }
      ]
    });
    render(<ControlSurface targets={TWO_TARGETS} open onClose={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Power'));
    expect(await screen.findByText('1 target failed')).toBeTruthy();
    expect(screen.getByText(/cB seg 0: timeout/)).toBeTruthy();
  });

  it('applies an effect by name from the Effects tab', () => {
    setupMocks(new Map([
      ['cA', liveEntry(makeState([makeSeg(0, { fx: 0 })]))],
      ['cB', liveEntry(makeState([makeSeg(0, { fx: 0 })]))]
    ]));
    render(<ControlSurface targets={TWO_TARGETS} open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Effects' }));
    fireEvent.click(screen.getByRole('button', { name: /Colortwinkles/ }));
    expect(applyControl).toHaveBeenCalledWith(TWO_TARGETS, { seg: { fxName: 'Colortwinkles' } });
  });

  it('applies a theme as an id-based ControlPatch', () => {
    setupMocks(new Map([['cA', liveEntry(makeState([makeSeg(0)]))]]));
    render(<ControlSurface targets={[TWO_TARGETS[0]]} open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Themes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply theme Sunset' }));
    expect(applyControl).toHaveBeenCalledWith(
      [TWO_TARGETS[0]],
      { bri: 180, seg: { fxId: 2, palId: 5, col: [[255, 100, 0]] } }
    );
  });

  it('gates device presets on a single-controller selection and applies a { ps } patch via v2', () => {
    setupMocks(new Map([['cA', liveEntry(makeState([makeSeg(0)]))]]));
    vi.mocked(useDevicePresets).mockReturnValue({
      data: [{ id: 3, name: 'Night', isPlaylist: false }]
    } as never);
    render(<ControlSurface targets={[TWO_TARGETS[0]]} open onClose={vi.fn()} />);
    expect(useDevicePresets).toHaveBeenLastCalledWith('cA');
    fireEvent.click(screen.getByRole('tab', { name: 'Themes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply preset Night' }));
    expect(applyControl).toHaveBeenCalledWith(
      [{ kind: 'controller', controllerId: 'cA' }],
      { ps: 3 }
    );
  });

  it('passes null to useDevicePresets for multi-controller selections', () => {
    setupMocks(new Map([
      ['cA', liveEntry(makeState([makeSeg(0)]))],
      ['cB', liveEntry(makeState([makeSeg(0)]))]
    ]));
    render(<ControlSurface targets={TWO_TARGETS} open onClose={vi.fn()} />);
    expect(useDevicePresets).toHaveBeenLastCalledWith(null);
  });
});
