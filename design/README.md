# Handoff: uber-wled Reskin (v2.0.0)

## Overview
This is a **reskin** of the existing uber-wled web UI — a new dark-first (with light mode) look and
feel. **All current functionality must be retained.** uber-wled already has working features (device
control, effects, segments, presets, schedules, audio, **firmware updates**, and more) wired to real
data. This package does **not** change behavior, data flow, or the API — it defines the **visual
language** to apply across every existing screen, including screens not mocked here.

Think of this as a design system + component skin, not a spec to rebuild the app. Where a screen
exists in uber-wled but isn't shown here (e.g. firmware update, network/Wi-Fi setup, usermod config,
LED hardware settings), **reskin it by composing the same primitives** documented below — same tokens,
same card/row/toggle/button recipes — so it looks native to the new design without altering what it does.

## About the Design Files
The files in this bundle are **design references authored in HTML/Canvas** — a working prototype of
the target look and behavior. They are **not production code to copy in**. Use them to read exact
colors, spacing, type, motion, and interaction feel, then apply that styling within uber-wled's
existing codebase and components.

How to view:
- Open `Uber-WLED Prototype.dc.html` in a browser (loads `support.js` from the same folder). It's
  fully interactive against mock state — nav, theme toggle, sliders, segment drag handles, the device
  color wheel, save-preset flow.
- `Reference — 4 Directions.dc.html` is the earlier exploration board, for context only.

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii, and interaction behavior are all final and
present in the prototype. Match them faithfully.

## Guiding principle for the reskin
1. **Preserve every existing feature and flow.** Only presentation changes.
2. **Theme with CSS variables** (below) so dark/light is a single switch and future tweaks are central.
3. **Reuse a small set of component recipes** for consistency across mocked *and* un-mocked screens.
4. **Keep LED/effect previews on dark housings** in both themes so glow reads like real light.

---

## Design Tokens

### Type
- **UI / display:** `Space Grotesk` (400/500/600/700).
- **Numeric / metadata / mono:** `IBM Plex Mono` (400/500/600) — IPs, px counts, %, BPM, hex, versions.
- Sizes: view title 19px/600; card title 14–15px/600; body 11–13px; metadata 10–11px mono;
  section labels 10px/600 uppercase, letter-spacing 1.5px.

### Color — themed via CSS custom properties
Set these on a root element via a `data-theme` attribute (`"dark"` default, `"light"`). Every surface,
border, and text color references a variable, so theming and future adjustments happen in one place.
LED preview canvases intentionally keep a **dark housing in both themes** (`#0c0c0e` / `#000`).

| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg` | `#0e0e11` | `#ebe9e4` | app background |
| `--rail` | `#08080a` | `#e3e1db` | left nav rail |
| `--panel` | `#18181c` | `#f5f4f1` | cards / panels (soft gray in light, not white) |
| `--toast` | `#1c2b26` | `#dbeee8` | toast background |
| `--text` | `#f4f4f6` | `#191a1c` | primary text |
| `--text2` | `#c9c9d0` | `#44464c` | secondary text |
| `--m1` | `#9797a1` | `#63656d` | muted |
| `--m2` | `#7a7a84` | `#7c7e88` | muted-er (inactive nav) |
| `--m3` | `#63636c` | `#9a9ca4` | faint labels |
| `--accent` | `#2ee6c0` | `#0c917a` | brand teal — **deeper in light for contrast** |
| `--w3 … --w28` | `rgba(255,255,255,.03–.28)` | `rgba(0,0,0,.035–.34)` | borders, tracks, chip fills, subtle surfaces |

- **LED / effect output colors are literal hex and NOT themed** — they represent real light:
  `#2ee6c0 #1f9bd6 #a855f7 #ff6b20 #ffb020 #ff2e93 #7c3aed #3d7bff`, etc.
- Text/icon on an accent fill: `#04140f`. Destructive: `#ff6b6b`. Warning/preview: `#ffb020`.
- Accent glow: `drop-shadow` in `rgba(46,230,192,.85 / .5)` (bright/dark), softer in light.

### Radius, shadow, motion
- Radii: chips 6–9px · controls 10–12px · cards 14–16px · modal 20px · pills/toggles fully round.
- Shadows: card `0 12px 40px rgba(0,0,0,.16)` · modal `0 24px 60px rgba(0,0,0,.5)`.
- Theme change fades `background-color/border-color/color` 0.35s ease on all elements.
- Toast: slide-up + fade (0.25s), auto-dismiss ~2.6s. LED previews animate on one shared rAF ~30fps.

---

## Component recipes (apply these everywhere, incl. un-mocked screens)

- **Nav rail item** (82px rail): centered icon + 9px label; active = `--accent` on
  `rgba(46,230,192,.12)` tint, radius 12px; inactive = `--m2`. Add new destinations (e.g. Firmware,
  Network) as more of these — same shape.
- **Lightbulb logo:** illuminated (accent + glow) when ≥1 controller is on; unlit gray when all off.
  Deeper accent + gentler glow in light mode.
- **Master bar:** view title + mono subtitle · click-to-set slider · status pill · sun/moon theme toggle.
- **Card / panel:** `--panel` bg, `1px solid var(--w6/w8)` border, 14–16px radius, 18–22px padding.
  Use for every settings block — a firmware-update card, a Wi-Fi card, etc. follow the same frame.
- **List row:** flex row in a `--panel` card: leading value/icon, title (`--text`) + sub (`--m2/m3`),
  trailing control (toggle / chevron / button). Reuse for schedules, device lists, settings lists.
- **Toggle:** 44×25 rounded track (`--accent` on / `--w12` off), 21px white knob, 0.2s.
- **Slider (click-to-set):** track `--w9`, accent fill to value, white knob; % readout in mono.
  fraction = `(clientX − trackLeft) / trackWidth` clamped 0–1.
- **Chip / segmented option:** 7–13px padding, 9px radius; selected = accent text on
  `rgba(46,230,192,.12)` + accent border; unselected = `--text2` on `--w5` / `--w9` border.
- **Primary button:** accent fill, `#04140f` text. **Secondary:** `--w6` fill, `--text2`, `--w10` border.
  **Destructive:** `#ff6b6b` icon/text. Use these three for any action, mocked or not
  (e.g. firmware "Install update" = primary; "Check again" = secondary).
- **Modal:** dim backdrop (`rgba(0,0,0,.55)` + blur), centered `--panel` sheet, 20px radius, big shadow;
  header with title + close ✕; click-backdrop-to-close. Use for deep controls, confirmations,
  firmware progress dialogs, etc.
- **Toast:** `--toast` bg, accent dot, `--text`; confirms actions, auto-dismisses.
- **Progress / status** (for firmware, uploads): reuse the slider track fill as a progress bar
  (accent fill over `--w9`); status text in mono with `--accent` (in-progress) / `--m3` (idle) /
  `#ff6b6b` (error).

## The LED preview renderer (reusable module)
A small canvas engine (prototype logic class: `paint`, `led`, `dot`, `hsl`, `hexToRgb`, `pal`) draws
each effect as a row of glowing dots. Effects: `rainbow gradient comet wave breathe chase sparkle
fire solid`, plus `audio` (bars) and `segmented` (many effects across one strip). Names/params mirror
WLED's model. Reuse it for any preview; for accuracy, feed it the controller's real per-segment state
rather than mock data.

---

## Screens shown here (as examples of the language)
Documented so you can match them exactly; treat as the reference set, then extend the same styling to
everything uber-wled already does.

- **Devices** — 2-col controller cards: name + chevron (opens deep control), IP·px, power toggle,
  live strip, click-to-set brightness, effect chip, ONLINE/OFF. Off dims the strip + mutes the label.
- **Effects (Browser)** — target multi-select column (each with a live mini-strip), large `PREVIEW`
  hero, Speed/Intensity/Palette controls, **Save as preset**, **Apply to N targets**, 3-col effect grid.
- **Segments (Editor)** — one strip split into zones each running its own effect; **draggable boundary
  handles**; Split/Merge; per-zone effect/color/brightness/on-off.
- **Presets & Scenes** — live-preview cards; **Save current look**; Apply to all; delete on user presets.
- **Schedule** — time/label/days/action rows with enable toggles; dashed "New schedule" add row.
- **Audio Reactive** — bars visualizer, source segmented control, sensitivity slider, per-device modes.
- **Device deep-control modal** — power, live preview, **conic color wheel** (click to pick hue live),
  palette row, effect chips, brightness — scoped to one controller.

## Screens NOT mocked — reskin guidance
For existing features without a mock (firmware update, network/Wi-Fi, LED/hardware config, usermods,
backups, about/info, etc.): keep their current logic and layout structure, and restyle using the
recipes above — cards for grouped settings, list rows for individual settings, the three button
styles for actions, the modal for dialogs, and the slider-as-progress-bar for firmware install
progress. A firmware screen, for example: a `--panel` card titled "Firmware", a mono version readout,
a primary "Install update" button, and a progress bar (accent fill) + mono status during install.

## State / behavior notes
No behavior changes. If convenient during the reskin, persist `theme`, master brightness, and last
active view (localStorage or existing settings store) so the chosen look sticks across reloads.
Everything else stays wired exactly as it is today.

## Files
- `Uber-WLED Prototype.dc.html` — full interactive prototype (open in a browser; needs `support.js`).
- `support.js` — prototype runtime (design tooling only; **not** for production).
- `Reference — 4 Directions.dc.html` — earlier exploration board.
- `README.md` — this document.
