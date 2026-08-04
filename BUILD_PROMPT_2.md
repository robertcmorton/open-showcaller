# Build Prompt 2 — Real-World Milestone: import, role screens, live highlight, modern UI

> Continuation of [BUILD_PROMPT.md](BUILD_PROMPT.md) (all seven original phases shipped and live).
> This milestone makes the app work the way production crews actually work, informed by a set of
> real produced run sheets kept as **local-only** reference material (never committed). Follow the
> same rules as the original prompt: each phase ends runnable and browser-verified, protocol changes
> are versioned in `PROTOCOL.md`, the timing engine stays a pure tested module, and nothing
> vendor- or source-identifying reaches the repo — reference sheets are represented in-repo only by
> **synthetic fixtures with fictional content**.

## What the real sheets taught us (design inputs)

Three production house styles, all Excel-native, all sharing the same bones:

1. **Segment run sheet** — numbered timed items (`ITEM | TIME | DURATION | ACTION | WHO | WHAT`)
   where each item stacks multiple department cue lines (AUDIO / GFX / VTR / LED / MC / PA / CREW /
   PYRO…) inside it; key-times table up top; full-width milestone bars; red text = crew warnings.
2. **Presentation grid** — dense numbered grid (`# | TIME | DURATION | type | ACTIVITY | LOCATION |
   AUDIO | TRACK | SCREEN | LED | NOTES | #`), timed parent rows followed by untimed child cue rows,
   row numbers mirrored on both page edges, strong per-org color language, free-text durations
   ("3 mins", "1min 27 secs"), human errors in cells.
3. **Agency cue sheet** — anchor printed in the header, a **ZERO column counting down to the anchor
   on every timed row**, red **GO** markers per executable cue line, milestone bars, an untimed
   "during play" cue pool fired ad hoc, asset IDs on graphics, version number printed on the sheet.

Everything below either imports these documents faithfully or brings their conventions into the app.

## Phase 1 — Design system & UI modernization foundation

The current UI is functional scaffolding. Replace it with a real design system **before** building
new screens, so everything after lands beautiful by default.

- **Tokens:** spacing / radius / elevation scales; a dark theme as the primary show-surface theme
  (control rooms are dark) and a refined light theme for dashboard surfaces; semantic color roles
  (surface, raised, accent, positive/under, negative/over, warning, live-red) — no more ad-hoc hex.
- **Type:** a modern grotesque for UI (e.g. Inter), **tabular-figure monospace for every timing
  figure**, a deliberate type scale. Timing figures never jitter in width while ticking.
- **Components:** buttons (primary/ghost/danger), panels/cards, modals, dropdown menus, chips/tags,
  toggles, toasts, empty states, skeleton loading — one consistent set, used everywhere.
- **Motion:** 120–200 ms eased transitions for state changes (panel open, row insert, active-row
  move); a subtle pulse on the LIVE badge; `prefers-reduced-motion` respected.
- **Fold in the parked visual-parity items:** floating formatting toolbar over cell selection
  (bold/italic/underline/strike/highlight/link/clear), duration popover with Hide + Mute buttons,
  selection chips ("N selected · duplicate · delete · color"), per-user Columns show/hide menu
  (localStorage), time-of-day clock in the editor header, ⋯ overflow menu linking every view.
- Dashboard, editor, and all companion surfaces restyled on the new system. **Verify:** side-by-side
  before/after screenshots; every existing flow still works in-browser.

## Phase 2 — Role screens & gated access

Four distinct ways in, each a real screen with the right capabilities — enforced server-side, not
just hidden in the UI. Admin operates **across shows**; the other three are per-show.

| Screen | Route | Capabilities |
|---|---|---|
| **Admin** | `/admin` | Cross-show control room: every event and rundown in one place — create/rename/archive/duplicate events and rundowns, edit event details and key times, manage templates, issue/revoke join codes and guest passes for **any** show, see which shows are live right now with one-click jump into any of the other three screens for any rundown. The only screen that can change things across multiple shows. |
| **Showcaller** | `/show/[id]` | Full console for one show: transport (start/pause/prev/next/jump/stop), full editing, all panels (share, history, join codes, import/export), key-times editing, cue pool firing. |
| **Edit** | `/edit/[id]` | Full content editing (cells, rows, columns, colors, milestones) but **no transport controls and no share/admin panels**. Sees live position read-only. |
| **View** | `/view/[id]` | Read-only rundown grid: full document fidelity (colors, milestones, all visible columns), live position highlighted, personal column show/hide, font-size control, print. No editing affordances at all — not even disabled ones. |

- Join codes already carry roles (`caller` / `editor` / `follower`); add an **admin** role above
  them. A code entered on the landing page routes to the matching screen, and the **server enforces
  role on both channels** — transport commands rejected without caller role; the doc channel becomes
  **read-only for follower-role connections** (Hocuspocus `onAuthenticate` + readOnly flag) and
  rejects connections with no valid token when the rundown belongs to a protected event.
- The management API gets the same minimal token gating: mutating endpoints require editor-or-above
  for their own rundown, and the cross-show endpoints behind `/admin` require the admin role (this
  is the interim auth step; full accounts remain a later milestone and must not be designed out).
- Companion views (follow/timer/prompter/guest) are unchanged but linked from the ⋯ menu on all
  role screens. **Verify:** in-browser with four parallel sessions — editor-role session cannot
  start the show (server rejects, UI never offers), view-role session cannot type into a cell
  (server refuses the write), caller session does everything on its show but cannot touch another
  show, admin session edits two different shows and revokes a join code that a live session is
  using (that session drops to the landing page).

## Phase 3 — Run sheet import (XLSX / XLS / CSV / PDF upload)

One pipeline, four file types, ending in the same mapping preview.

- **Extract:** XLSX/XLS via a spreadsheet parser (SheetJS or exceljs); CSV via the existing core
  parser; **PDF via text-run extraction** (pdf.js): cluster text x-positions into column bands and
  y-positions into rows, drop repeated per-page header rows, skip blank spacer rows, join
  multi-line cells. No OCR — scanned PDFs get a clear "no text layer" error. Extraction runs
  client-side; nothing is stored until the user confirms.
- **Detect:** header row (fuzzy match against known header vocabulary: item/#, time, duration,
  action/activity, who/type, location, audio, track, screen, led, notes…), row types (timed item ·
  untimed child cue · **milestone** [time, no duration] · **section banner** [full-width text] ·
  spacer), and stacked department cues inside one visual row.
- **Map (the preview screen):** detected grid on the left, target on the right. User assigns each
  source column to a rundown column (or "skip"), confirms detected row types (milestone/banner
  chips shown inline), chooses how stacked child cues land (folded into department columns as
  multi-line content — child *rows* are future scope), and sees unparseable cells highlighted, never
  silently dropped. Import creates the rundown (or appends to an empty one) in a single doc
  transaction.
- **Tolerant parsing in `packages/core`** (pure, unit-tested): durations "3 mins", "1min 27 secs",
  "30 secs", "0:90:00", "08:00", "1:30", "15 seconds"; times "5:00:00PM", "6:00:00 pm", "16:00:00",
  "4:30pm", "0900"; whitespace/case noise; garbage → flagged, not crashed.
- **Fixtures:** three synthetic files in-repo (one per house style, fictional event content) as
  automated test fixtures for extractor + parsers; verify manually against the real local sheets
  (results noted in the local dev log only). **Verify:** import a synthetic PDF and a synthetic
  XLSX end-to-end in-browser; cascade recomputes correctly from imported anchors.

## Phase 4 — Rundown fidelity (the conventions crews already use)

- **Milestone rows:** first-class row type — a time (usually anchored) with no duration, rendered
  as a full-width banner bar; excluded from duration math; selectable in + Row menu and produced by
  the importer. Doubles as the section-banner style with no time.
- **Row colors:** per-row highlight from a curated palette (plus "clear"); visible in every surface
  including view/guest/print; stored in the doc; multi-select + color via selection chips.
- **Cue-type chips:** a default department/cue-type vocabulary (AUDIO, GFX, VTR, LED, PA, MC, GA,
  DJ, CREW, PYRO, LIGHTING, LIVE VSN, CAM, SUPER, TAKEOVER, SCORE, NOTE) available as quick chips
  in a "Type" column (still free text underneath — no rigid enum).
- **Key times:** per-rundown list of labeled times (doors, soundcheck, on-air…) editable from the
  header, shown on Showcaller/Edit/View headers and in print/guest output.
- **ZERO column:** optional display column showing T-minus to the next anchor at or after each row
  (the printed countdown convention), toggled per user in the Columns menu.
- **Version label:** surface the existing snapshot history as a lightweight label on the rundown
  header ("V2", "FINAL" — free text), included in print/export title blocks.
- **Untimed cue pool:** a collapsible "Pool" section below the rundown holding cues that aren't on
  the timeline (stings, chants, filler). During a live show the caller can **fire** a pool cue: it
  logs to the as-run report with a timestamp without moving the active row. Design the doc shape
  deliberately; keep it simple. **Verify:** in-browser — milestone math, colors in guest view,
  ZERO column against a moved anchor, pool fire appearing in the as-run CSV.

## Phase 5 — Live polish & formatted print/PDF export

- **Active-row highlight everywhere (the non-negotiable):** while the show runs, the active row is
  unmistakably highlighted on **every** surface — Showcaller, Edit, View, Follow, Guest (when the
  session is live), Prompter (already follows): a strong accent bar + tinted row + an inline
  **elapsed/remaining progress bar** that drains as the item runs and turns the over-color on
  overrun; **next row** gets a subtle secondary tint; paused state visibly dims the highlight;
  jump/prev/next move it instantly (<300 ms, already guaranteed by the protocol). Auto-scroll
  keeps the active row in view with a "follow" toggle so a scrolling user isn't yanked (passive
  marker per the original spec).
- **Formatted print/PDF export** (browser print CSS first, `@page` rules; a server-side renderer
  only if print CSS proves insufficient): title block (event/rundown/date/venue/version/status) +
  key-times table + column headers repeated per page + row numbers on **both** edges + row colors
  + milestone bars + footer (page N of M, generated stamp, optional custom footer text e.g.
  "not for external distribution"); per-department presets (column selection) using the saved
  Columns configurations. Available from Showcaller/Edit/View and the guest page.
- **Verify:** run a show while watching View + Follow side by side — highlight moves in lockstep;
  print preview of a colored, milestoned rundown paginates with repeated headers.

## Constraints & ordering

- Phases in order 1 → 5; each ends runnable, seeded, and browser-verified before moving on.
- No breaking protocol changes without a version bump and `PROTOCOL.md` update; the doc schema may
  add keys but must migrate existing rundowns transparently (missing keys = defaults).
- Timing engine additions (milestones, ZERO, pool) land in `packages/core` with unit tests first.
- Real reference sheets and their derivatives stay local-only; in-repo fixtures are fictional.
- Update `CHANGELOG.md` (generic wording) and the local dev log as you go; commit and push per
  completed phase after the confidentiality grep.
