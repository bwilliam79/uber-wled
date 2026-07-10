import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TargetPicker } from '../sections/schedule/TargetPicker';
import type { Controller, Group } from '../api/client';

const groups: Group[] = [
  { id: 'g1', name: 'Front porch', icon: null, sortOrder: 0, members: [] },
  { id: 'g2', name: 'Kitchen', icon: null, sortOrder: 1, members: [] }
];
const controllers: Controller[] = [
  { id: 'c1', name: 'cabinet-lights', host: '192.168.1.86', source: 'discovered', stale: false, pinnedAssetPattern: null },
  { id: 'c2', name: 'tv-lights', host: '192.168.1.161', source: 'discovered', stale: false, pinnedAssetPattern: null }
];

describe('TargetPicker', () => {
  it('defaults to Group mode and lists group names', () => {
    const onChange = vi.fn();
    render(
      <TargetPicker
        idPrefix="test"
        groups={groups}
        controllers={controllers}
        live={new Map()}
        value={{ groupId: 'g1', controllers: null }}
        onChange={onChange}
      />
    );
    expect((screen.getByRole('radio', { name: 'Group' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('option', { name: 'Front porch' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Kitchen' })).toBeTruthy();
  });

  it('switching to Controller mode selects the first controller and clears groupId', () => {
    const onChange = vi.fn();
    render(
      <TargetPicker
        idPrefix="test"
        groups={groups}
        controllers={controllers}
        live={new Map()}
        value={{ groupId: 'g1', controllers: null }}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Controller(s)' }));
    expect(onChange).toHaveBeenCalledWith({ groupId: null, controllers: [{ controllerId: 'c1', wledSegId: null }] });
  });

  it('checking a second controller adds it to the list without removing the first', () => {
    const onChange = vi.fn();
    render(
      <TargetPicker
        idPrefix="test"
        groups={groups}
        controllers={controllers}
        live={new Map()}
        value={{ groupId: null, controllers: [{ controllerId: 'c1', wledSegId: null }] }}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'tv-lights' }));
    expect(onChange).toHaveBeenCalledWith({
      groupId: null,
      controllers: [{ controllerId: 'c1', wledSegId: null }, { controllerId: 'c2', wledSegId: null }]
    });
  });

  it('unchecking a controller removes just that one from the list', () => {
    const onChange = vi.fn();
    render(
      <TargetPicker
        idPrefix="test"
        groups={groups}
        controllers={controllers}
        live={new Map()}
        value={{
          groupId: null,
          controllers: [{ controllerId: 'c1', wledSegId: null }, { controllerId: 'c2', wledSegId: null }]
        }}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'cabinet-lights' }));
    expect(onChange).toHaveBeenCalledWith({ groupId: null, controllers: [{ controllerId: 'c2', wledSegId: null }] });
  });

  it('in Controller mode, prefers the live device-reported name over the stored controller name', () => {
    const live = new Map([
      ['c1', { reachable: true, state: {}, info: { name: 'Cabinet Lights', ver: '16.0.0', leds: { count: 48 }, arch: 'esp32' } }]
    ]);
    render(
      <TargetPicker
        idPrefix="test"
        groups={groups}
        controllers={controllers}
        live={live as never}
        value={{ groupId: null, controllers: [{ controllerId: 'c1', wledSegId: null }] }}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByRole('checkbox', { name: 'Cabinet Lights' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'cabinet-lights' })).toBeNull();
  });

  it('picking a different group reports it via onChange with controllers cleared', () => {
    const onChange = vi.fn();
    render(
      <TargetPicker
        idPrefix="test"
        groups={groups}
        controllers={controllers}
        live={new Map()}
        value={{ groupId: 'g1', controllers: null }}
        onChange={onChange}
      />
    );
    fireEvent.change(screen.getByLabelText('target group'), { target: { value: 'g2' } });
    expect(onChange).toHaveBeenCalledWith({ groupId: 'g2', controllers: null });
  });

  it('shows an empty state instead of a select when there are no groups', () => {
    render(
      <TargetPicker
        idPrefix="test"
        groups={[]}
        controllers={controllers}
        live={new Map()}
        value={{ groupId: null, controllers: null }}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByText(/No room groups/)).toBeTruthy();
  });

  it('shows an empty state in Controller mode when there are no controllers', () => {
    render(
      <TargetPicker
        idPrefix="test"
        groups={groups}
        controllers={[]}
        live={new Map()}
        value={{ groupId: null, controllers: [] }}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByText(/No controllers yet/)).toBeTruthy();
  });
});
