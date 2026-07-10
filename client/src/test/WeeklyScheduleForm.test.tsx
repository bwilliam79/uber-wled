import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WeeklyScheduleForm } from '../sections/schedule/WeeklyScheduleForm';

const groups = [{ id: 'g1', name: 'Front', icon: null, sortOrder: 0, members: [] }];
const controllers = [
  { id: 'c1', name: 'cabinet-lights', host: '192.168.1.86', source: 'discovered' as const, stale: false, pinnedAssetPattern: null },
  { id: 'c2', name: 'tv-lights', host: '192.168.1.161', source: 'discovered' as const, stale: false, pinnedAssetPattern: null }
];
const live = new Map();
const themes = [{ id: 't1', name: 'Spooky', effect: 0, palette: 0, colors: [[0, 0, 0]], brightness: 128, speed: 128, intensity: 128 }];

describe('WeeklyScheduleForm v2', () => {
  it('builds a draft from the selected days/time/target/theme on Preview', () => {
    const onPreview = vi.fn();
    render(
      <WeeklyScheduleForm
        groups={groups} controllers={controllers} live={live} themes={themes}
        onPreview={onPreview} onApprove={() => {}} onDiscard={() => {}} previewing={false}
      />
    );
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Evenings' } });
    fireEvent.click(screen.getByLabelText('Mon'));
    fireEvent.click(screen.getByLabelText('Fri'));
    fireEvent.change(screen.getByLabelText('time of day'), { target: { value: '20:30' } });
    fireEvent.click(screen.getByText('Preview'));
    expect(onPreview).toHaveBeenCalledWith({
      name: 'Evenings', daysOfWeek: [1, 5],
      triggerType: 'weekly', timeOfDay: '20:30', offsetMinutes: 0,
      target: { groupId: 'g1', controllers: null },
      actionType: 'theme', actionPayload: { themeId: 't1' }
    });
  });

  it('builds a draft targeting several individual controllers directly, no group', () => {
    const onPreview = vi.fn();
    render(
      <WeeklyScheduleForm
        groups={groups} controllers={controllers} live={live} themes={themes}
        onPreview={onPreview} onApprove={() => {}} onDiscard={() => {}} previewing={false}
      />
    );
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Multi' } });
    fireEvent.click(screen.getByLabelText('Mon'));
    fireEvent.click(screen.getByRole('radio', { name: 'Controller(s)' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'tv-lights' }));
    fireEvent.click(screen.getByText('Preview'));
    expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({
      target: {
        groupId: null,
        controllers: [{ controllerId: 'c1', wledSegId: null }, { controllerId: 'c2', wledSegId: null }]
      }
    }));
  });

  it('swaps Preview for Approve/Discard while previewing', () => {
    const onApprove = vi.fn();
    render(
      <WeeklyScheduleForm
        groups={groups} controllers={controllers} live={live} themes={themes}
        onPreview={() => {}} onApprove={onApprove} onDiscard={() => {}} previewing={true}
      />
    );
    expect(screen.queryByText('Preview')).toBeNull();
    fireEvent.click(screen.getByText('Approve'));
    expect(onApprove).toHaveBeenCalled();
  });
});
