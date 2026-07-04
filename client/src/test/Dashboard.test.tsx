import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Dashboard } from '../pages/Dashboard';

afterEach(() => vi.unstubAllGlobals());

function jsonResponse(body: unknown) {
  return Promise.resolve({ ok: true, json: async () => body });
}

function stubDashboardFetch(overrides: Record<string, unknown> = {}) {
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (typeof url === 'string' && url.startsWith('/api/controllers')) {
      return jsonResponse(overrides.controllers ?? []);
    }
    if (typeof url === 'string' && url.startsWith('/api/floorplans')) {
      if (method === 'POST' && overrides.uploadResult) return jsonResponse(overrides.uploadResult);
      return jsonResponse(overrides.floorplans ?? []);
    }
    if (typeof url === 'string' && url.startsWith('/api/calendar-events')) {
      return jsonResponse(overrides.calendarEvents ?? []);
    }
    if (typeof url === 'string' && url.startsWith('/api/groups')) {
      return jsonResponse(overrides.groups ?? []);
    }
    if (typeof url === 'string' && url.startsWith('/api/themes')) {
      return jsonResponse(overrides.themes ?? []);
    }
    return jsonResponse([]);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('Dashboard floorplan upload', () => {
  it('shows an empty state and an upload form when there are no floorplans', async () => {
    stubDashboardFetch();
    render(<Dashboard />);

    await waitFor(() => expect(screen.getByText(/No floorplans yet/)).toBeTruthy());
    expect(screen.getByLabelText(/^Name$/, { selector: '#floorplan-name' })).toBeTruthy();
    expect(screen.getByLabelText(/Image/)).toBeTruthy();
    expect(screen.getByText('Upload')).toBeTruthy();
  });

  it('uploads a floorplan and adds it to the list on success', async () => {
    const created = { id: 'f1', name: 'Front Yard', imagePath: '/uploads/f1.png', cropX: 0, cropY: 0, cropWidth: 100, cropHeight: 100, rotation: 0, zoom: 1 };
    const fetchMock = stubDashboardFetch({ uploadResult: created });
    render(<Dashboard />);

    await waitFor(() => expect(screen.getByText(/No floorplans yet/)).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/^Name$/, { selector: '#floorplan-name' }), {
      target: { value: 'Front Yard' }
    });
    const file = new File(['fake'], 'front.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText(/Image/), { target: { files: [file] } });

    fireEvent.click(screen.getByText('Upload'));

    await waitFor(() => expect(screen.getByText('Front Yard')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith('/api/floorplans', expect.objectContaining({ method: 'POST' }));
  });
});
