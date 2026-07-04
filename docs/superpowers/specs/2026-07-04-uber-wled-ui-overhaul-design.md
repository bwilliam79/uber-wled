# uber-wled UI/UX Overhaul Design

This supersedes the frontend information architecture and the floorplan layout
approach from the base design in
[2026-07-04-uber-wled-design.md](2026-07-04-uber-wled-design.md). It keeps all
backend logic built to date (discovery, segments, groups, themes, control,
scheduler engine, calendar/holidays, firmware release-checking, WLED schedule
import) and reworks how the app is structured and used.

Motivation: the shipped UI stacked every panel onto one scrolling Dashboard
screen — no navigation, no information architecture. The scheduling calendar
that was asked for was built only as backend data + forms, never as a visual
calendar. The floorplan-image approach (upload a house image, place strips on
it) is being dropped in favor of an imageless spatial canvas.

## Scope

In scope:
- A left-sidebar app shell with seven focused sections
- Replacing the floorplan-image layout with a freeform LED-strip canvas that
  doubles as the primary control surface
- A real month-calendar view for the Schedule section
- A dedicated Firmware section, with stable-release-only filtering by default
- A new Settings section for global toggles/values that currently have no UI
- Moving the existing Controllers / Groups / Themes CRUD onto their own screens

Out of scope: any change to the WLED device communication layer, the scheduler
engine's trigger logic, the holiday seed data, or the firmware pin/OTA
mechanism — those are reused as-is. No auth/remote-access changes (still
LAN-only). No mobile-specific layout beyond keeping the sidebar collapsible.

## Removals (floorplan gutting)

Remove entirely:
- `server/src/floorplans/` (repository + routes) and the `floorplans` table
- Floorplan image upload (the multer wiring for it) and the on-disk image
  storage under the data volume
- `client/src/pages/FloorplanEditor.tsx`, `client/src/components/FloorplanCanvas.tsx`,
  and the floorplan upload UI added to the Dashboard
- The crop/rotate/zoom metadata fields

The `placements` concept is reshaped rather than removed (see Data Model).
`multer` can be dropped from `server/package.json` if nothing else uses it
after removal (verify at implementation time).

## App Shell — Left Sidebar Navigation

A persistent left sidebar lists seven sections, one active at a time; the
selected section renders in the main content area to its right.

Sections, in order: **Layout, Controllers, Groups, Themes, Schedule,
Firmware, Settings.**

- **Layout is the default route** (the app opens here) because it is the
  everyday control surface, not just a setup screen.
- The active section is visually highlighted (accent green). Each item has an
  icon + label. The sidebar collapses to icons-only on narrow viewports.
- Client-side routing selects the section. A lightweight routing approach
  (React Router, or a minimal state-based view switch consistent with the
  existing codebase's no-router pattern) is acceptable — the implementation
  plan will pick one; the requirement is one screen visible at a time with
  the section reachable/refreshable, not a specific router library.

## Layout Section (the new hero screen)

A single blank dark canvas representing the whole house (no uploaded image).

- **Strips**: each LED strip is drawn as a multi-point path (click to place
  bend points, so corners and rooflines are traced faithfully; a straight run
  is just two points). Strips are draggable to reposition after drawing.
- **Hardware binding**: creating a strip assigns it to a real controller +
  WLED segment id. The controllers being laid out are the discovered/manual
  controllers already in the system. A strip's on-canvas color reflects its
  live state where practical.
- **Room labels**: loose, draggable text tags (e.g. "Kitchen", "Living
  Room") for light visual grouping. They are labels only — not rigid
  containers, not tied to Groups.
- **Selection + control**: click a strip to select it, or drag a marquee box
  to select several. A **control panel docked on the right** is always
  visible and acts on the current selection: power on/off, brightness, apply
  a WLED preset or a custom theme. Selected strips are visually emphasized
  (glow/highlight). With nothing selected, the panel shows a neutral empty
  state.
- **Toolbar**: a "Draw strip" action to enter draw mode, and the current
  selection count.

The Layout screen is expected to need more visual iteration than the other
screens after first implementation — freehand path drawing is inherently
harder to get right than CRUD, and the user intends to refine it live.

## Schedule Section

Month-grid calendar as the hero, with a right-side detail panel.

- **Calendar grid**: standard month view with weekday headers and
  prev/next/today navigation. Each day cell shows chips for calendar events
  that fall on it: holidays (muted when unconfigured/disabled, accent-colored
  when enabled) and custom events. An "+ Event" action creates a custom
  calendar event.
- **Selected-day panel** (right): shows the selected day's calendar event
  detail — its theme/action, trigger time (fixed or sunset/sunrise ±offset),
  target group — and flags when an enabled event overrides that day's weekly
  schedule. Below that, the panel lists the **weekly recurring schedules**
  (day-of-week/cron → group → action), each editable.
- Both weekly schedules and calendar events reuse the existing backend
  (schedules + calendar_events tables, the scheduler engine's override
  logic, and the holiday conflict guard). The preview-before-save flow
  (snapshot live state → apply → approve reverts + saves, or discard reverts)
  is retained in the event/schedule editors.

## Firmware Section

A dedicated screen listing every controller with its firmware status at a
glance, answering "is there an update?" quickly.

- Per controller: name, installed version, latest **stable** version, and an
  update indicator when a newer stable release exists.
- **Stable-only by default**: the GitHub release check filters out any
  release GitHub flags as a pre-release (this covers nightlies, betas, and
  release candidates). This is controlled by a Settings toggle (default
  off = stable only). When the toggle is on, pre-releases are included and
  the UI indicates that a shown version is a pre-release.
- The existing pin-once asset picker (first update per controller lets you
  choose the correct release asset for the board, remembered thereafter) and
  the OTA push flow are retained unchanged.

## Settings Section (new)

Home for global configuration that currently has no UI:

- **Include pre-release firmware builds** — boolean, default false. Drives
  the Firmware section's release filtering.
- **Home latitude / longitude** — used to compute sunrise/sunset times for
  schedules and calendar events that trigger relative to sunset/sunrise.
  Today these values are per-record fields with no UI to set them; a single
  global default fills that gap. (Per-record override may remain in the
  editors, but Settings provides the default.)
- **Discovery re-scan interval** and a manual "Re-scan now" action.
- **Default "disable on device" for schedule import** — the default state of
  that checkbox when importing a controller's WLED schedules.

Settings are persisted server-side (a small `settings` key/value table, or an
equivalent single-row settings table) and exposed via a settings API the
frontend reads on load and writes on change.

## Controllers / Groups / Themes Sections

The existing functionality, each relocated onto its own focused screen:

- **Controllers**: list discovered + manual controllers (with stale
  indicators), add a manual controller, remove one, and trigger the one-time
  WLED schedule import per controller.
- **Groups**: list groups; create a group; edit membership (add/remove
  controller+segment members via the existing member editor).
- **Themes**: list custom themes; create one (effect/palette/color/
  brightness); delete one.

No behavioral change to these beyond living on dedicated routes and adopting
the shared shell/navigation.

## Data Model Changes

- **Drop** the `floorplans` table.
- **Reshape `placements`** into an imageless strip layout. Each strip row:
  `id`, `controllerId`, `wledSegId`, `points` (JSON array of `{x, y}` in
  canvas coordinate space), optional `label`. No `floorplan_id`, no
  `length_meters` requirement (length can be derived from the segment if
  needed later). All strips live on one shared canvas.
- **Add `room_labels`**: `id`, `name`, `x`, `y` — draggable text tags on the
  canvas.
- **Add settings storage**: a `settings` table (single-row, or key/value)
  holding the Settings-section values above.
- Segment split recommendations (drawing two strips onto the same physical
  segment) continue to work against the reshaped strips.

## Error Handling

- Unreachable controllers render their strips greyed/stale on the canvas and
  are shown stale in the Controllers/Firmware lists; they never block the
  rest of the UI. Consistent with the base design.
- Settings writes that fail surface an inline error and leave the prior value
  in place rather than silently dropping the change.
- The firmware release fetch falls back to the last cached release list on
  GitHub API failure (retained from the firmware design), and the
  stable-only filter is applied to whatever list is available.

## Testing

- Component tests for the new shell/navigation (correct section renders,
  active state), the Layout canvas (strip renders per placement, selection
  toggling, control panel acts on selection), the calendar (events render on
  correct days, selected-day panel reflects the day), the Settings forms
  (reads initial values, writes changes), and the Firmware list (update
  indicator reflects stable-vs-pre-release per the toggle).
- Backend tests for the settings API (read/write, defaults) and the
  stable-release filter (a release list mixing stable and pre-release entries
  yields only stable when the toggle is off, all when on).
- Existing backend tests for unchanged subsystems remain; tests tied to the
  removed floorplan code are deleted along with it.
- No hardware-in-the-loop testing, consistent with the base design.
