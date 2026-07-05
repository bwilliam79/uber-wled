import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal } from '../../../components/ui';

function renderModal(onClose = vi.fn()) {
  render(
    <Modal open onClose={onClose} title="Confirm delete" footer={<button>OK</button>}>
      <button>body action</button>
    </Modal>
  );
  return onClose;
}

describe('Modal', () => {
  it('renders nothing when closed', () => {
    render(<Modal open={false} onClose={() => {}} title="Hidden">x</Modal>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders a dialog and moves focus to its first focusable element', () => {
    renderModal();
    expect(screen.getByRole('dialog', { name: 'Confirm delete' })).toBeTruthy();
    // header close button is the first focusable in DOM order
    expect((document.activeElement as HTMLElement).getAttribute('aria-label')).toBe('Close');
  });

  it('traps Tab: forward from last wraps to first, Shift+Tab from first wraps to last', () => {
    renderModal();
    const ok = screen.getByRole('button', { name: 'OK' });
    ok.focus();
    fireEvent.keyDown(ok, { key: 'Tab' });
    expect((document.activeElement as HTMLElement).getAttribute('aria-label')).toBe('Close');
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(ok);
  });

  it('closes on Escape and on overlay click, but not on panel click', () => {
    const onClose = renderModal();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(document.querySelector('.ui-overlay') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
