import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Drawer } from '../../../components/ui';

describe('Drawer', () => {
  it('renders nothing when closed', () => {
    render(<Drawer open={false} onClose={() => {}} title="Control">x</Drawer>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders a dialog panel inside the drawer overlay with a scrollable body', () => {
    render(<Drawer open onClose={() => {}} title="Control">content</Drawer>);
    const dialog = screen.getByRole('dialog', { name: 'Control' });
    expect(dialog.className).toContain('ui-drawer');
    expect(document.querySelector('.ui-overlay.ui-overlay-drawer')).toBeTruthy();
    expect(document.querySelector('.ui-drawer-body')?.textContent).toBe('content');
  });

  it('omits the header when no title is given (host renders its own)', () => {
    render(<Drawer open onClose={() => {}}>content</Drawer>);
    expect(document.querySelector('.ui-drawer-head')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Panel' })).toBeTruthy();
  });

  it('closes on Escape and overlay click, but not on panel click', () => {
    const onClose = vi.fn();
    render(<Drawer open onClose={onClose} title="Control">content</Drawer>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(document.querySelector('.ui-overlay-drawer') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
