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

  it('keeps focus on an input the user is typing into when the parent re-renders with a new onClose reference', () => {
    // Regression: callers overwhelmingly pass an inline onClose arrow
    // function, which gets a new identity on every parent re-render —
    // including re-renders triggered by something unrelated, like a
    // polling query elsewhere on the page (e.g. SyncSection's live-status
    // poll while the "New sync group" modal is open). With onClose in the
    // focus-trap effect's dependency array, that alone tore the effect down
    // and re-ran it, yanking focus away from whatever the user was actively
    // typing into on every poll tick.
    const { rerender } = render(
      <Modal open onClose={() => {}} title="New sync group">
        <input aria-label="Name" />
      </Modal>
    );
    const input = screen.getByLabelText('Name');
    input.focus();
    fireEvent.change(input, { target: { value: 'Front of house' } });
    expect(document.activeElement).toBe(input);

    // Simulate the parent re-rendering with a brand-new onClose identity —
    // exactly what an inline `onClose={() => setOpen(false)}` produces.
    rerender(
      <Modal open onClose={() => {}} title="New sync group">
        <input aria-label="Name" />
      </Modal>
    );

    expect(document.activeElement).toBe(input);
  });
});
