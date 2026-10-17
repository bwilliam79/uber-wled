/**
 * Noon local time on the day after `appliedAt`. A holiday theme applied at
 * sunset therefore survives the night and the next sunrise; an ambient
 * schedule can take the controller back at the following sunset.
 */
export function calendarLookExpiresAt(appliedAt: Date): string {
  const exp = new Date(appliedAt.getTime());
  exp.setDate(exp.getDate() + 1);
  exp.setHours(12, 0, 0, 0);
  return exp.toISOString();
}
