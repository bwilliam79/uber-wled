import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HomeTile } from '../../components/HomeTile';

const MEMBERS = [{ controllerId: 'c1', wledSegId: 0 }];
const THEMES = [{ id: 't1', name: 'Sunset', effect: 2, palette: 5, colors: [[255, 100, 0]], brightness: 180 }];

describe('HomeTile', () => {
  it('shows the title and "on" status with brightness', () => {
    render(
      <HomeTile
        id="g1" title="Kitchen" members={MEMBERS}
        status={{ power: 'on', brightness: 200, anyOffline: false }}
        themes={THEMES} onApply={vi.fn()}
      />
    );
    expect(screen.getByText('Kitchen')).toBeTruthy();
    expect(screen.getByText('On')).toBeTruthy();
    expect(screen.getByText('200 / 255')).toBeTruthy();
    expect(screen.queryByText('offline')).toBeNull();
  });

  it('shows "Mixed" and an offline badge when applicable', () => {
    render(
      <HomeTile
        id="g1" title="Kitchen" members={MEMBERS}
        status={{ power: 'mixed', brightness: 100, anyOffline: true }}
        themes={THEMES} onApply={vi.fn()}
      />
    );
    expect(screen.getByText('Mixed')).toBeTruthy();
    expect(screen.getByText('offline')).toBeTruthy();
  });

  it('shows a dash and no brightness reading when status is unknown', () => {
    render(
      <HomeTile
        id="g1" title="Kitchen" members={MEMBERS}
        status={{ power: 'unknown', brightness: null, anyOffline: true }}
        themes={THEMES} onApply={vi.fn()}
      />
    );
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.queryByText(/\/ 255/)).toBeNull();
  });

  it('calls onApply with power actions when On/Off are clicked', () => {
    const onApply = vi.fn();
    render(
      <HomeTile
        id="g1" title="Kitchen" members={MEMBERS}
        status={{ power: 'off', brightness: null, anyOffline: false }}
        themes={THEMES} onApply={onApply}
      />
    );
    screen.getByText('On').click();
    expect(onApply).toHaveBeenCalledWith({ type: 'power', on: true });
    screen.getByText('Off').click();
    expect(onApply).toHaveBeenCalledWith({ type: 'power', on: false });
  });

  it('calls onApply with a brightness action when the slider changes', () => {
    const onApply = vi.fn();
    render(
      <HomeTile
        id="g1" title="Kitchen" members={MEMBERS}
        status={{ power: 'on', brightness: 128, anyOffline: false }}
        themes={THEMES} onApply={onApply}
      />
    );
    const slider = screen.getByLabelText(/brightness for kitchen/i);
    fireEvent.change(slider, { target: { value: '75' } });
    expect(onApply).toHaveBeenCalledWith({ type: 'brightness', value: 75 });
  });

  it('calls onApply with a theme action and resets the select back to the placeholder', () => {
    const onApply = vi.fn();
    render(
      <HomeTile
        id="g1" title="Kitchen" members={MEMBERS}
        status={{ power: 'on', brightness: 128, anyOffline: false }}
        themes={THEMES} onApply={onApply}
      />
    );
    const select = screen.getByLabelText(/apply theme to kitchen/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 't1' } });
    expect(onApply).toHaveBeenCalledWith({ type: 'theme', themeId: 't1' });
    expect(select.value).toBe('');
  });

  it('disables all controls and shows a hint when there are no members', () => {
    render(
      <HomeTile
        id="g1" title="Empty Room" members={[]}
        status={{ power: 'unknown', brightness: null, anyOffline: false }}
        themes={THEMES} onApply={vi.fn()}
      />
    );
    expect(screen.getByText(/Add members in Groups/)).toBeTruthy();
    expect((screen.getByText('On') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText(/brightness for empty room/i) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText(/apply theme to empty room/i) as HTMLSelectElement).disabled).toBe(true);
  });
});
