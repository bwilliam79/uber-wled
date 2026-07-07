import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WeeklyScheduleForm } from '../sections/schedule/WeeklyScheduleForm';

const groups = [{ id: 'g1', name: 'Front', icon: null, sortOrder: 0, members: [] }];
const controllers: never[] = [];
const live = new Map();
const themes = [{ id: 't1', name: 'Spooky', effect: 0, palette: 0, colors: [[0, 0, 0]], brightness: 128 }];

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
      name: 'Evenings', daysOfWeek: [1, 5], timeOfDay: '20:30',
      target: { groupId: 'g1', controllerId: null, wledSegId: null },
      actionType: 'theme', actionPayload: { themeId: 't1' }
    });
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
