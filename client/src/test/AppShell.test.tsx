import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AppShell } from '../components/AppShell';

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => { window.location.hash = ''; });

describe('AppShell', () => {
  it('renders the Layout section by default and highlights its nav item', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    render(<AppShell />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Layout/ })).toBeTruthy());
    expect(screen.getByRole('button', { name: /Layout/ }).className).toContain('active');
  });

  it('switches to the Themes section when its nav item is clicked', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    render(<AppShell />);
    fireEvent.click(screen.getByRole('button', { name: /Themes/ }));
    await waitFor(() => expect(screen.getByText(/No custom themes yet/)).toBeTruthy());
  });
});
