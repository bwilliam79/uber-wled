import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ControllerList } from '../components/ControllerList';

afterEach(() => vi.unstubAllGlobals());

describe('ControllerList', () => {
  it("renders each controller's name and host", () => {
    render(
      <ControllerList
        controllers={[
          { id: '1', name: 'Porch', host: '10.0.0.50', source: 'manual', stale: false, pinnedAssetPattern: null },
          { id: '2', name: 'Deck', host: '10.0.0.51', source: 'discovered', stale: true, pinnedAssetPattern: null }
        ]}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByText('Porch')).toBeTruthy();
    expect(screen.getByText(/10\.0\.0\.50/)).toBeTruthy();
    expect(screen.getByText(/stale/i)).toBeTruthy();
  });

  it('does not show firmware details — that belongs to the Firmware section only', () => {
    render(
      <ControllerList
        controllers={[
          { id: '1', name: 'Porch', host: '10.0.0.50', source: 'manual', stale: false, pinnedAssetPattern: null }
        ]}
        onDelete={vi.fn()}
      />
    );
    expect(screen.queryByText(/installed:/i)).toBeNull();
    expect(screen.queryByText(/update available/i)).toBeNull();
  });

  it('imports schedules for a controller and shows the imported/skipped counts', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('import-schedules')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            imported: [{ id: 's1' }, { id: 's2' }],
            skipped: [{ raw: {}, reason: 'unsupported trigger' }]
          })
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <ControllerList
        controllers={[
          { id: '1', name: 'Porch', host: '10.0.0.50', source: 'manual', stale: false, pinnedAssetPattern: null }
        ]}
        onDelete={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('Import schedules'));

    await waitFor(() => expect(screen.getByText(/Imported 2, skipped 1/)).toBeTruthy());

    expect(fetchMock).toHaveBeenCalledWith('/api/controllers/1/import-schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disableOnDevice: false })
    });
  });

  it('sends disableOnDevice: true when the checkbox is checked', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('import-schedules')) {
        return Promise.resolve({ ok: true, json: async () => ({ imported: [], skipped: [] }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <ControllerList
        controllers={[
          { id: '1', name: 'Porch', host: '10.0.0.50', source: 'manual', stale: false, pinnedAssetPattern: null }
        ]}
        onDelete={vi.fn()}
      />
    );

    fireEvent.click(screen.getByLabelText(/disable on device/i));
    fireEvent.click(screen.getByText('Import schedules'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/controllers/1/import-schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disableOnDevice: true })
      })
    );
  });
});
