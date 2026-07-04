# uber-wled Scheduling Engine Design

This extends the base design in
[2026-07-04-uber-wled-design.md](2026-07-04-uber-wled-design.md), replacing
its minimal `Schedule` model (cron / sunrise / sunset only) with a fuller
scheduling engine: weekly day-of-week schedules, a pre-populated US holiday
calendar, custom one-off/recurring calendar events, best-effort import of a
controller's existing WLED schedules, and live preview before saving.

## Scope

In scope:
- A `weekly` schedule trigger (days of week + time), alongside the existing
  `cron` and `sunrise`/`sunset` triggers
- A calendar of date-based events: pre-populated US holidays (federal +
  common decorating occasions) and user-created custom events (birthdays,
  anniversaries, one-off sporting events)
- Override-for-the-day precedence: an enabled calendar event suppresses
  overlapping weekly/cron/sunrise/sunset schedules for that date
- A conflict guard preventing a holiday and a custom event from landing on
  the same date while both enabled
- One-time best-effort import of a controller's existing WLED
  time-triggered presets into uber-wled `weekly` schedules, with an optional
  flag to clear them from the device afterward
- Live preview of a schedule/event's action against real devices before
  saving, with revert-to-prior-state on approve or discard

Out of scope: recurring custom events with complex recurrence rules beyond
"yearly on this month/day" (e.g. "every 2nd Tuesday" is not supported for
custom events — that's what the weekly trigger and holiday floating-date
rules already cover); timezone handling beyond the server's local timezone;
multi-user calendars.

## Data Model

### `Schedule` (extends the base design)

Adds a new trigger type and its fields:

```
triggerType: 'cron' | 'sunrise' | 'sunset' | 'weekly'
daysOfWeek: number[] | null   // 0=Sun..6=Sat, only set when triggerType='weekly'
timeOfDay: string | null      // "HH:MM", only set when triggerType='weekly'
```

`cronExpr`, `offsetMinutes`, `latitude`, `longitude` remain as in the base
design for the other trigger types. `weekly` is additive — cron stays
available for power users.

### `CalendarEvent` (new)

```
id: string
name: string
category: 'holiday' | 'custom'
dateRule:
  | { kind: 'fixed'; month: number; day: number }
  | { kind: 'nthWeekday'; month: number; weekday: number; n: number }      // e.g. 3rd Monday of January
  | { kind: 'lastWeekday'; month: number; weekday: number }                // e.g. last Monday of May
  | { kind: 'easterOffset'; offsetDays: number }                          // Easter itself is offsetDays: 0
  | { kind: 'oneOff'; year: number; month: number; day: number }          // non-recurring custom event
recursYearly: boolean          // false only for 'oneOff'
enabled: boolean
groupId: string | null         // null until configured
triggerTime:
  | { type: 'fixed'; time: string }        // "HH:MM"
  | { type: 'sunset' | 'sunrise'; offsetMinutes: number }
actionType: 'power' | 'brightness' | 'preset' | 'theme'
actionPayload: unknown
```

Preset holidays are seeded with `category: 'holiday'`, `enabled: false`,
`groupId: null`, and no action — inert until configured, per your call to
avoid surprise light changes. Seed list (federal + common decorating
occasions): New Year's Day, MLK Day, Valentine's Day, Presidents Day, St.
Patrick's Day, Easter, Memorial Day, Juneteenth, July 4th, Labor Day,
Columbus Day, Halloween, Veterans Day, Thanksgiving, Christmas Eve,
Christmas Day, New Year's Eve.

### Resolving a concrete date for a given year

A pure function `resolveDate(rule: DateRule, year: number): { month: number; day: number }`:
- `fixed`: returns `{ month, day }` as-is
- `nthWeekday`: finds the nth occurrence of `weekday` in `month`/`year`
- `lastWeekday`: finds the last occurrence of `weekday` in `month`/`year`
- `easterOffset`: computes Easter Sunday for `year` via the standard Computus
  algorithm, then adds `offsetDays`
- `oneOff`: only valid for its stored `year`; does not resolve for other years

## Precedence & Conflict Rules

**Override for the day:** when the scheduler's per-minute check finds today's
date matches an enabled `CalendarEvent`, it collects that event's group's
members. Any other enabled `Schedule` (any trigger type) whose target
group shares at least one member with those is skipped for today. The
calendar event's own trigger still fires normally. This means unrelated
lights (not in the event's group) keep running their normal schedule
unaffected.

**Conflict guard:** creating or enabling a `CalendarEvent` computes its
concrete date for the relevant year(s) and checks all other *enabled*
events of the opposite category (`holiday` vs `custom`) for the same
resolved date. If one exists, the write is rejected with `409` and the
conflicting event's id/name, so the UI can prompt you to disable one first.
Same-category events (two `custom`, or two `holiday`) may share a date —
this is how an "on at 5pm" / "off at 11pm" pair for one occasion is
modeled: two separate `CalendarEvent` rows, same category, same date.

## WLED Schedule Import

`POST /api/controllers/:id/import-schedules` with body `{ disableOnDevice: boolean }`:

1. Reads the controller's presets (`getPresets`-style call, extended to also
   pull each preset's raw schedule fields as WLED exposes them).
2. For each preset with a recognizable day/time schedule attached, creates a
   `weekly` `Schedule` (auto-creating a single-controller `Group` named
   `"<controller name> (imported)"` the first time this runs for that
   controller) whose action applies that preset (`actionType: 'preset'`).
3. Anything not parseable (unexpected/legacy schedule shape) is skipped and
   reported back, never silently dropped.
4. Returns `{ imported: Schedule[]; skipped: { raw: unknown; reason: string }[] }`.
5. If `disableOnDevice` is `true`, clears the schedule fields on each
   successfully-imported preset via the device's API so the device stops
   firing it independently. Defaults to `false` — off until you've verified
   the imported version in uber-wled, per your preference to keep this
   optional early on.

This is explicitly a one-time, best-effort starting point, not an ongoing
sync — WLED's schedule model has no holiday/exception concept, so there is
nothing to keep in sync going forward.

## Preview Flow

For both `Schedule` (weekly type, the one most worth eyeballing) and
`CalendarEvent` editors:

1. **Preview**: the client fetches each target member's current live state,
   holds it in memory as a snapshot, then calls the existing
   `/api/control/apply` with the configured action. Lights change
   immediately and stay changed.
2. **Approve**: the client calls `/api/control/apply` again with the
   snapshot as a restore action (per-member `on`/`bri`/`seg` state), then
   saves the schedule/event via its normal CRUD endpoint. The schedule
   itself does not fire immediately — it will fire for real the next time
   its trigger is due.
3. **Discard**: same revert-to-snapshot as Approve, but nothing is saved.

No backend changes are required for this beyond what Task 12 (control
apply) already provides — this is purely a frontend orchestration of two
existing calls plus a snapshot held in component state.

## Error Handling

- Import: a controller that's unreachable during import returns a single
  `503`-style error for the whole import call (there's nothing partial to
  report if the device can't be reached at all).
- Conflict guard rejections (`409`) include enough detail (conflicting
  event id, name, resolved date) for the UI to offer a "disable it and
  retry" action without a second round-trip to look it up.
- Preview revert failures (the restore call fails) surface as a visible
  error in the editor rather than silently leaving lights in the preview
  state — the user needs to know the lights may still be showing the
  previewed theme.

## Testing

- Unit tests: `resolveDate` for every `DateRule` kind (including Easter/
  Computus and nth/last-weekday edge cases like months with five vs four
  occurrences of a weekday), the override-suppression logic, and the
  conflict-guard date-collision check.
- Integration tests: calendar event and weekly-schedule CRUD routes; the
  import route against a mocked WLED preset response including at least
  one unparseable entry to verify it's reported in `skipped` rather than
  dropped.
- No hardware-in-the-loop testing, consistent with the base design.
