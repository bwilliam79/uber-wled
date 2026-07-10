import { useQueryClient } from '@tanstack/react-query';
import { importSchedulesFile, SCHEDULES_EXPORT_URL } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { ImportButton } from '../../components/ImportButton';
import { useToast } from '../../components/ui/Toast';
import { triggerDownload, readJsonFile } from '../../lib/fileTransfer';
import { ScheduleManager } from './ScheduleManager';
import './schedule.css';

export function ScheduleSection() {
  const queryClient = useQueryClient();
  const toast = useToast();

  async function handleImport(file: File) {
    try {
      const data = await readJsonFile(file);
      const r = await importSchedulesFile(data);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['schedules'] }),
        queryClient.invalidateQueries({ queryKey: ['calendarEvents'] })
      ]);
      const summary = `${r.schedules} schedule${r.schedules === 1 ? '' : 's'} + ${r.calendarEvents} event${r.calendarEvents === 1 ? '' : 's'}`;
      const skipNote = r.skipped > 0 ? ` (${r.skipped} skipped — referenced a room/controller not on this instance)` : '';
      toast.show({ title: `Imported ${summary}${skipNote}`, variant: r.skipped > 0 ? 'error' : 'success' });
    } catch (err) {
      toast.show({ title: 'Schedule import failed', description: (err as Error).message, variant: 'error' });
    }
  }

  return (
    <section className="section schedule-section">
      <div className="schedule-header">
        <h2>Schedule</h2>
        <div className="schedule-header-actions">
          <Button variant="secondary" size="sm" onClick={() => triggerDownload(SCHEDULES_EXPORT_URL)}>
            Export
          </Button>
          <ImportButton label="Import" size="sm" onFile={handleImport} />
        </div>
      </div>
      {/* One unified list: recurring schedules and specific-date entries, one
          "New schedule" form (recurring days OR a specific date). */}
      <ScheduleManager />
    </section>
  );
}
