import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Controller } from '../../api/client';
import type { LiveStatusEntry } from '../../api/live';
import { MasterBar } from '../../components/MasterBar';
import { ThemeProvider } from '../../theme/ThemeProvider';

const controllers: Controller[] = [
  { id: 'c1', name: 'Controller A', host: '192.0.2.10', source: 'manual', stale: false, pinnedAssetPattern: null }
];

function live(): Map<string, LiveStatusEntry> {
  return new Map([['c1', { reachable: true, state: { on: true, bri: 128, transition: 0, ps: -1, pl: -1, nl: { on: false, dur: 60, mode: 0, tbri: 0, rem: -1 }, mainseg: 0, seg: [] } }]]);
}

function bar(title: string) {
  return (
    <ThemeProvider>
      <MasterBar title={title} subtitle="controllers on the network" controllers={controllers} live={live()} />
    </ThemeProvider>
  );
}

describe('MasterBar fleet status', () => {
  it('stays collapsed after the user closes it and the bar re-renders', () => {
    const { rerender } = render(bar('Devices'));
    const details = screen.getByText('Fleet status').closest('details') as HTMLDetailsElement;
    expect(details.open).toBe(true);

    fireEvent.click(screen.getByText('Fleet status'));
    expect(details.open).toBe(false);

    rerender(bar('Themes'));
    expect(screen.getByText('Themes')).toBeTruthy();
    expect(details.open).toBe(false);
  });
});
