import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ControllerList } from '../components/ControllerList';

describe('ControllerList', () => {
  it("renders each controller's name and host", () => {
    render(
      <ControllerList
        controllers={[
          { id: '1', name: 'Porch', host: '10.0.0.50', source: 'manual', stale: false },
          { id: '2', name: 'Deck', host: '10.0.0.51', source: 'discovered', stale: true }
        ]}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByText('Porch')).toBeTruthy();
    expect(screen.getByText(/10\.0\.0\.50/)).toBeTruthy();
    expect(screen.getByText(/stale/i)).toBeTruthy();
  });
});
