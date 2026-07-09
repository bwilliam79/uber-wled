import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from '../renderWithQuery';
import { AddControllerCard } from '../../sections/settings/AddControllerCard';

afterEach(() => vi.unstubAllGlobals());

describe('AddControllerCard', () => {
  it('POSTs the name + host to /api/controllers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'c3', name: 'Attic', host: '10.0.0.60', source: 'manual', stale: false, pinnedAssetPattern: null })
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithQuery(<AddControllerCard />);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Attic' } });
    fireEvent.change(screen.getByLabelText('Host or IP'), { target: { value: '10.0.0.60' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add controller' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) => String(url) === '/api/controllers' && (init as RequestInit)?.method === 'POST'
      );
      expect(call).toBeTruthy();
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ name: 'Attic', host: '10.0.0.60' });
    });
  });

  it('disables Add until both fields are filled', () => {
    renderWithQuery(<AddControllerCard />);
    const btn = screen.getByRole('button', { name: 'Add controller' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Attic' } });
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Host or IP'), { target: { value: '10.0.0.60' } });
    expect(btn.disabled).toBe(false);
  });
});
