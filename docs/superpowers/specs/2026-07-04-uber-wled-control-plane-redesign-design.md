# uber-wled Control Plane Redesign

This supersedes the frontend information architecture of
[2026-07-04-uber-wled-ui-overhaul-design.md](2026-07-04-uber-wled-ui-overhaul-design.md)
and the Home page design of
[2026-07-04-uber-wled-home-control-page-design.md](2026-07-04-uber-wled-home-control-page-design.md).
All backend domain logic built to date (discovery, groups, themes, scheduler
engine, calendar, firmware release-checking/OTA, WLED schedule import, status
poller) is kept and extended — nothing about device communication is thrown
away, only widened.

## North star

uber-wled becomes a full replacement for both the WLED native web UI and the
WLED phone app, but multi-controller-first: select any mix of rooms, devices,
or segments and get the complete WLED control surface applied to all of them
at once. Long-term goal (explicitly out of scope this round): replace WLED's
UDP sync entirely — the app is the sync. This round must therefore never
*fight* existing UDP sync: every fan-out write sends WLED's per-request
no-notify flag (`udpn: { nn: true }`) so commands don't echo through sync
groups.

User decisions locked in:

- **Full config parity** — including WiFi and GPIO/hardware, with guardrails.
- **Palettes: browse built-ins only** — rich previews, no custom palette builder.
- **Full UI redesign** — new design system, rebuilt navigation, all sections.
- **Responsive both ways** — phone and desktop are both first-class.
- **Visual: sleek smart-home** — deep dark surfaces, glow accents that pick up
  the lights' actual colors, rounded cards, big touch sliders.
- **Layout canvas: rebuild it better** (functional rework, not just restyle).
- **UDP sync**: user currently uses it; do not build sync-group features —
  goal is replacement. Use `nn` on writes to coexist peacefully.

## Verified device facts (probed live on 192.168.1.86, WLED 16.0.0 "Niji")

- `/json/eff` → array of 220 effect names (index = effect id).
- `/json/pal` → array of 72 palette names (index = palette id).
- `/json/fxdata` → array of per-effect metadata strings, format
  `<sliders>;<colors>;<palette>;<flags>;<defaults>` where sliders is a
  comma list labeling sx, ix, c1, c2, c3 and up to three checkbox options
  (o1–o3), `!` = default label, empty = control hidden. Colors section labels
  the up-to-3 color slots; palette section non-empty means the effect uses a
  palette; flags carry dimensionality (`0`/`1`/`2`) and audio (`v`/`f`);
  defaults look like `sx=24,m12=0`.
- `/json/palx?page=N` → `{ m: <maxPage>, p: { <palId>: <stops> } }` where
  stops is either an array of `[pos, r, g, b]` gradient stops, or an array of
  `"r"` entries (randomized palette), or entries like `"c1"`/`"c2"`/`"c3"`
  (palette derives from the segment's color slots).
- `/json/cfg` → full device config (identity, `nw` WiFi, `ap`, `hw.led.ins`
  GPIO outputs with pin/order/type/reverse/skip, power limits, `if` sync/live
  interfaces, time, usermod settings `um`, defaults). Writable via POST of a
  partial patch to `/json/cfg`.
- State per segment: `id,start,stop,grp,spc,of,on,frz,bri,cct,set,n,
  col[3][4],fx,sx,ix,pal,c1,c2,c3,sel,rev,mi,o1,o2,o3`. Device is RGBW
  (`info.leds.rgbw`, per-segment `lc` light capabilities bitmask: 1=RGB,
  2=white, 4=CCT). Top-level state: `on,bri,transition,ps,pl,nl{on,dur,mode,
  tbri,rem},udpn{send,recv,sgrp,rgrp},lor,mainseg`.
- Presets: read `/presets.json` (id → object with `n` name, optional
  `playlist`). Save = POST `/json/state` `{ psave: id, n: name, ib: bool,
  sb: bool }`; delete = `{ pdel: id }`; apply = `{ ps: id }`.
- Reboot: POST `/json/state` `{ rb: true }`.
- Usermods present on real hardware (AudioReactive) — config parity must
  tolerate unknown `um` keys.

## Navigation & information architecture

Seven sections: **Home · Layout · Devices · Themes · Schedule · Firmware ·
Settings.** Home is the default route.

- **Groups stop being a section.** A "room" tile on Home *is* a group; rooms
  are created/renamed/re-membered inline from Home's edit mode. The
  `groups` tables and APIs stay (schedules/calendar reference them); only the
  standalone GroupManager screen goes away.
- **Controllers becomes Devices** and grows per-device depth (below).
- Desktop: left sidebar (icons + labels, collapsible). Phone: bottom
  navigation bar with the same seven items (icon-only, labels on active).

## The Control surface (shared component, the heart of the app)

One component, three entry points: Home tile selection, Layout canvas
selection, Devices "control" button. Opens as a right slide-over panel
(~480px) on desktop, a full-height draggable bottom sheet on phone.

**Targets model:** a selection is a list of targets, each either a whole
controller or a (controller, segment) pair (group members are segment pairs).
Header shows removable target chips.

**Always-visible header:** master power toggle, master brightness slider,
transition duration, nightlight popover (on/off, duration, mode, target
brightness), and a live "Mixed" chip anywhere targets disagree (power,
brightness, effect, palette). Mixed controls are write-only: they show a mixed
indicator until the user sets a value, which is then fanned out.

**Tabs:**

1. **Colors** — iro.js color wheel; selector for the 3 color slots (labeled
   per the selected effect's fxdata color labels; unused slots hidden); hex
   input; RGB sliders; white-channel slider shown when any target is RGBW;
   CCT slider when supported; kelvin quick-presets (2700K/3500K/5000K/6500K);
   recent colors (localStorage, last 12).
2. **Effects** — search box + list of all effects (name, id, badges for 2D /
   audio-reactive from fxdata flags). Selecting an effect reveals its dynamic
   controls parsed from fxdata: speed/intensity sliders with their real
   labels, custom sliders c1–c3 and checkbox options o1–o3 only when the
   effect defines them, each with its fxdata label.
3. **Palettes** — search box + rows with real gradient previews rendered as
   CSS linear-gradients from `/json/palx` stops. Special palettes render
   sensibly: randomized ones show a "randomized" badge over a shuffled
   preview, color-slot ones show the current slot colors.
4. **Presets** — saved uber-wled Themes always listed. Device presets and
   playlists listed when the selection resolves to a single controller
   (multi-controller preset apply is meaningless since ids are device-local).

**Multi-device semantics:** effects and palettes are resolved **by name per
device** through the capability cache, so devices on different firmware
apply the same-named effect even if ids differ; devices lacking the name
report a per-target "not supported" failure without failing the batch.
Controller-level targets patch all of that controller's segments; segment
targets patch just their segment. Every write includes `udpn: { nn: true }`,
uses per-target isolation with one retry (existing pattern), and returns an
aggregate per-target result the UI surfaces non-modally (toast with a
"details" expansion listing failures).

**Live feedback:** while the Control surface (or Home, or Layout) is open, the
client subscribes to the SSE live-state stream (below); slider drags are
locally optimistic and throttled to ≤ 4 writes/sec per control.

## Server additions

### WLED client v2 (`server/src/wled/`)

Add: `getEffects`, `getPalettes`, `getFxData`, `getPalettePreviews`
(paginate `palx` until `m` reached), `getConfig`, `patchConfig`,
`getFullState` (`/json` combined), `savePreset`, `deletePreset`, `reboot`,
`setNightlight`, plus a widened `setState` accepting the full documented
state/segment field set. Parsers for fxdata and palx live here with unit
tests (they are the fiddliest pure logic in this project).

### Capability cache

New table `controller_capabilities(controller_id PK/FK, vid INTEGER,
effects TEXT, palettes TEXT, fxdata TEXT, palette_previews TEXT,
fetched_at TEXT)`. Refreshed lazily: whenever the status poller (or an
on-demand fetch) sees `info.vid` differ from the cached `vid`, re-pull all
five datasets. Exposed as `GET /api/controllers/:id/capabilities`. The
Themes form and the Control surface read from this cache — no more "first
reachable controller" live-fetch pattern.

### Control fan-out v2

`POST /api/control/apply` (v2 body, replaces the action-union): targets
(controller ids, group ids, or {controllerId, wledSegId} pairs — server
expands groups) + an abstract patch: `{ on?, bri?, transition?, nl?,
seg? }` where `seg` may carry `fxName`/`palName` (resolved per device) or
raw ids, `col`, `sx`, `ix`, `c1..c3`, `o1..o3`, `cct`, plus segment-shape
fields. Existing v1 action route stays until the scheduler engine and
calendar are migrated onto v2 (they are in-scope to migrate; v1 is then
deleted).

### Live state stream

`GET /api/live?controllers=id1,id2` → SSE. The server keeps a refcounted
fast-poll session per controller (default every 2s, configurable in
Settings): while at least one SSE subscriber watches a controller, poll
`/json/state` (+ `/json/info` every 10th tick) and emit
`{ controllerId, reachable, state, info? }` events; when the last
subscriber disconnects, the session stops. The existing 5-minute background
poller is unchanged and remains the source for glanceable data when no one
is watching. The Layout canvas's private 5s poller is replaced by this
stream.

### Device management routes

- `GET /api/controllers/:id/presets` / `POST .../presets` (save current
  state, body: name/id/includeBrightness/saveSegmentBounds) /
  `DELETE .../presets/:presetId`.
- `GET /api/controllers/:id/config` → proxied cfg.json.
- `POST /api/controllers/:id/config` → body `{ patch }`; server echoes back
  a computed flat diff (old → new per changed path) when the client asks for
  a dry-run (`?dryRun=1`), applies otherwise. No server-side field
  restrictions (full parity was chosen) — safety is a client-side concern.
- `POST /api/controllers/:id/reboot`.
- Segment CRUD already exists; widen to the full field set (grp, spc, of,
  rev, mi, name, on, bri).

## Devices section

List view: one card per controller — name, host, firmware version chip,
live wifi signal bars, FPS, power state, uptime, stale/offline badge,
update-available badge, "Control" button (opens Control surface targeting
it), link to detail.

Detail page tabs:

1. **Info** — identity, IP/mac, version + build, arch, uptime, wifi
   signal/channel/bssid, FPS, free heap, filesystem usage, LED counts,
   usermods list. Peek: an embedded `http://<host>/liveview` iframe strip
   showing the actual live output (zero-cost, reliable; a websocket-proxy
   upgrade is a possible follow-up, not this round). Actions: reboot
   (confirm dialog), open native UI (new tab).
2. **Segments** — full editor: per segment start/stop (validated against
   `info.leds.count`), grouping, spacing, offset, reverse, mirror, name,
   per-segment on/brightness; create and delete segments. Applies live.
3. **Presets** — device presets + playlists with names/ids; apply, delete
   (confirm), and "Save current state as preset" (name + include-brightness
   + save-bounds checkboxes).
4. **Config** — full parity, structured forms for the high-traffic pages:
   **Identity** (name, mDNS), **LED & Hardware** (per-output GPIO pin, type,
   length, start, color order, reverse, skip; total count; max power;
   auto-white mode), **WiFi** (SSID, password write-only, static IP/GW/mask,
   AP fallback settings), **Sync interfaces** (UDP send/recv + groups, ports),
   **Time** (NTP, timezone, lat/lon), **LED preferences** (boot preset,
   transitions, gamma, brightness factor). Everything else (usermod settings,
   exotic sections) is editable through a raw JSON editor over the full cfg
   with the same diff-preview flow. **Guardrail:** every config save shows a
   diff-and-confirm modal (from the dry-run endpoint); WiFi/GPIO changes get
   an extra explicit warning naming the strand-the-device risk; saves that
   need a reboot surface a "Reboot now" follow-up instead of rebooting
   silently.
5. **Update** — the existing per-controller firmware pin/OTA flow, relocated
   here. The fleet-wide Firmware section remains for "update everything"
   overviews.

## Home

Tile grid: one tile per room (group) + one per ungrouped controller.
Tile: name, live on/off + brightness, dynamic glow — the tile's ambient
glow/accent is derived from the target's current segment colors (from the
live stream; muted when off, grey when offline). Quick controls on the tile:
power toggle and a brightness slider; tapping the tile body opens the
Control surface for that target.

Multi-select: long-press (touch) or hover-checkbox (desktop) enters select
mode; a floating action bar shows "N selected → Control" plus select-all.
Edit mode (single "Edit" button): create room, rename, delete, and assign
members (controller + segment picker) inline; drag to reorder tiles
(`sort_order`).

Schema: `groups` gains `icon TEXT` and `sort_order INTEGER NOT NULL DEFAULT
0` via the existing idempotent-column-add pattern.

## Layout canvas rebuild

Keep the data model (strips.points, room_labels) and live-color rendering;
rework interactions:

- **Drawing:** click-to-place vertices, Enter/double-click to finish, Esc to
  cancel, Backspace removes last vertex; Shift constrains to 45° angles;
  optional snap-to-grid toggle.
- **Editing:** select a strip → drag whole strip, or drag individual
  vertices; delete key removes selection (confirm).
- **Navigation:** wheel/pinch zoom, drag-empty-space or two-finger pan; a
  "fit all" button.
- **Selection → control:** click and marquee box-select strips (shift-click
  adds); the docked panel is replaced by the shared Control surface with the
  selected strips' (controller, segment) pairs as targets.
- Live colors come from the shared SSE stream. Room labels drag + inline
  rename as today, restyled.

## Restyled sections

- **Themes:** same data model; the form uses the capability cache — effect
  picker with search + palette picker with gradient previews + color slots +
  brightness. Themes list shows a preview swatch row.
- **Schedule:** calendar and forms restyled to the new system; behavior
  unchanged. Its theme preview flow now uses fan-out v2.
- **Firmware:** fleet view restyled; per-device flow also reachable from
  Devices → Update.
- **Settings:** restyled; adds "live poll interval (seconds)" (default 2,
  settings row + used by the SSE fast-poll sessions).

## Design system

Update `design-system/MASTER.md` to the "sleek smart-home" direction and
build tokens/components accordingly:

- Surfaces: near-black blue base (`#0B0F1A`), raised cards (`#131A2A`),
  soft 16–20px radii, subtle 1px borders (`rgba(148,163,184,0.10)`).
- Accent: electric indigo-violet (`#7C6CFF`) for interactive/brand; dynamic
  glows on tiles/strips use the lights' actual live colors.
- Typography: Plus Jakarta Sans, self-hosted via `@fontsource` (**no Google
  Fonts CDN — the app is LAN-only and must work with no internet**).
- Base component kit (plain CSS, no UI framework): Button, IconButton, Card,
  Tile, Slider (large touch target, colored track), Toggle, Tabs,
  SegmentedControl, SearchInput, Select, Modal, Drawer/BottomSheet, Toast,
  Chip/Badge, Field. All keyboard-accessible.
- New client deps: `@tanstack/react-query` (all server state, polling,
  optimistic updates), `@jaames/iro` (color wheel — same lib WLED uses),
  `@fontsource/plus-jakarta-sans`. No other UI deps.

## Testing & verification policy

- Unit tests: fxdata parser, palx parser, name-resolution, fan-out v2
  expansion/isolation, cfg diff builder, SSE session refcounting, tile
  status aggregation v2, control-surface mixed-state reducer.
- Client component tests follow the existing Vitest + Testing Library
  patterns (see the vitest-testing-gotchas skill for fetch-mock/timer
  traps).
- **Real-hardware rules for autonomous overnight work:** state-level
  operations (power, brightness, colors, effects, palettes) may be tested
  against real controllers *only* with capture-state-first /
  restore-state-after wrapping. Config writes, WiFi/GPIO changes, preset
  writes/deletes, reboots, and OTA pushes are **never** exercised against
  real hardware autonomously — they are covered by unit/integration tests
  with mocked devices.
- Browser verification of every section at desktop (1440px) and phone
  (390px) widths before deploy.

## Rollout

Phased implementation, one clean commit per phase (rollback-friendly),
pushed to `main` as phases complete. Version: this is the 1.0 milestone —
client and server both go to `1.0.0`; README rewritten to describe the new
IA. Deploy to media-server after full verification, then live-verify the
production instance in the browser.

Out of scope this round: custom palette builder, UDP-sync replacement
engine (the north star, not this round), websocket live-preview proxy,
playlist *editing* (apply/delete only), auth/HTTPS (still LAN-only by
design).
