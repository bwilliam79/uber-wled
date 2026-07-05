import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button, IconButton, Card, Chip, Field, Skeleton } from '../../../components/ui';
import { XIcon } from '../../../components/icons';

describe('Button', () => {
  it('defaults to type=button, secondary variant, md size', () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn.getAttribute('type')).toBe('button');
    expect(btn.className).toContain('ui-btn-secondary');
    expect(btn.className).toContain('ui-btn-md');
  });

  it('applies variant/size classes and merges custom className', () => {
    render(<Button variant="danger" size="sm" className="extra">Delete</Button>);
    const btn = screen.getByRole('button', { name: 'Delete' });
    expect(btn.className).toContain('ui-btn-danger');
    expect(btn.className).toContain('ui-btn-sm');
    expect(btn.className).toContain('extra');
  });
});

describe('IconButton', () => {
  it('exposes its label as accessible name', () => {
    render(<IconButton label="Close"><XIcon /></IconButton>);
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });
});

describe('Card', () => {
  it('renders children inside a ui-card and merges className', () => {
    render(<Card className="pad">hello</Card>);
    const el = screen.getByText('hello');
    expect(el.className).toContain('ui-card');
    expect(el.className).toContain('pad');
  });
});

describe('Chip', () => {
  it('renders a remove button only when onRemove is given', () => {
    const onRemove = vi.fn();
    const { rerender } = render(<Chip onRemove={onRemove}>Porch</Chip>);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    rerender(<Chip>Porch</Chip>);
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });
});

describe('Field', () => {
  it('associates the label and shows an error with role=alert', () => {
    render(
      <Field label="Host" htmlFor="host" error="Required">
        <input id="host" />
      </Field>
    );
    expect(screen.getByLabelText('Host')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Required');
  });
});

describe('Skeleton', () => {
  it('is aria-hidden and sized via inline style', () => {
    const { container } = render(<Skeleton width="120px" height="16px" />);
    const el = container.querySelector('.ui-skeleton') as HTMLElement;
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.style.width).toBe('120px');
    expect(el.style.height).toBe('16px');
  });
});
