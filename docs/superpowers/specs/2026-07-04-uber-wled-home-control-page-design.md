# uber-wled Home (Control) Page Design

This supersedes the "Layout is the default route" decision from
[2026-07-04-uber-wled-ui-overhaul-design.md](2026-07-04-uber-wled-ui-overhaul-design.md).
That design conflated two different jobs in one screen: drawing/arranging the
spatial canvas (a setup task) and day-to-day control (an everyday task). This
splits them — Layout keeps the canvas, a new Home section becomes the
everyday control surface and the default route.

## Motivation

User feedback after using the deployed app: the Layout canvas works for
laying out strips, but there's no page built for "just control what's already
configured" — the thing you'd actually open every day. The user wants to
control by room/area, not by hunting for the right strip on a spatial canvas
or by remembering which Group does what.

## Scope

In scope:
- A new **Home** sidebar section, first in the list, default route
- One control tile per **Group** (an existing Group already IS a room/area or
  scene for this purpose — no new "room" concept)
- One control tile per controller not in any Group ("Ungrouped" area)
- Per-tile: live on/off + brightness status, power toggle, brightness slider,
  a quick theme-apply dropdown, offline indication
- Reusing the existing `applyControl` control API and the existing
  `getSegmentsSnapshot` live-polling pattern already used by Layout

Out of scope (explicitly deferred):
- Any new "Room" data model — Groups are reused as-is
- Effects/presets beyond the theme dropdown (full effect/palette editing
  stays in Themes and the Layout control panel)
- Multi-select across tiles (a tile's Group membership already IS the batch
  — there's no cross-tile selection need)
- General visual/spacing polish ("things feel chunky") raised in the same
  conversation — the user asked to address that separately later, not as
  part of this page. Worth a follow-up design pass once Home ships and there
  are two contrasting screens (list-heavy sections vs. tile-heavy Home) to
  compare against.
- Changing what Layout does today — it is unchanged, just no longer the
  default route

## Navigation

Add `'home'` to `SectionKey` in `client/src/components/Sidebar.tsx`, first in
the `SECTIONS` array, with its own icon (a house glyph, added to
`icons.tsx`). `AppShell`'s `DEFAULT_SECTION` changes from `'layout'` to
`'home'`. `sectionFromHash()`'s fallback follows the same change. No other
section's behavior changes.

## Tile model

A tile is built from:
- **Group tiles**: one per existing Group, using its `members:
  {controllerId, wledSegId}[]`. Tile name = Group name.
- **Ungrouped tiles**: one per controller that is not a member of any Group
  (checked against every Group's member list, not just strips/canvas
  bindings). Tile name = controller name. Internally treated as a
  single-member "pseudo-group" of `{controllerId, wledSegId: 0}` — safe
  because the existing `power`/`brightness` control actions already operate
  on the whole device (`setState(host, {on/bri})`) regardless of
  `wledSegId`; only the `theme` action patches a segment, and it already
  defaults to segment 0 with no `id` specified, matching current Layout/
  Group behavior for single-segment devices.

Rendering order: Group tiles first (alphabetical by name, consistent with
how Groups/Controllers already list), then a visually distinct "Ungrouped"
subsection for loose controllers.

## Tile content & interactions

Each tile is a card (reusing the existing `.card` styling) showing:

1. **Header row**: tile name, offline badge if any member is unreachable
   (reusing the existing `.badge.badge-stale` treatment).
2. **Status line**: an on/off indicator and brightness. If reachable members
   disagree on power state, show "Mixed" instead of picking one. Brightness
   is the average across only the reachable members that are currently on
   (members that are off don't pull the average down); if no reachable
   member is on, brightness shows blank/dash rather than 0.
3. **Controls**:
   - Power toggle (On/Off), sends `{type: 'power', on}` to all of the
     tile's members via `applyControl`.
   - Brightness slider (0–255), sends `{type: 'brightness', value}` on
     change (debounced/on-release, matching the existing `ControlPanel`
     slider behavior) to all members.
   - Theme dropdown: a `<select>` listing saved Themes, applies immediately
     on change (`{type: 'theme', themeId}`) — no separate confirm button,
     consistent with "quick access" being the point of this page.

Offline members are excluded from the status aggregation (on/off/brightness)
but actions are still attempted against every member — `applyToMembers`
already isolates per-member failures and retries once, so this needs no
server-side change.

An empty Group (no members) renders its tile with controls disabled and a
small hint ("Add members in Groups") rather than sending no-op actions.

## Live status data flow

While Home is the active section:
- Collect the distinct set of controller IDs across all tiles (Group members
  + ungrouped controllers).
- Poll `getSegmentsSnapshot(controllerId)` for each, every 5 seconds — the
  same client function and interval `LayoutSection` already uses for live
  strip colors. No new backend endpoint.
- Each tile recomputes its aggregate on/off/brightness from the relevant
  segment(s) of its members' latest snapshots.
- Polling starts on mount and stops on unmount (leaving Home), matching
  `LayoutSection`'s existing `useEffect`/`setInterval`/cleanup pattern
  exactly.

This intentionally does **not** use the 5-minute `controller_status`
background cache added earlier this session — that cache is for
infrequent "did the config drift" reads, not a screen the user is actively
watching and expecting near-live feedback from. The two mechanisms coexist
without touching each other.

## Empty states & edge cases

- **No controllers and no groups**: Home shows a single empty-state message
  pointing at Controllers ("Add a controller to get started").
- **Controllers exist, no groups yet**: Home shows only the Ungrouped
  section, plus a banner suggesting Groups for room-based control (does not
  block using the ungrouped tiles in the meantime).
- **A member controller goes offline mid-session**: its next poll simply
  stops contributing to the aggregate; the tile shows the offline badge and
  keeps showing the other members' state.
- **Group has zero members**: see above — inert tile with a hint, not a
  broken/empty-looking control.

## Testing

Client-only change; no server code involved.

- Unit tests for the tile-aggregation logic (mixed on/off, brightness
  averaging, offline-exclusion, empty-group inert state) — pure functions,
  testable without rendering.
- Component tests for the Home section: renders one tile per Group plus
  Ungrouped tiles, power/brightness/theme interactions call `applyControl`
  with the expected members and action payload (mirrors existing
  `ControlPanel.test.tsx` assertions), offline badge appears when a member
  is unreachable.
- Reuse the existing fetch-stubbing conventions already used throughout
  `client/src/test/`.

## Rollout

Single implementation pass — this is additive (new section + new
components), doesn't touch existing Layout/Groups/Themes code paths besides
the sidebar/AppShell routing change, and has no backend component. No
migration risk.
