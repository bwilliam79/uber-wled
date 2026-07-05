import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WeeklyScheduleForm } from '../components/WeeklyScheduleForm';

const groups = [{ id: 'g1', name: 'Porch', icon: null, sortOrder: 0, members: [] }];
const themes = [{ id: 't1', name: 'Sunset', effect: 2, palette: 5, colors: [[255, 100, 0]], brightness: 180 }];

describe('WeeklyScheduleForm', () => {
  it('calls onPreview with the selected days, time, group, and action', () => {
    const onPreview = vi.fn();
    render(
      <WeeklyScheduleForm
        groups={groups}
        themes={themes}
        onPreview={onPreview}
        onApprove={vi.fn()}
        onDiscard={vi.fn()}
        previewing={false}
      />
    );

    fireEvent.click(screen.getByLabelText('Mon'));
    fireEvent.click(screen.getByLabelText('Wed'));
    fireEvent.change(screen.getByLabelText(/time/i), { target: { value: '18:30' } });
    fireEvent.click(screen.getByText('Preview'));

    expect(onPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        daysOfWeek: [1, 3],
        timeOfDay: '18:30',
        groupId: 'g1'
      })
    );
  });

  it('shows Approve/Discard only while previewing', () => {
    const { rerender } = render(
      <WeeklyScheduleForm groups={groups} themes={themes} onPreview={vi.fn()} onApprove={vi.fn()} onDiscard={vi.fn()} previewing={false} />
    );
    expect(screen.queryByText('Approve')).toBeNull();

    rerender(
      <WeeklyScheduleForm groups={groups} themes={themes} onPreview={vi.fn()} onApprove={vi.fn()} onDiscard={vi.fn()} previewing={true} />
    );
    expect(screen.getByText('Approve')).toBeTruthy();
    expect(screen.getByText('Discard')).toBeTruthy();
  });
});
