# uber-wled Design

## Purpose

A self-hosted, LAN-only web app that acts as a unified controller for multiple
WLED devices around the house. It replaces per-device WLED web UIs with one
dashboard that shows a visual floorplan of where every light run physically
is, lets you control any combination of controllers/segments at once, and
automates them on a schedule.

## Scope

In scope for this design:
- Discovering and tracking WLED controllers on the LAN
- A visual floorplan editor for laying out light segments in their real
  physical position
- Reading and editing each controller's native WLED segments (including
  recommending/pushing new segment splits based on the drawn layout)
- Grouping segments/controllers (spatially or logically) for one-shot control
- Applying WLED presets or custom uber-wled themes to any selection
- Scheduling theme/group actions (fixed time or sunrise/sunset-relative)

Out of scope: cloud access, authentication/remote exposure, multi-user
support, integration with other smart-home hubs (none exist in this
household today).

## Architecture

Single Docker container:
- **Backend**: Node.js + TypeScript, Express. Owns all communication with
  WLED devices (their local JSON API — `/json/state`, `/json/info`,
  `/json/state` segment writes), mDNS discovery, scheduling, and SQLite
  persistence.
- **Frontend**: React (Vite) SPA, served by the backend. Floorplan canvas,
  device/segment list views, group/theme/schedule management.
- **Storage**: SQLite file in a mounted volume. No external DB dependency.
- **Discovery**: mDNS/Bonjour scan (`_wled._tcp`) on startup and on a
  periodic interval, merged with a manually-maintained list of IPs/hostnames.
  Manually-added devices are never removed by a re-scan; auto-discovered
  devices that disappear are marked stale, not deleted.
- **Network**: LAN-only. No auth, no HTTPS termination — relies on the home
  network's own perimeter. No cloud dependency of any kind.

## Data Model

- **Controller**
  - `id`, `name`, `host` (IP or hostname), `source` (`discovered` | `manual`)
  - Live-fetched (not persisted as truth): WLED `info` (version, LED count)
    and current `state` (on/off, brightness, active segments)
- **Segment**
  - Mirrors a WLED device's native segment: `controllerId`, WLED `segId`,
    LED start/stop, length
  - Read live from the controller by default; editable through uber-wled,
    which writes changes back to the device via its JSON API (`seg` array)
  - Not a duplicate source of truth — if the device's segments change
    outside uber-wled (e.g. via WLED's own UI), the next read reflects that
- **Floorplan**
  - Uploaded image, plus a stored crop/rotate/zoom transform
- **Placement**
  - A segment's multi-point path on a floorplan: ordered list of `{x, y}`
    points (bend points included, so a straight run is just two points),
    plus the segment's physical length/LED density for rendering
  - One segment has at most one placement per floorplan
- **Group**
  - Named set of segment references (cross-controller), used as the target
    for multi-select actions, scenes, and schedules
- **Theme**
  - Either a reference to a WLED built-in preset (by controller + preset id),
    or a custom uber-wled theme: `{ effect, palette, color(s), brightness }`
    stored independently of any device and applied as a direct state write
- **Schedule**
  - Trigger (`cron` expression, or `sunrise`/`sunset` with an offset and a
    stored lat/long) + target Group + Theme/action to apply

## Layout Editor

1. Upload a floorplan image.
2. Basic in-app editing: crop, rotate, zoom — no annotation/layers beyond
   that; any wall labeling or content editing happens externally before
   upload.
3. Draw each segment as a multi-point path tracing its real run (click to
   place bend points, e.g. around a roofline or deck rail corner).
4. Link the drawn path to a controller + WLED segment id. Length/LED count
   comes from the live device read; you can override it if the physical
   length doesn't match what WLED reports.
5. **Segment recommendation**: if the drawn geometry implies a split the
   device doesn't currently have (e.g. two distinct wall runs drawn where
   WLED has one long segment spanning both), uber-wled flags the mismatch
   and offers to push a segment split/resize to the device. This is always
   a user-confirmed action — uber-wled never rewrites device segment config
   silently.

## Multi-Select & Control

- Select any combination of segments — via marquee/click on the floorplan,
  or from a flat list view (useful before any floorplan is drawn, or for
  controllers not yet placed).
- Apply to the full selection in one action: power, brightness, WLED preset,
  or custom theme.
- Save a selection as a Group for reuse in scenes and schedules.

## Error Handling

- A controller that's unreachable (discovery ping fails, or a control write
  times out) is shown greyed-out/stale on the floorplan and in lists — it
  never blocks rendering or acting on the rest of the selection.
- Batch writes (theme/group apply) are per-controller: each write is
  attempted independently, retried once on failure, and failures are
  reported per-controller rather than failing the whole batch.
- Segment writes (split/resize) are not retried automatically — a failed
  segment write is surfaced immediately since it changes device config, not
  just transient state.

## Testing

- Unit tests: WLED API client (request building, response parsing), segment
  recommendation/matching logic, scheduler trigger calculation (cron and
  sunrise/sunset math).
- Integration tests: backend routes against a mocked WLED HTTP API (fixed
  fixture responses) — no real hardware required in CI.
- No end-to-end hardware-in-the-loop testing in this design; manual
  verification against real controllers happens during development.
