import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ToastProvider, useToast } from '../../../components/ui';

function Trigger({ duration }: { duration?: number }) {
  const { show } = useToast();
  return (
    <button onClick={() => show({ title: 'Applied to 3 targets', variant: 'success', duration })}>
      fire
    </button>
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Toast', () => {
  it('shows a toast in the live region and auto-dismisses after the default 4s', () => {
    vi.useFakeTimers();
    render(<ToastProvider><Trigger /></ToastProvider>);
    fireEvent.click(screen.getByText('fire'));
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText('Applied to 3 targets')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(4000); });
    expect(screen.queryByText('Applied to 3 targets')).toBeNull();
  });

  it('keeps duration:0 toasts until manually dismissed', () => {
    vi.useFakeTimers();
    render(<ToastProvider><Trigger duration={0} /></ToastProvider>);
    fireEvent.click(screen.getByText('fire'));
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByText('Applied to 3 targets')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Applied to 3 targets')).toBeNull();
  });

  it('stacks multiple toasts', () => {
    vi.useFakeTimers();
    render(<ToastProvider><Trigger /></ToastProvider>);
    fireEvent.click(screen.getByText('fire'));
    fireEvent.click(screen.getByText('fire'));
    expect(screen.getAllByText('Applied to 3 targets')).toHaveLength(2);
  });

  it('throws a clear error when useToast is used outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Trigger />)).toThrow('useToast must be used inside <ToastProvider>');
    spy.mockRestore();
  });
});
