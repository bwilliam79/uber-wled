import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ControllerList } from '../components/ControllerList';

afterEach(() => vi.unstubAllGlobals());

describe('ControllerList', () => {
  it("renders each controller's name and host", () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          installedVersion: '0.14.0',
          latestTag: 'v0.14.0',
          updateAvailable: false,
          pinnedAssetPattern: null,
          candidateAssets: []
        })
      })
    );

    render(
      <ControllerList
        controllers={[
          { id: '1', name: 'Porch', host: '10.0.0.50', source: 'manual', stale: false },
          { id: '2', name: 'Deck', host: '10.0.0.51', source: 'discovered', stale: true }
        ]}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByText('Porch')).toBeTruthy();
    expect(screen.getByText(/10\.0\.0\.50/)).toBeTruthy();
    expect(screen.getByText(/stale/i)).toBeTruthy();
  });
});
