import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from '../components/AppShell';
import { ToastProvider } from '../components/ui/Toast';
import { ThemeProvider } from '../theme/ThemeProvider';

const SECTION_NAMES = ['Devices', 'Themes', 'Schedule', 'Sync', 'Firmware', 'Settings'];

function renderShell() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ThemeProvider>
        <ToastProvider>
          <AppShell />
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => { window.location.hash = ''; });

describe('BottomNav labels', () => {
  it('shows a visible label on every bottom-nav item, not only the active one', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    renderShell();
    const bottom = screen.getByRole('navigation', { name: 'Bottom navigation' });
    for (const name of SECTION_NAMES) {
      expect(within(bottom).getByText(name)).toBeTruthy();
    }
    expect(within(bottom).getByRole('button', { name: 'Devices' }).className).toContain('active');
    expect(within(bottom).getByRole('button', { name: 'Themes' }).className).not.toContain('active');
  });
});
