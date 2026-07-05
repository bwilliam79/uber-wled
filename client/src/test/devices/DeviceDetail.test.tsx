import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { DeviceDetail } from '../../sections/devices/DeviceDetail';
import type { DeviceTab } from '../../sections/devices/route';
import { renderDevices } from './helpers';
import { CONTROLLERS, liveEntry } from './fixtures';

vi.mock('../../sections/devices/SegmentsTab', () => ({
  SegmentsTab: (p: { ledCount: number; maxSeg: number }) => (
    <div data-testid="segments-tab">{p.ledCount}:{p.maxSeg}</div>
  )
}));
vi.mock('../../sections/devices/DevicePresetsTab', () => ({
  DevicePresetsTab: () => <div data-testid="presets-tab" />
}));
vi.mock('../../sections/devices/ConfigTab', () => ({
  ConfigTab: () => <div data-testid="config-tab" />
}));
vi.mock('../../sections/devices/UpdateTab', () => ({
  UpdateTab: () => <div data-testid="update-tab" />
}));

function renderDetail(tab: DeviceTab = 'info', overrides: Partial<Parameters<typeof DeviceDetail>[0]> = {}) {
  const onTabChange = vi.fn();
  const onBack = vi.fn();
  renderDevices(
    <DeviceDetail controller={CONTROLLERS[0]} live={liveEntry()} tab={tab}
      onTabChange={onTabChange} onBack={onBack} {...overrides} />
  );
  return { onTabChange, onBack };
}

describe('DeviceDetail', () => {
  it('renders the header and all five tabs, Info panel by default', () => {
    renderDetail();
    expect(screen.getByRole('heading', { name: 'Cabinet Lights' })).toBeTruthy();
    expect(screen.getAllByRole('tab').map((t) => t.textContent))
      .toEqual(['Info', 'Segments', 'Presets', 'Config', 'Update']);
    expect(screen.getByText('Device facts')).toBeTruthy();
  });

  it('feeds Segments the live ledCount and maxseg', () => {
    renderDetail('segments');
    expect(screen.getByTestId('segments-tab').textContent).toBe('48:32');
  });

  it('tab clicks report the tab id upward (routing owns the hash)', () => {
    const { onTabChange } = renderDetail();
    fireEvent.click(screen.getByRole('tab', { name: 'Config' }));
    expect(onTabChange).toHaveBeenCalledWith('config');
  });

  it('the back control calls onBack', () => {
    const { onBack } = renderDetail();
    fireEvent.click(screen.getByRole('button', { name: 'Back to devices' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('shows the offline chip for an unreachable device', () => {
    renderDetail('info', { live: { reachable: false } });
    expect(screen.getAllByText('Offline').length).toBeGreaterThan(0);
  });
});
