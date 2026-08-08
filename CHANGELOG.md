# Changelog

All notable changes to this project are documented here, newest first.
Format follows [Keep a Changelog](https://keepachangelog.com/); the project is not yet versioned, so everything sits under **Unreleased**.

> Versioning: the root `package.json` version is the app version, shown bottom-right of the dashboard together with the build commit. Bump the **minor** for a feature batch, the **patch** for fix-only releases, and cut the `[Unreleased]` section into a matching heading in the same commit.

> Maintenance rule (see CLAUDE.md): update this file in the same commit as any meaningful change. Entries are written generically — no references to external vendors or reference material.

## [Unreleased]

_Nothing yet._

## [0.22.1] — 2026-08-08

### Fixed
- **Following the clock reported the show as running late when it was running exactly on the clock.** When the clock follower moved onto a row, the row was recorded as beginning at that moment — but the sheet may say it began half an hour ago, and following the clock means being *on* it. A show picked up mid-way through a 53-minute item read 51 minutes still to run and 50 minutes over, with a projected end nearly an hour past the planned one. The follower now records a row as starting when the sheet says it started, so the item counts down correctly and the drift reads zero. A person pressing Next or jumping still starts the row there and then.


## [0.22.0] — 2026-08-08

### Added
- **The positions that run the show are roles too.** A sheet records who a row is for in more than one place: a WHO column naming people, and a cue column naming the desks that operate it — VTR, GFX, LED, CAM, TRK. Only the first was ever offered under "My role", so the graphics operator had no way to pick themselves out and the camera operator had to read every row. Both columns are read now, and a row lights up when it names any role its holder has. On one 25-page sheet that takes the list from four names to nine names and positions, and picking GFX marks 64 rows out of 463.
- Rundowns record every column that carries an assignment rather than a single one, so highlighting and the role picker agree with each other. Existing rundowns keep working — one column is simply a list of one.

### Fixed
- The prompter marker the import writes is no longer offered as a crew position. It is something this app adds, not a job on the sheet.


## [0.21.0] — 2026-08-08

### Fixed
- **The timing check stopped calling correct sheets wrong.** A run sheet is not one unbroken chain: alongside the running order it carries rows that happen *at* a time rather than taking time in it — two things booked for the same moment, a deadline ("team sheets due"), a standing cue ("2 min bell"), a note that something elsewhere has finished. Read as links in the chain, each one appeared to open a gap and then close it again. One 25-page sheet reported 11 disagreements and had none: every chain reconciled exactly once those rows were allowed to sit alongside it. A row is only queried now after checking the obvious alternative — that skipping it lets the running order pick up precisely where it left off. Genuine disagreements are still reported.
- **Two spellings of one person are no longer two people.** A cue column saying "cue DP" on some rows and "DP cue" on others produced two roles, neither of them a person; the word "cue" is the instruction, not part of a name. And a cell naming two people by their initials with only a space between them ("LC JM") read as one unknown role, so neither person's rows lit up for them. Names are left alone — a two-word name is still one person.

### Changed
- Timing-gap detection moved out of the reconcile screen into the shared core, where it can be tested. It now has tests, including that a real disagreement is still caught.


## [0.20.1] — 2026-08-08

### Fixed
- **The import stopped demanding fixes for cells that were never wrong.** A run sheet uses its TIME and DUR columns for other things on some rows — a team list puts positions there ("Fullback", "Interchange", "Head Coach"), a pre-show row says "TBC" — and every one was reported as a cell that "couldn't be parsed", with a box asking for a correction that does not exist. On one 25-page sheet that was 66 false alarms and nothing else. A value is only queried now when it was plainly reaching for a time or a duration; those all contain a digit. The text is kept beside its column either way, so nothing is lost by not asking.

## [0.20.0] — 2026-08-08

### Added
- **The prompter now fills itself from the run sheet.** Sheets set the words a presenter reads in italic, and that is what the import reads: those passages are marked **`prompter`** in the sheet's own cue column (SCR, TYPE, SOURCE — whichever the sheet uses, recognised by its contents rather than its name). The prompter shows every marked row with the time it is due and its item number, so the person reading knows how long they have as well as what to say. Marking or unmarking a row by hand does the same thing — the decision is visible and editable in the sheet, not buried.
- Italic **labels** are deliberately left alone. A track name or an all-caps lighting direction is not something to put in front of a presenter mid-show, so a marked passage has to read as speech. Short lines inside a read still come along — a "&lt;Captain to speak&gt;" between two spoken lines belongs with them — as does the bold line that pays a welcome off ("…please welcome to the field, THE CAPTAIN!"), and a line whose italics the author simply missed mid-sentence.
- Sheets that carry a Script column of their own still work exactly as before.

### Fixed
- **The end of a line could land in the wrong columns.** Where a sentence changes formatting part-way and runs wider than its cell — a welcome that finishes with a name in bold — the tail was filed under WHO and NOTES, so "…a true icon of the sport, HER NAME!" lost its last two words. Text is now kept together unless a real column border separates it.
- **A passage of script no longer imports as a section header.** Rows holding nothing but text were classified as headings, which rendered a paragraph of script as a grey banner across the sheet and discarded the row's other cells with it.

## [0.19.0] — 2026-08-08

### Fixed
- **Imported run sheets lost their item numbers.** The import screen re-read the sheet as you corrected cells, and that second reading skipped the numbering and the alternate-ending detection the first one had done — so every sheet imported with no numbers at all, and no win/lose/draw branches. There is now one way to turn a sheet into rows, and everything uses it.
- **Angle brackets were deleted from the text.** A run sheet uses them for prompts to read aloud — a captain to speak, a player's name to fill in — and anything shaped like a tag was stripped on the way to the screen, silently removing those lines. Only the app's own formatting is treated as formatting now.
- **A column could arrive split in two.** In a ruled table, one cell often holds several pieces of text at different positions — a name beside an italic aside, a bold heading over plain rows — and columns were being worked out from those positions, so a sheet's NOTES arrived half under NOTES and half under "Column 17". The table's own ruled lines now decide where the columns are, and text is placed by its middle rather than its left edge, so bold and centred values stay in the column they were typed in.
- **A column whose entries start late was thrown away.** Only the first 60 rows were read when deciding whether an untitled column held anything, so a countdown that begins on page five looked empty and was dropped. The whole sheet is read now — which also correctly discards a right-hand column that just repeats the row numbers.
- **Text in a time or duration column no longer vanishes.** A team list that puts "Fullback" or "Interchange" in the duration column had nowhere to put it and dropped it. It is now kept beside the column it came from, under the sheet's own heading.

### Added
- **An import audit** (`apps/web/scripts/import-audit.mts`): re-reads a rundown's source sheet through the real pipeline, reads the live rundown, and reports every row where the two disagree — missing rows, drifted numbering, changed times or durations, cell text under the wrong column. Exits non-zero on any difference, so it can gate a release.

### Changed
- The conversion from a read sheet into a rundown moved out of the import screen into the shared core, so it can be tested and audited without a browser. Its rules are covered by tests for the first time.

## [0.18.1] — 2026-08-08

### Fixed
- **Signing in as an administrator with an email and password could not open any run sheet.** Both live channels recognised only the literal admin token string, so an account carrying the administrator grant was turned away from the sheet and the show — while the rest of the app cheerfully treated the same sign-in as an administrator. Anyone using the pasted token never saw it; anyone signing in properly could not work at all. Administrator accounts now have administrator reach everywhere.
- The show channel and the "who am I" answer now **name the administrator account** instead of a bare "Admin".

### Changed
- The access-control matrix covers administrator accounts on both live channels, not only over HTTP (72 checks) — the gap that let this through.

## [0.18.0] — 2026-08-08

### Added
- **A screen that is refused now says why, and what to do about it.** Instead of loading forever, it names the fault in plain words — not signed in on this device, sign-in expired, this account has no access to this event, the sheet was restored, the sheet no longer exists — together with whose sign-in was used and the one action that fixes it. Sign-in links carry the sheet address, so signing in returns straight to it rather than to the dashboard.
- The server now sends a **reason with every refused document connection**. Previously the reason was discarded on the way out and every failure looked identical from the browser, which made a stranded phone impossible to diagnose from a screenshot.
- The diagnostics strip reports the **account a credential belongs to**, and appears immediately on a refusal rather than after the usual wait.
- `PGLITE_DIR` points a sync instance at its own embedded database, so a locked test instance can run alongside a dev server.

### Fixed
- **A refused sheet no longer retries forever.** The connection was reconnecting indefinitely against a refusal that could never succeed, putting a steady stream of requests on the server from a screen that was going nowhere.
- The diagnostics strip no longer **covers the message underneath it** — the page now keeps clear of the strip's height, which on a phone had hidden the explanation and its sign-in button entirely.

### Changed
- The access-control matrix now checks the **refusal reason** on each rejected document connection (68 checks). Its fixtures name the second company explicitly: an event created without one falls back to the first company on record, which on an empty database silently made the scoping checks test nothing.

## [0.17.0] — 2026-08-08

### Added
- **A diagnostics readout for screens that won't load.** When a run sheet has not arrived after a few seconds, a strip appears across the bottom stating, in plain words, exactly how far the connection got: the app version and build, which sheet and which sign-in kind, whether the content channel is connecting or was refused, whether the show channel is connected, whether the device is online, the server address being used, and the last error. A photo of that strip is enough to diagnose the fault without any developer tools. It carries a Copy button and a Retry button, and never prints a credential — only the *kind* of credential in use. Add `?diag=1` to any rundown address to show it deliberately.
- The document connection now reports **authentication refusals and socket closures** instead of failing silently — a refused connection that could not be recovered previously left the screen waiting forever with nothing to show for it.

### Fixed
- **Form fields lost their styling** (background, border, padding) in 0.14.2 — a selector was accidentally split while fixing the phone-width overflow. Restored.

## [0.16.0] — 2026-08-08

### Added
- **Timing nudges on every row** — `−30 −15 −5 · CUE · +5 +15 +30`, in seconds, for pulling a show back on time without typing into cells. Hovering a row reveals them at the right edge, clear of the cue text; they appear instantly, since this is a live control. Available to anyone who can run or edit the show — never on read-only views.
  - **CUE** means "this item is happening now": the row is pinned to the clock and everything below it re-times by the same amount. It re-times the sheet only — it does not move the show's live position.
  - **+ / −** change that item's duration, and **the live cue is the anchor**: time is absorbed on the far side of the edit, so whatever is on air never moves. Edit an item *after* the live cue and later items shift; edit one *before* it and the item's end is held while it and the items above it shift instead — the "kick-off can't move, claw the time back earlier" case.
  - Each press is a single undo step and syncs to every screen, exactly like a typed edit. A muted or skipped row changes its own duration without moving anything else, and no duration is ever pushed below zero.
  - **On tablets and phones**, which have no hover, the same controls dock along the bottom of the screen and act on the selected row — or the live cue when nothing is selected — sitting clear of the role bar.

## [0.15.1] — 2026-08-08

### Fixed
- **A column's data now imports under the sheet's own heading.** Where a heading is centred over left-aligned text, the two land in different bands, so the sheet's named column arrived empty beside an anonymous "Column 7" holding the real content. A named column that came up empty now adopts the neighbouring band that holds its data — judged by relative fullness, since notes and similar columns are legitimately sparse.
- The title column keeps the sheet's own heading (ACTION, ACTIVITY…) rather than falling back to a generic label when several bands feed it.

## [0.15.0] — 2026-08-08

### Fixed — run-sheet import fidelity
Four import faults were found by re-reading a 25-page production sheet against its source and fixing what didn't match. On that sheet the imported rundown gained 20 rows it had previously swallowed, every row gained its title, and the timing check dropped from 13 items to 11 — with the remaining ones being genuine properties of the sheet rather than import damage.

- **Rows that carry their own clock time are no longer folded into their neighbour.** Whole blocks go unnumbered on real sheets — everything before the first cue: call times, content checks, rehearsals, doors — and the importer treated each of those lines as wrapped text belonging to the row above. An entire afternoon of preparation collapsed into a single row hours long, which the timing check then reported as one enormous unexplained gap. Lines with their own time (including ones written "TBC") now stand as their own rows.
- **Late-addition item numbers are respected.** Sheets insert additions as "129a" and "129b" rather than renumber the document; those rows were treated as continuation text and merged upward, dragging their times with them and scrambling the running order — which surfaced as several impossible gaps where the clock appeared to run backwards.
- **Page furniture is dropped instead of being absorbed into cues.** The title block a document repeats on every page was merged into whichever cue happened to sit at a page break, putting the sheet's masthead inside a cue title. Text that repeats on three or more pages and carries no time or item number is now recognised as furniture.
- **A wide, centred title column is matched to its content.** When a column's header is centred but its text is left-aligned, the two land in different bands; the search for the real content only looked two columns away, so sheets like this imported with every row untitled. The search now reaches across the full width of such a column.

## [0.14.2] — 2026-08-08

### Fixed
- **A run sheet that is still loading no longer claims to be empty.** Opening a rundown showed "Untitled Rundown — Empty rundown, add your first row above" while the document was still arriving, which on a phone connection (or whenever the document channel can't connect at all) looked exactly like a broken or blank sheet. It now says **"Loading the run sheet…"** while the content is on its way, and **"Connecting to the server…"** with what to check when the connection is the problem. The genuine empty-rundown message only appears once the document has actually loaded.
- **The sign-in page no longer overflows a phone screen.** Text input fields carry a built-in minimum width that beat the layout, pushing the page sideways and cutting off the heading and help text; every form field can now shrink to its container.

## [0.14.1] — 2026-08-08

### Fixed
- Double-tapping a cell to edit it works again on tablets — the zoom lock was also cancelling the tap that opens the editor. Pinch zoom is still refused; double-tap zoom is handled without touching the tap itself.

## [0.14.0] — 2026-08-08

### Fixed
- **Phones and tablets on your network now open the show.** The app reached the sync server at "localhost", which on a visiting iPad or iPhone means *that device* — so nothing connected and the status dot stayed red (on a phone the sheet never appeared at all). Each device now resolves the server against the address it loaded the page from, so opening the dashboard by network address just works, with no configuration. A configured URL still wins, and an https page keeps a secure connection.
- **Company access can create events.** A person whose account carries a company grant could manage that company's events but was refused when adding a new one — creation demanded an admin or a company *token*. Company-level access now creates events inside its own company (and only there); event-only and view grants still cannot.

### Changed
- **One button per rundown, decided by your access**: managers get **Open show** (the console), view-only access gets **View**. Edit content and the read-only view moved into the ⋯ menu, which is hidden entirely from people who can't manage the rundown.
- **Pinch and double-tap zoom are locked** on phones and tablets, so a stray gesture can't leave a crew member zoomed into a corner of the sheet mid-show. (The browser's own accessibility zoom is untouched.)

## [0.13.1] — 2026-08-08

### Changed
- **The cue pool is parked** — hidden from the show page for now (the code stays, one switch re-enables it).
- The result-rows menu speaks plainly: "Win / lose / draw rows…" with options like "Play these when we WIN" and "Play these in EXTRA TIME (golden point)".
- Row, Group, and Milestone buttons explain themselves on hover — a Row is a timed item the show steps through, a Group is a section heading the transport steps past, a Milestone pins a clock moment with no duration.

## [0.13.0] — 2026-08-08

### Added
- **Spreadsheet-style column headers**: drag a header to reorder columns — the move is written to the shared document, so every open screen, the guest view, and the PDF/CSV exports follow instantly and it survives reloads. **Click a header label to rename it in place** (replacing the old double-click prompt); Enter commits, Escape cancels. A drop indicator shows where the column will land, and the resize handles still work exactly as before.

## [0.12.3] — 2026-08-08

### Changed
- **The row-selection popup floats below the selected rows** instead of covering them.
- The popup's "Outcome" item is now **"Mark as ending…"** with an explanation inside — it tags rows as alternate endings (imports usually do this automatically); the live result is picked with the Full time buttons at the top, as before.

## [0.12.2] — 2026-08-08

### Fixed
- **PDF and CSV exports follow the sheet's column order** with its own header names, matching the on-screen grid.
- The LIVE chip wraps onto the next line on phones instead of clipping off the edge.
- Managing a rundown that no longer exists answers 404 for signed-in callers instead of 401.

### Added
- Regression tests for the newest live behaviours: walkthrough transitions in the show machine, ending-block auto-detection, and the sheet-order/column-name/outcome document round-trip (63 tests across the suites).
- The locked-server access matrix grew to **58 checks** — profile self-service gates, named join codes and revocation, and the walkthrough command gate — and passes clean.

## [0.12.1] — 2026-08-08

### Fixed
- **New events prefill today's date in YOUR timezone** — the form used the UTC date, which is yesterday every morning east of Greenwich.
- **Date fields pop their calendar immediately** on click or focus, and native calendars now render in the dark theme.

## [0.12.0] — 2026-08-07

### Changed
- **The grid now mirrors the source sheet's column order exactly** — including the structural columns. A sheet laid out `# · TIME · DURATION · ACTIVITY · LOCATION …` renders in that order on every surface (console, editor, view, guest), with the live progress bar, time editor, duration popover, and column resizing all following their columns. New imports pick this up automatically ("Update import…" upgrades existing rundowns); rundowns that predate this keep their current layout.

## [0.11.0] — 2026-08-07

### Added
- **My account page** (`/account`): see who you're signed in as and what you can access; email accounts edit their name, email, and password there. The sidebar's Credentials section now states your identity and access level on every dashboard, with a My account link.
- Creation rights follow the hierarchy end to end: admins create companies, events, and views; company sign-ins create events and views; event access creates view links only — the dashboard now hides what each tier can't do (the server always enforced it).

### Changed
- **One palette everywhere**: the dashboard and admin pages now share the show surfaces' dark theme instead of switching to light, and the favicon's mark (the little rundown with its live row and go dot) brands the sidebar and dashboard header.
- **The timing check fixes whole chains in one action**: "Change X's start … & shift below" moves every fixed time under it by the same correction — inserting a row no longer means resolving each downstream disagreement one by one.
- **The selection bar floats beside the rows it acts on** — anchored just above the first selected row and scrolling with the sheet, instead of sitting detached in the toolbar.
- README and the build spec refreshed to the current feature set (the AI-assistant deploy notes now describe the migration-at-boot behaviour verified by the Docker test).

## [0.10.0] — 2026-08-07

### Added
- **Events have a sport** (NRL first — more sports and styles later), selectable when creating an event or on its card. Sport drives the live ending flow: at full time the console offers **Win / Lose / ⚡ Golden point** (a level score goes to extra time, never straight to a draw); once golden point is playing the final pick returns as **Win / Lose / Draw**. A **Draw** tag joins the outcome set for the final drawn result.
- **Imports detect the ending blocks by themselves**: banners like "Fulltime – WIN", "Full Time (DRAW)", and "GOLDEN POINT Kick off" tag their blocks on the way in — no manual tagging for standard sheets.
- **The console reminds the caller as full time approaches**: when the live cue is within two cues of the ending blocks and no result is picked, the Full time chooser pulses. The nudge is position-based, never clock-based — stoppage time, injuries, and penalties can stretch the game freely (NRL, cricket, soccer, basketball, AFL all behave differently; position in the sheet is the one thing they share).
- **Join codes carry a name** ("Sarah — Cam 2"): set it when creating a code, see it in the panel, and every screen identifies the joiner by it. Codes can be **revoked** — they stop working everywhere immediately. (Email delivery of codes comes later.)
- **Start-time edits ripple** like duration edits: moving a time shifts every fixed time below by the same amount, one undo reverses it all.

### Fixed
- **Opening a rundown that is already live re-syncs immediately** — the current cue is centred on screen as soon as the sheet loads.
- **Editing a start time no longer nudges the sheet's layout at all** — the editor overlays the cell instead of stretching it.
- The "+ version" and "+ key times" chips are gone from the show header — version lives in the rundown name and key times in the sheet itself.

## [0.9.0] — 2026-08-07

### Added
- **Outcome branches — win / lose / golden point.** Sheets for sport carry alternate endings that share one start time; the app now understands them. Tag blocks of rows as Win, Lose, or Golden point/draw (select rows → Outcome), and a "Full time" chooser appears on the console: pick the real result when it happens and the other endings skip themselves on every screen, with the transport jumping straight to the chosen block. Golden point loops: pick it when scores are level, play the extra-time block, and the Win/Lose pick comes back at the end. Choices are undoable, work pre-show for planning (Reset restores all endings), and rows wear WIN/LOSE/GP chips in the number column.
- **Imported sheets keep their own column headers** — the structural columns now carry the sheet's names (ACTIVITY, TIME…) instead of generic Title/Start/Duration, department columns already kept theirs, and **any column can be renamed by double-clicking its header**.
- **Event artwork slots**: the Images menu is gone — each event card shows two slots; click the + or drop an image straight onto one, hover for ✕ to remove.

### Changed
- **Event location** (renamed from "Location") now picks the timezone from a proper dropdown of all 418 world zones grouped by region, still previewing the GMT offset on the event's own date.
- Event cards put the location and dates beneath the event name, and each rundown sits on a single line — open buttons and view chips visible, everything else in a ⋯ menu, with the import/create controls on one compact row. Show/Edit/View and follow/timer/prompter now explain themselves on hover.
- **The import preview shows every row** (scrollable) instead of stopping at 40, and the unparsed-cell fix-list shows every issue instead of 12.
- **The timing check highlights the exact rows involved** in the sheet while each issue is on screen, and its fixes now say precisely what they'll do ("Change “Speech” duration to 05:00", "Change “Video package” start to 9:08 AM") instead of "absorb" and "un-anchor".

### Fixed
- **follow / timer / prompter no longer sit on "reconnecting…" on locked servers** — they now authenticate with your sign-in like the console does (crew join codes unchanged).
- The speaker timer always fits the screen — wide, tall, phone, or confidence monitor.
- Development servers evict any leftover service worker so a stale cached build can never mask fresh code.

## [0.8.1] — 2026-08-07

### Changed
- The sidebar's "Main page" link is now called "Login" — that's where it goes.

## [0.8.0] — 2026-08-07

### Added
- **Pre-show walkthrough**: before the show starts, Prev/Next step a shared highlight through the sheet — every connected screen (consoles, view-only, companions) sees the same row light up and auto-scrolls to it, so the caller can talk the crew through the running order. A position chip shows where you are ("Walkthrough 4/38"); "End walkthrough" clears it everywhere; starting the show clears it automatically. Walkthrough moves never touch the as-run record.
- **Duration edits ripple through the show**: changing a duration shifts every fixed time below by the same amount — the sheet now reflects an item running long or short, exactly like re-planning on paper. One undo takes back the duration change and the whole ripple together. (The duration editor says so, so nobody is surprised.)
- **Timezone picker with the offset on the show's date**: setting an event's location now offers the full zone list (type a city) and previews the GMT offset in force there **on the event's start date** — daylight-saving transitions included. All clocks and the server's clock-follow already run on the IANA zone database, so a caller, a remote monitor, and a live cross in three countries stay in lockstep; this makes the setup human.

### Changed
- **The live row's progress sweeps the whole cell** as a translucent wash with a bright leading edge, instead of a thin strip at the bottom.
- **Sync Cue floats top-centre of the grid** when you scroll away from the live row, instead of hiding bottom-right.
- **The show page fits the screen exactly** — the run sheet is the only thing that scrolls; the outer page scrollbar is gone.
- **The timing check explains itself**: each flagged spot now spells out the arithmetic ("adding the durations, X should start at 9:08 — the printed time says 9:10") and each fix describes exactly what it will change and why you'd pick it.
- The redo button is labelled ("↻ Redo"); undo/redo were verified to cover timing edits, reordering, and deletes on the live console.

## [0.7.2] — 2026-08-07

### Changed
- **The live cue row is now unmissable**: it grows physically taller with larger bold type, carries a filled **CUE** badge in place of its row number, and its rails are brighter and thicker with a stronger fill. The row number returns on printed output, where the live styling is stripped as before.

## [0.7.1] — 2026-08-07

### Fixed
- **Column resizing keeps the table's outer edges pinned.** A drag now moves only the boundary between a column and its right-hand neighbour — width transfers between the two, the total never changes, and the horizontal scrollbar is gone. A squeezed column wraps its text onto extra lines instead of pushing the table wider. The last column has no handle (its right edge is the table edge), and "All columns" on a phone keeps its side-scroll.
- **Editing a Start time no longer widens the column.** The inline editor now fits inside the cell instead of forcing it out to the input's default width.

## [0.7.0] — 2026-08-07

### Changed
- **Column resizing is solid, not elastic.** Dragging a header edge now moves only that column — the first drag freezes every column at its current width, so neighbours stop shifting around under the pointer. Double-clicking any handle returns the whole table to its natural widths. The read-only guest view gets the same draggable columns.
- **The cue row is unmistakable**: heavy light rails above and below the live row (on top of the existing tint and edge marker) make the current position readable from across a control room.
- **Fixed start times are set by double-clicking the time — the ⚑ flag is gone.** The editor opens prefilled with the row's current time (selected, ready to overtype); clearing the box returns the row to automatic flow-on timing. Closing the editor without changing anything no longer pins the row. Double-clicking Duration opens its editor the same way, with Hide/Mute alongside.

### Fixed
- **No more red flash at cue handovers.** The progress bars held red for a moment just before a cue's end and could carry it into the next row; the red overrun state now waits a full second past zero (the big timer bridges through amber), so a cue handing over cleanly never flashes red — a genuine overrun still turns red immediately after that second.

## [0.6.2] — 2026-08-07

### Changed
- **The big item timer sits dead-centre at the top of the screen** and everything else in the top bar arranges itself around it: title, planned start/duration/end on the left; the Item/Show/Projected-End readouts, connection dots, and event clock on the right. The centring accounts for the side navigation, so the timer is on the true centreline of the screen, not just the content area. On phones the timer takes the first row (still centred) with the rest stacking beneath.

## [0.6.1] — 2026-08-07

### Fixed
- **The item progress bar snaps to the start on every row change** instead of visibly receding for a second. The browser was starting the bar's smooth-fill animation from the previous row's position — even across an element swap — so each handover began with the bar sliding backwards. Both the big-timer bar and the in-row progress bar now disable the animation for any backwards movement and only animate while filling forwards. Verified live: on a row change the fill now paints at its true position (~1.5%) on the first frame, then resumes smooth filling.
- **Commands clicked during a reconnect no longer throw** (`InvalidStateError: Still in CONNECTING state`). Transport and toggle commands issued while the show socket is still connecting are queued and sent the moment the server welcomes the connection; entries older than 15 seconds are dropped rather than fired late into a live show.

## [0.6.0] — 2026-08-07

### Changed
- **Clock-follow now runs on the server** — the live fail-safe. With Follow clock on, the show advances itself along the TIME column with **every console closed**: the server computes the scheduled row each second in the event's timezone and moves the show there, and the mode survives server restarts (it is part of the durable session). The showcaller stays in charge on the fly: edits to times, durations, skips, or order take effect within a second (the live document is read directly, ahead of its debounced save); **Pause holds the show** in place; manual jumps are corrected at the next tick while following; toggling off returns full manual control. The toggle state is shared — every open console sees "Following clock" light up.

## [0.5.0] — 2026-08-07

### Added
- **Follow clock**: the show can now run itself off the TIME column. With the toggle on, every cue goes active at exactly its scheduled moment — each handover re-syncs to the event-local clock, so drift can never accumulate across items — and when a cue's time is up the next row takes over automatically. Manual moves while following self-correct within a second; switching the toggle off restores full manual control instantly. Verified against a 2,040-cue sheet of 30-second items: the show locked onto the correct cue for the current time and stepped through boundaries to the second, unattended.

## [0.4.0] — 2026-08-07

### Added — 2026-08-07 (show chrome overhaul · one-click re-import · multi-role · undo · clock sync)
- **Everything the caller needs stays on screen while scrolling**: the title, planned/item/show/projected-end readouts, the transport, and the column headers are all pinned — the run sheet scrolls beneath them. (The column headers were meant to pin all along; a styling rule had silently broken it.)
- **The big item timer is embedded in the top bar** instead of floating over it — it no longer covers the planned time or anything else.
- **Update import re-reads the sheet by itself**: imports now store the original file, so "Update import…" loads it, re-processes it with the current pipeline, and shows the refreshed preview in one click — no re-dropping. A newly dropped file replaces the stored one.
- **Row numbers mirror the imported sheet** — each row shows the sheet's own number, and rows the sheet didn't number stay blank. Manual rundowns keep sequential numbering.
- **Undo/redo for row edits** (toolbar buttons and ⌘Z/⇧⌘Z): delete rows live or during prep, then take it back.
- **Multiple roles per user**: the role picker is now multi-select — every matching row highlights in the colour of the role it involves, and the bottom bar tracks the next item across all your roles. The picker opens as a true overlay with zero layout shift.
- **Clock sync with the TIME column**: an amber "now line" marks where the event-local clock sits in the rundown, and while the show runs a **Sync to clock** button jumps the live position straight there. The top-right clock keeps showing event-location time.
- **Unparseable-cell fixes show their context**: each issue says which timed row it follows and expands to a five-row excerpt of the sheet.
- Browsers that crash on stale chunks after a redeploy now recover with one automatic reload, and the offline shell refreshes itself — the two production errors in the log came from exactly this.

### Added — 2026-08-06 (faithful times for sub-cues · Update import)
- **Rows the source sheet leaves untimed no longer get invented times.** Cue-sheet-style documents time only their parent rows; the sub-cues beneath (reads, graphics, tracks) have blank TIME cells — but the grid used to fill them with cascade guesses whose durations drifted past the next real time. Imports of sparse-timed sheets now mark those rows **untimed**: they show "—" exactly like the source (double-click still sets a real time), and their durations remain visible but excluded from the running order. A real 450-row cue sheet now imports with its 85 sheet times anchored and every sub-cue blank, matching the printed sheet.
- **Update import**: every rundown on the dashboard has an **Update import…** action — drop the run sheet again and the re-imported content **replaces the same rundown** (links, join codes, and view links keep working; the old content is snapshotted as "Before update" and every open screen refreshes to the new content). This is the upgrade path for rundowns imported before the latest pipeline improvements.
- Durations written as sums ("40mins + 3mins") now parse.

### Fixed — 2026-08-06 (Docker packaging hygiene)
- `docker-compose.yml` now passes `ADMIN_TOKEN` / `ALLOW_DEV_JOIN` through from the environment, so locking a Docker deployment is a one-liner instead of editing the file. `.dockerignore` excludes local databases, database backups, and every local-only working folder from the build context.

### Added — 2026-08-06 (installable app: PNG icons + service worker)
- **OpenCall now installs properly as an app.** PNG icons at every size platforms expect — an apple-touch icon for iOS home screens (iOS ignores SVG manifests), 192/512 manifest icons, and a padded maskable variant for Android launchers — plus a conservative service worker: navigations fall back to a cached shell when offline and hashed build assets are cached, while live show data (WebSockets, API) is never intercepted, so crew can never see stale show state. Also fixed the manifest still calling the app by its old short name.

### Changed — 2026-08-06 (generated database migrations)
- **Schema changes are now generated drizzle-kit migrations** (`packages/db/drizzle/`), applied automatically at boot and tracked in a `schema_migrations` journal — a fresh database builds itself from the baseline, an up-to-date one is a no-op, and databases created before this scheme are baselined in place (after a one-time idempotent catch-up) without touching data. Operators still never run a migration command. Developers: edit `src/schema.ts`, run `pnpm --filter @opencall/db generate`, commit the SQL.

### Added — 2026-08-06 (in-place snapshot restore)
- **Restore here**: a version in the History panel can now replace the current rundown's content directly (armed two-click, next to the existing "Restore as copy"). The server saves an automatic **"Before restore"** snapshot first, so a restore is itself reversible. Under the hood every document connection is scoped to a per-rundown **doc epoch**; restoring bumps the epoch and disconnects every open screen, which reconnect fresh and show the restored content within seconds — pre-restore edits can never merge back in, and a stale client's pending save can never overwrite the restored document.

### Added — 2026-08-06 (import fix-it list · planned timing from the sheet · row-number resize)
- **Unparseable import cells get a fix-it list.** Instead of only flagging "N cells couldn't be parsed", the preview now lists each failed START/DURATION cell with the row, the offending text, and an **auto-suggested repair** (wrong separators like "19h30", durations buried in prose like "approx 5 mins TBC", bare numbers treated as minutes). Fix each one in place — Apply (validated live), Clear (import empty), or Keep as is.
- **Imported rundowns take their planned start from the sheet's own first time** instead of defaulting to 9:00 AM. The planned start in the rundown header is now **click-to-edit**, and when the final item has no duration the header shows an **approximate end (≈) assuming 30 minutes** — unless that item is itself the ending (Full time, End…), which stays exact.
- **The row-number column is resizable** like every other column.

### Fixed — 2026-08-06 (cell formatting now visible outside the editor)
- **Bold, italic, underline, strikethrough, and highlight applied in a cell now actually show in the grid** — formatting was stored but stripped by the plain-text projection the moment the editor closed. Formatted cells render their marks (through a strict allowlist — nothing document-authored can inject markup); plain cells keep their role colour-coding. Multi-paragraph cells also keep their line breaks in the grid and CSV export now.

### Added — 2026-08-06 (PDF export)
- **Export PDF** in the rundown's Output menu downloads a real PDF file — A4 landscape with a repeating table header, the rundown name/version/planned times and key times atop every page, page-numbered footers, anchored times marked with `*`, group rows as full-width dark bands, row highlight colours preserved, skipped rows greyed, and column widths matching the on-screen layout (including personal resizes). Generated entirely in the browser; the print dialog remains available as "Print".

### Added — 2026-08-06 (PDF row boundaries from the table's ruled lines · admin sub-pages)
- **PDF imports now read the table's actual ruled lines** from the document's drawing layer and use them as authoritative row boundaries. This fixes the last merge imperfections: bottom lines of tall rows no longer bleed into the next short row, ruled sub-rows inside one item (per-line WHO/WHAT rules) join their item, and **unnumbered section banners survive as their own section rows** instead of being absorbed — a real sheet recovered four match-phase banners that earlier imports swallowed. Pages without detectable rules fall back to the previous nearest-item heuristic.
- **Users & access and the Error log now live on their own pages** (`/admin/users`, `/admin/errors`), linked from the sidebar, instead of stacking on top of the events dashboard.

### Added — 2026-08-06 (accounts: password sign-in & sessions · one-click view links)
- **Real sign-in**: users now log in with **email + password** on the landing page or the admin gate. Passwords are scrypt-hashed; logins issue revocable 30-day sessions that work everywhere the old tokens did (API, show channel, document channel) with the same grant enforcement. Sign out revokes the session server-side; changing a password (or an admin resetting one) signs out every other device. Admins set an optional password at user creation, see who has one, and can reset it; personal access tokens remain as a backup credential. Login attempts are rate-limited.
- **One-click view-only links**: a **Copy view link** button on every rundown (dashboard and Join codes panel) copies a URL that opens the rundown read-only — hand it to camera operators and crew; no account needed, revocable via join codes.
- The access-control matrix grew to **50 checks**, now covering the full session lifecycle (login, scoping, revocation on reset/change/logout) and the view-link path (public code resolve, read-only doc enforcement).

### Changed — 2026-08-06 (self-hosting guide for humans and AI assistants)
- **The README now carries a complete self-hosting guide**: architecture and port table, full environment-variable reference (build-time vs runtime), three deployment paths (Docker Compose on a VPS, any PaaS, bare Node), first-run setup, and copy-paste verification checks — plus a **"Deploying with an AI assistant" section** with a ready-to-paste prompt so tools like Claude or ChatGPT can spin up an instance end-to-end from the README alone.
- `docs/DEPLOYMENT.md` security status brought up to date: the deployment is locked (admin token gates the API and both websocket channels; the credential hierarchy and the 33-check access matrix are documented). The previous "not yet authenticated" warning was stale.

### Added — 2026-08-06 (locked-server access audit · mobile dashboard)
- **Access-control test matrix**: a committed script exercises 33 checks against a locked server — per-credential event scoping in the API, caller/follower roles on the show channel, and read-only doc enforcement for view grants (a viewer's write is rejected server-side while a manager's propagates). All 33 pass.
- **The dashboard now works properly on phones**: each company, event, and rundown collapses its action buttons into a single ⋯ menu (rename, dates, location, images, archive, duplicate, tokens, delete — with the same two-tap confirmation for destructive actions). Show/Edit/View and the companion-screen links stay one tap away; desktop is unchanged.

### Added — 2026-08-05 (wrapped-row merge · role column · error log · mobile simplification)
- **Resizable columns**: drag the right edge of any column header in the rundown grid to set its width — per person, per rundown, remembered by the browser; double-click the handle to restore the natural (or imported) width.
- **PDF imports now produce one row per sheet item.** PDF text extraction yields one grid line per visual line, so items with wrapped cells arrived as several mostly-empty rows. The importer now recognises the sheet's item-number column and merges every continuation line into its item — using each line's vertical position to attach it to the nearer numbered row (cells are vertically centred, so a wrapped cell's top lines sit *above* the item number). A 15-page real sheet went from 388 fragmented rows to 78 rows mirroring the source exactly, every one anchored to its printed time.
- **The sheet's own role column drives role features.** A column headed WHO, ROLE, RESPONSIBLE, CREW (labels vary per production house) is recognised on import: roles are mined from it alone (composite cells like "VTR | LED" split into their parts), no duplicate "Roles" column is synthesized, and the rundown remembers which column holds assignments — so "My role" highlighting and the on-air bar match against actual assignments, never prose mentions in notes columns.
- **Server-kept error log.** Everything that breaks is journaled server-side: API failures, process-level crashes, and **every visitor's browser errors** (uncaught exceptions, promise rejections, failed API calls are reported automatically). Admins review entries — time, origin, message, stack — and clear the journal from a new **Error log** panel.
- **Users & access and Error log now live in the left settings sidebar**, visible to admins only.
- **Access tokens work on the landing page.** Pasting a personal, company, or admin token into the join box signs you in and opens the dashboard — previously the field treated tokens as join codes (and uppercased them, corrupting them).
- **Phones show a simplified run sheet**: title, start, duration, and the role column only, with an **All columns** button to bring the full sheet back (side-scrolling inside the grid). Secondary header chrome is hidden on small screens.

### Fixed — 2026-08-05
- **Department columns render again in the run-sheet grid.** A regression left every imported column (WHO, WHAT, notes…) header-only — the cell contents were stored but never drawn.

### Added — 2026-08-05 (user database, timing reconciliation, live skip, roles column, mobile)
- **User database with per-user access**: admins create users from the dashboard, each with a personal access token and precise grants — full admin, an entire event company, a single event, or **view-only** access to an event. Grants govern the dashboard (users see only their events), the API, the show channel (managers call, viewers follow), and the document channel (view grants are read-only). Tokens are copyable and rotatable; users sign in by pasting their token on the access page.
- **Timing reconciliation wizard**: when a sheet imports with TIME and DURATION columns that don't add up, a "⚠ N timing gaps — Reconcile" chip appears. It walks the showcaller through each disagreement one at a time — absorb the gap into the preceding duration, un-anchor the disagreeing time, or mark the gap intentional (a genuine hold).
- **Skip items live**: select rows and hit **Skip** while the show runs behind — the row stays visible (struck through) but leaves the timing cascade and the transport steps over it, so the show catches back up to the original anchored times. Un-skip the same way.
- **Roles column auto-populated on import**: every detected role that appears in a row lands in a "Roles" column (items can carry several), colour-coded like everywhere else.
- **Import band-drift rescue extended to times and durations** with joint proximity-scored assignment (times and durations can masquerade as each other — "0:15:00" parses as a time — so the two targets are resolved together, never crossed). A 15-page real production sheet now imports with 75 correctly anchored rows.
- **Mobile pass**: the run sheet scrolls horizontally inside its own container, toolbars wrap, the big timer and role bar scale down, and the side panel never auto-opens over content on small screens. Picking a role no longer shifts the toolbar layout.

### Added — 2026-08-05 (role detection on import · counter bar · Sync Cue)
- **Importing a run sheet now detects the assigned roles automatically** (PA, VTR, GFX, DJ, LED, locations, brand loops — any short value that repeats across cells, excluding times and durations) and **assigns each a distinct colour**. The roles are stored on the rundown: every mention is colour-coded in the grid, the "My role" picker offers them one-click with their colours, and the personal row highlight and bottom bar adopt your role's colour. Detected roles are shown as coloured chips in the import preview.
- **A counter bar now fills left-to-right under the big centre-top timer**, showing approximately how much of the active item has elapsed (amber in the final stretch, red on overrun).
- **Scrolling is never hijacked during a live show**: scrolling the sheet by hand disengages auto-follow instead of fighting you, and a floating **"Sync Cue"** button appears — one press jumps back to the live cue and follows along again.

### Added — 2026-08-05 (my role: personal highlight & next-item bar)
- **Every user can mark their assigned role** — BGM, Camera 1, PA, a presenter's name, anything the sheet says — regardless of their access level (admin, edit, or view-only). A "My role" picker in the toolbar suggests roles mined from the sheet itself; the choice is remembered per browser.
- **Your items highlight in teal** across the rundown the moment a role is picked.
- **A bottom bar appears while the show runs**: it names your next item and counts down to its start (planned time shifted by the live drift, amber inside the final minute). When your item goes live the bar grows into a **full-width ON-AIR banner** — "YOU'RE ON" with the item's remaining time — and when your item finishes it moves on to the next one, ending with "no more items for you" after your last cue.

### Added — 2026-08-05 (event images, company logos, big live timer)
- **Images on events**: add one image — or two for sporting fixtures (home and away team) — from the event card's Images menu; they display beside the event name. **Event companies get a logo** shown on their band. Images are picked from disk, downscaled client-side, and stored inline (no external storage needed yet).
- **A big, unmissable timer sits centre-top of every rundown screen while the show runs**: the active item countdown in large tabular figures — green on time, amber in the final stretch, red counting up on overrun, dimmed amber while paused — with the active item's name above it.

### Fixed — 2026-08-05 (import header detection & centered-header titles)
- **Header-row detection scans much deeper** (30 rows) — sheets with multi-line title blocks above the real header no longer import with the page title as column names — and the preview gains a **Header row** override so any sheet can be rescued manually.
- **Centered headers no longer orphan the title column**: when a PDF's header text sits in a different layout band than the left-aligned data below it, the data-rich neighbouring band is mapped into Title as well — a real 6-page sheet went from 37 to 411 titled rows.
- Fixed an SSR crash on the dashboard under Node's experimental localStorage, and a hydration warning from locale date formatting in the print footer. The create-rundown template picker now reads "Start blank" and hides entirely until templates exist.

### Changed — 2026-08-05 (import: full column fidelity; company rename)
- **Imported rundowns now mirror the source sheet's columns exactly**: identical names (verbatim header text, original casing), no duplicates (repeated headers get a numbered suffix), the same left-to-right order, and **proportional column widths** taken from the spreadsheet's column sizes or the PDF's layout. Built-in department columns are no longer added on import — **a column with no data simply doesn't exist** in the imported rundown.
- **Event companies can be renamed** from their band header on the dashboard.

### Fixed — 2026-08-05 (import: columns now mirror the source sheet)
- **Importing a run sheet now auto-creates columns matching the sheet's own format.** Previously, headers like TRACK, BIG SCREEN, SIDE PANEL, LED, and NOTES were folded into the nearest built-in column, and columns with a **blank header** (the cue-type column on many presentation grids) were dropped entirely — losing most of a dense sheet's content. Now every non-structural column imports as itself; untitled columns are recognized by their data (a column of VTR/PA/GFX tokens becomes **Type** — which also activates the cue-type quick chips — anything else becomes "Column N"), and mirrored row-number columns are skipped as noise.
- Milestone rows keep their department cells on import, and their banner title falls back to the first cell value when PDF extraction lands the title in a neighboring column band — pre-show schedule rows (arrivals, meetings, rehearsals) now import with their real names instead of "—".
- Verified against a 12-page real production PDF: 517 rows with every source column (Type, LOCATION, TRACK, BIG SCREEN, SIDE PANEL, LED, NOTES) present and populated, versus most of that content missing before.

### Added — 2026-08-05 (dashboard: companies own their events; drag-and-drop import)
- **Events now appear underneath their event company** on the dashboard: each company is a band with its event count, showcaller-token actions, and its own "+ New event" (events created there belong to that company). A company credential sees exactly one band — its own.
- **Companies can be deleted** (armed two-click confirm) — deletion cascades through the company's events, rundowns, sessions, tokens, snapshots, templates, and memberships.
- **The import box accepts drag-and-drop**: drop an XLSX/XLS/CSV/PDF straight onto it (highlights while dragging) — clicking to browse still works.

### Added — 2026-08-05 (event date editing & ordering rule)
- **Event dates are now editable** from the dashboard (a "Dates…" inline editor on each event card) — previously they were fixed at creation.
- **The end date can never precede the start date**, enforced in three layers: the date pickers themselves (the end input's minimum follows the start, and moving the start forward bumps the end along), the form guard, and the API — which validates the *merged* result on both create and edit, so moving just one side past the other is rejected with a clear error.

### Added — 2026-08-05 (left settings panel & navigation)
- **A persistent left panel on the dashboard and every rundown screen** holds navigation (main page, dashboard) and all the settings features for the current screen — Views (Follow/Timer/Prompter), Output (Print/PDF, CSV export), and Show settings (template, guest pass, history, join codes) on rundown screens; archived toggle and credentials on the dashboard. Collapsible, state remembered per browser, hidden in print. The old ⋯ overflow menu is gone — settings now have a home. Everything in the panel respects the access hierarchy: a company credential sees only its own data; only admin sees all.

### Added — 2026-08-05 (event-timezone time model)
- **The event's location now governs every clock.** Each event carries an IANA timezone; the show channel hands it to every connected surface, and header clocks, live drift, and projected-end all compute in the **event's wall clock** (a viewer in another country sees the venue's time, labeled with the zone — "Event time · EDT"). Daylight saving is applied per-instant from the IANA database, so shows that cross a DST change stay correct — covered by unit tests on both a US and an Australian spring-forward boundary.
- **The primary time can only change when the location changes**: the API rejects a timezone change without an accompanying location change, and the dashboard pairs the two in one "Location…" action. New events pick up the creator's timezone automatically.

### Added — 2026-08-05 (access hierarchy: event companies & archive)
- **Three-tier access**: **Admin** (top level, sees and changes everything) → **Event company** (showcaller credentials: change event details and everything below, strictly scoped to the company's own events) → **Editor** (assigned per rundown via join code: changes rundown content, never events). Admin creates companies from the dashboard and hands out per-company showcaller tokens (rotatable); company tokens also drive the show and document channels as caller-level within their own company only. Verified against a locked server: a company sees only its own events, cannot touch another company's event (401), and cannot list companies (401); admin sees all.
- **Archive** for events and rundowns (in addition to delete): archive/unarchive from the dashboard, archived items hidden by default with a "Show archived" toggle, shown dimmed with an archived chip.
- The dashboard header now reflects who you are — "admin" or your company name — and `GET /me` drives visibility.

### Added — 2026-08-05 (milestone 2 · phase 5: live polish & print)
- **The active row is unmistakable on every surface while the timer runs**: accent bar + tinted row, an inline **progress bar that drains in real time** under the active title and turns the over-color on overrun, a subtle tint + soft bar on the **next** cue, and a dimmed amber state while **paused**. Auto-scroll keeps the active row centered as the show advances, with a **Follow** toggle so a user reading elsewhere is never yanked — verified live in-browser (bar draining at the correct rate, next-up tint, paused dim).
- **Formatted print/PDF export straight from the browser** on Showcaller/Edit/View (⋯ → Print): landscape A4 with a title block (name · version label · planned/duration/end · key-times table), column headers repeated on every page, group/milestone banners and row colors preserved, screen chrome stripped, and a generated-stamp footer. The Columns menu acts as the per-user print preset — hidden columns stay hidden in print.

### Added — 2026-08-05 (milestone 2 · phase 4: rundown fidelity)
- **Milestone rows**: a first-class row type for timed markers with no duration (doors, kick-off, "team list due") rendered as a full-width amber banner; excluded from duration math; produced by the importer and the new **+ Milestone** button.
- **Row highlight colors**: multi-select rows and pick from a curated palette (or clear) in the selection bar; colors follow the row onto every surface including the guest view.
- **Key times**: labeled times for the day (doors, soundcheck, on-air…) editable from a header chip, stored in the document, shown on Showcaller/Edit/View headers and the guest page — the real-world "KEY TIMES" table.
- **ZERO countdown column**: optional per-user column showing T-minus to the next anchored time — the printed countdown convention from live sport cue sheets.
- **Version label**: a free-text chip on the rundown header ("V2", "FINAL") stored in the document and shown to guests; ready for print title blocks.
- **Cue-type quick chips**: columns titled "Type" get a one-click vocabulary (AUDIO, GFX, VTR, LED, PA, MC, PYRO…) above the cell editor — still free text underneath.
- **Untimed cue pool**: a section below the rundown for cues that live outside the timeline (stings, chants, filler). During a live show the caller **fires** a pool cue and it logs into the as-run report with a timestamp — verified end-to-end (`fire` → `pool:Goal Sting` row in the report CSV) — without moving the active row. Guest views hide it; the protocol gained an additive `fire` action.
- Guest projection now respects **Hide** on durations (hidden durations never leave the server).

### Added — 2026-08-05 (milestone 2 · phase 3: run-sheet import)
- **Upload an existing run sheet — XLSX, XLS, CSV, or PDF — from the admin dashboard** ("Import run sheet…" per event). Extraction is fully client-side: spreadsheets read as displayed text; PDFs go through text-run clustering (lines by Y, column bands by X, repeated page headers dropped) with a clear error for scanned files that have no text layer.
- **Mapping preview before anything is created**: auto-detected header row and column mapping (title/start/duration/departments, with synonym matching — VTR→Video, LX→Lights, WHO/WHAT→Production Notes…), retargetable per column, unknown headers become new custom columns; rows classified as cue / **milestone** (time, no duration) / **section** (title-only banner) / spacer; unparseable cells highlighted in red and imported empty rather than silently dropped.
- **Tolerant parsing in core** (30 unit tests, fixtures modeled on three real production house styles): durations like "3 mins", "1min 27 secs", "0:90:00" (90-minute spreadsheet leak), "08:00"; times like "5:00:00PM", "16:00:00", "4:30pm", "0900". Verified end-to-end in-browser: a synthetic spreadsheet imports with anchors, milestone rows, cascade and department cells intact; a real 8-page production PDF extracts 450+ rows with start/duration/title auto-mapped and 21 unparseable cells flagged.

### Added — 2026-08-05 (milestone 2 · phase 2: role screens & gated access)
- **Four ways into the app, each a real screen**: `/admin` (cross-show control room: every event and rundown, create/rename/delete/duplicate, live-now badges, one-click jump into any screen), `/show/[id]` (full showcaller console), `/edit/[id]` (content editing, **no transport and no share/admin panels**), `/view/[id]` (read-only grid with live position, personal column visibility, print). The old `/rundown/[id]` URL redirects to `/show`.
- **Landing page**: crew enter a join code and are routed to the screen their role allows — caller → Showcaller, editor → Edit, follower → View — with the code carried in the URL and reused by every panel and channel.
- **Server-enforced access (interim tokens, accounts still to come)**: a new `admin` role is granted only by the server's `ADMIN_TOKEN`. When that variable is set the deployment is locked: the management API requires the admin token (cross-show) or a caller/editor join code (rundown-scoped); the collaborative document channel authenticates every connection and gives follower codes a **read-only** document; dev session tokens are rejected. Unset, the server stays dev-open. Verified against a locked instance: 7/7 HTTP checks and 4/4 show-channel checks (dev token rejected, admin welcomed, follower's transport command refused, bad code closed).
- Admin endpoints: rename/delete events and rundowns (delete cascades sessions, tokens, snapshots), duplicate rundown, `GET /live` (which shows are running), `GET /codes/:code` (landing-page routing). Join-code panel now issues editor codes too and copies role-appropriate URLs.

### Changed — 2026-08-05 (rename: OpenCall)
- The project is now **OpenCall**: repo `robertcmorton/opencall`, packages `@opencall/*`, app title and PWA metadata, Docker/compose service names, hosting service names and domains (`opencall-web-production` / `opencall-sync-production` on Railway), and all docs. No functional changes; existing data is unaffected.

### Changed — 2026-08-05 (milestone 2 · phase 1: design system & UI modernization)
- **New design system** (`globals.css`): color/spacing/radius/elevation/motion tokens with semantic roles; dark theme as the primary show-surface theme and a light theme for the dashboard; Inter for UI text and JetBrains Mono with tabular figures for every timing readout (no width jitter while ticking); one shared component set (buttons, panels, menus, chips, inputs, badges, empty states, skeletons); 130–190 ms eased motion with `prefers-reduced-motion` respected; pulsing LIVE badge.
- **Editor modernized and long-parked parity features landed**: floating formatting toolbar on the active cell (bold/italic/underline/strike/highlight/link/clear); duration popover with **Hide** and **Mute** (mute verified: excluded from cascade math with struck-through display); **multi-select** rows (shift/⌘-click) with a selection bar — duplicate (deep-copies cell content), group toggle, delete; per-user **Columns** show/hide menu persisted locally; ticking time-of-day clock in the header; **⋯ menu** collecting views, export, template, and share panels; connection status dots; sticky column headers; group rows restyled as section bars.
- **Transport bar**: proper icon buttons, primary Next, and Stop now uses an in-app two-click armed confirm instead of a browser dialog.
- **Dashboard restyled** (light theme): event cards, chip links to companion views, labeled create forms, loading skeletons, empty states. Companion and guest surfaces moved onto the token system.
- All flows re-verified in-browser after the restyle: live start/advance/stop, join-code panel, column hiding persisted across navigation, formatting round-trip, duplicate/delete.

### Added — 2026-08-04 (spec: milestone 2 build prompt)
- **`BUILD_PROMPT_2.md`** — the next build milestone, specified end to end in five phases: (1) design-system foundation and full UI modernization (tokens, dark show-surface theme, tabular-figure timing type, component set, motion) folding in the parked visual-parity items; (2) role-based screens with server-enforced access — **Admin** (cross-show control room), **Showcaller** (full console), **Edit** (content-only), **View** (read-only) — plus interim token gating of the doc channel and management API; (3) the run-sheet import pipeline (XLSX/XLS/CSV/PDF upload → extract → detect → column-mapping preview) with tolerant parsers and synthetic fixtures; (4) rundown fidelity features from real-world sheets — milestone/banner rows, row colors, cue-type chips, key times, countdown-to-anchor column, version label, untimed cue pool; (5) live polish — unmistakable active-row highlighting with progress bar on every surface while the timer runs, and formatted print/PDF export with repeated headers and title block.

### Changed — 2026-08-04 (spec: real-world run sheet import)
- The import requirement in `BUILD_PROMPT.md` now covers **uploading existing run sheets as XLSX, XLS, CSV, or PDF** through a single extract → map-columns → preview pipeline, with tolerant parsing of real-world data (free-text durations, mixed time formats, milestone rows, section banners, stacked multi-cue cells, per-page repeated headers). Informed by analysis of real produced run sheets kept as local-only reference material; the print/PDF export spec gained key-times table, repeated per-page headers, and footers to match.

### Changed — 2026-08-04 (single-platform hosting)
- **Everything now runs on Railway in one project**: the web app moved from Vercel to a Railway service at `opencall-production.up.railway.app` (domain targets port 3000), alongside the existing sync server and PostgreSQL. The Vercel project was deleted. One platform, one dashboard, services reference each other's variables directly. `docs/DEPLOYMENT.md` rewritten for the consolidated topology.
- Verified post-move: the Railway-hosted web app serves the same database (existing event and rundown render), the editor connects on both realtime channels over `wss://`, and the in-progress show session carried across untouched.

### Added — 2026-08-04 (production deployment)
- **The app is live**: web at `opencall-web.vercel.app` (Vercel, auto-deploys from `main`, root directory `apps/web`) and the sync server + PostgreSQL on Railway at `opencallsync-production.up.railway.app`. Verified end to end in production: event and rundown created through the live UI, editor connected on both realtime channels over `wss://`.
- **Single public port**: the sync server now serves the HTTP API, the show channel (ws `/`), and document sync (ws `/doc`) from one listener with path-routed upgrades; `PORT` is honored for PaaS hosts. Port 8788 is retired everywhere (dev, Docker, env examples).
- Fresh databases self-initialize on server boot (idempotent DDL), so a new deployment needs no manual migration step.
- ⚠️ Known gap, tracked as the top hardening item: the management API and document channel are not yet authenticated — the deployment is suitable for demo use until API gating lands.

### Added — 2026-08-04 (hardening: durable sessions, join codes, as-run report)
- **Show sessions are now durable**: every transport command writes through to the database (session state plus a transition log), and a restarted sync server hydrates any live session back — a show in progress survives a server crash, verified by killing and restarting the server mid-show.
- **Real join codes**: generate role-scoped six-character codes (no confusable characters) per rundown from the editor's Join Codes panel; companion URLs carry `?code=`; the show channel validates codes and guest tokens against the database and rejects invalid credentials. A development fallback code remains available and can be disabled by environment variable.
- **As-run show report**: the full transition history (which rows ran, when, per session) downloads as CSV from the History panel — rehearsal timing analysis and proof-of-run in one export.

### Changed — 2026-08-04
- Session establishment on the show channel is now asynchronous (database-backed credential checks) with unchanged wire behavior.

### Added — 2026-08-04 (Phase 7: guest pass, version history, packaging)
- **Guest pass**: create read-only share links with per-column visibility from the editor. The server sends guests a filtered projection — hidden columns are absent from the payload, and the collaborative document never reaches guest browsers. The guest page shows a last-updated stamp, refreshes to the latest version, and prints.
- **Version history**: save labeled versions from the editor, automatic snapshot the moment a show starts, and restore any version as a new copy. (In-place restore of a live collaborative document is deliberately deferred until a document-epoch mechanism lands; the API comment documents why.)
- **Self-host packaging**: Dockerfiles for the web and sync services, a compose file with Postgres, healthchecks, and a one-shot seed job, plus a README quickstart. Build-time public URL arguments documented for real deployments.
- Verified in-browser: created a guest link with Script and Production Notes hidden and confirmed at the payload level that they never leave the server; saved and restored a version as a copy; confirmed the automatic show-start snapshot.
- With this, all seven phases of the build plan are implemented; remaining work is the documented hardening list (accounts and API auth, join codes, session persistence, protocol unification).

### Added — 2026-08-04 (Phase 6: events, templates, CSV)
- **Events dashboard**: the landing page now lists events with their rundowns, creates events (name, location, dates), and creates rundowns per event — blank, from a saved template, or by pasting CSV.
- **Templates**: save any rundown as a reusable template from the editor; new rundowns created from a template carry its full content.
- **CSV import/export**: paste-CSV import maps Title/Duration/Start/Type plus department columns by header name (Start values become timing anchors; `Type=group` creates section headers); one-click CSV export from the editor with computed start times. CSV parser/serializer lives in core with unit tests.
- **JSON management API** on the sync server for events, rundowns, and templates (development-open; authentication arrives with the accounts hardening pass).
- Verified in-browser end to end: created an event, pasted a four-row CSV that rendered with a 7:00 PM anchor and correct cascade, exported it back to CSV, saved it as a template, and created a second rundown from that template.

### Added — 2026-08-04 (Phase 5: speaker timer + prompter)
- **Speaker Timer** at `/timer/[id]`: fullscreen countdown for the active cue — green on time, amber inside the final stretch, red counting up on overrun, greyed while reconnecting; double-click for fullscreen; wake lock. Built for confidence monitors and speakers' phones.
- **Prompter** at `/prompter/[id]`: script-column view with a fixed read-position caret, follow-the-caller (smooth-jumps to the active cue as the show advances), auto-scroll with adjustable speed (Space to toggle, arrows for speed), font-size controls, mirror mode, and a word-count/read-time bar.
- PWA install metadata (web manifest + app icon) so companion surfaces can be added to home screens; shared document-connection and wake-lock hooks across all surfaces; per-rundown view links on the landing page and in the editor header.
- Verified in-browser: timer counted down the live cue in the bordered display; the prompter opened on the active cue and smooth-scrolled to the next one when the console advanced the show.

### Added — 2026-08-04 (Phases 3–4: live mode + broadcast)
- **Live timing math in core** (`computeLiveTiming`): pause-aware elapsed/remaining in the active row, per-row overrun, cumulative show drift (actual vs. planned start plus current overrun), and projected end time — all computed locally from timestamps and the measured clock offset, per the protocol's no-streamed-ticks rule; unit-tested with a pluggable timezone mapping.
- **Show-channel client** for the web app: session establishment, median-of-five clock-offset sampling, sequence-guarded state updates, jittered reconnect backoff, and idempotent command ids.
- **Console live mode**: caller transport bar (Start / Pause / Resume / Prev / Next / Stop-with-confirm) with Space and Shift+Space shortcuts suppressed while typing; LIVE/PAUSED badge; active-row highlight; header readouts for item countdown (green, red count-up on overrun), cumulative show drift, and projected end.
- **Companion follower surface** at `/follow/[id]`: glanceable current cue with giant countdown, script card, next-cue strip, drift/projected-end line, and a screen wake lock — follows the caller's position live.
- Verified end to end in a real browser: console started the show, a phone-width follower ticked the countdown locally, advancing on the console moved the follower instantly, and stop returned both to idle.

### Fixed — 2026-08-04
- Render loop in the live-timing hook (effect depended on per-render objects); inputs now flow through refs with a mount-once interval.

### Added — 2026-08-04 (Phase 2 editor core)
- **Collaborative rundown editor** ([apps/web](apps/web)): spreadsheet-style grid over the Yjs document — TipTap rich-text cells (mounted per active cell, bound to each cell's shared fragment), inline Start/Duration editing with shorthand parsing, visible anchor flags with one-click reset-to-auto, drag-and-drop row reordering (dnd-kit), group-header rows with toggle, add/delete rows, add columns, row selection, and a live planned start/duration/end header driven by the timing engine. Landing page lists rundowns from the sync server's read API.
- **Document sync with persistence** ([apps/sync](apps/sync)): Hocuspocus server backed by the database — documents load from the rundown's stored state and debounce-write back on change; minimal HTTP read API for rundown listings. (Doc channel runs on its own port for now; folding onto the single-socket protocol is tracked for Phase 4.)
- Wall-clock time parsing in core (`parseTimeOfDay`), rundown metadata (name, planned start) carried inside the document, and a unified dev database location shared by seed and sync.
- Verified end to end in a real browser: seeded grid renders; a duration edit recascaded every subsequent start time and the header totals; the same edit propagated live to a second browser tab; and after stopping the servers the edit was read back from the database intact.

### Added — 2026-08-04 (Phase 1 scaffold)
- Monorepo scaffold (pnpm + Turborepo, strict TypeScript): `packages/core`, `packages/protocol`, `packages/db`, `apps/web`, `apps/sync`, plus root Docker Compose (Postgres) and `.env.example`.
- **Timing engine** (`packages/core`): cascade with anchor flags (last-anchor-wins), back-timing, muted/hidden durations, duration-shorthand parsing, time formatting — pure functions, unit-tested.
- **Protocol package** (`packages/protocol`): Zod schemas for every PROTOCOL.md message, close codes, and a safe client-frame parser, with schema tests.
- **Database package** (`packages/db`): full Drizzle schema per the data model, bootstrap DDL, Postgres/embedded-PGlite dual driver, Yjs rundown-document builder/projector with reconciliation rules, and a seed script that round-trips the demo rundown through the database and prints its computed timing.
- **Sync server** (`apps/sync`): WebSocket server implementing session establishment, roles, clock-sync ping/pong, idempotent caller transport commands over an authoritative show-state machine (monotonic `seq`), presence, and heartbeats — verified by a two-client smoke test (caller + follower receive identical state sequences; follower commands rejected).
- **Web app** (`apps/web`): minimal Next.js shell rendering the demo rundown through the shared timing engine; grid editor arrives in Phase 2.
- 18 unit tests across four workspaces; `pnpm build`, `pnpm test`, and `pnpm seed` all green.

### Added — 2026-08-04 (video research, second pass)
- Transcribed and analyzed ten training videos (two webinar series, a basics webinar, and six short feature clips) covering the reference rundown product in depth. Spec updated with the resulting v1 features: visible manual-override anchor flags with reset-to-auto and last-anchor-wins cascade semantics; back-timing (calculate-upward rows); a segment-budget countdown column; duration shorthand entry; advance-and-retime transport shortcut; jump-to-row while live; as-run timestamp column with repeat counts, notes, and show-report export; per-row over/under offset trail with running total, projected end, and rehearsal reset; multiple simultaneous callers with per-follower caller picker and passive follow mode; fullscreen item timer; Featured and Display companion views (caller-controlled column); remote-controlled prompter links; per-cell content restore; export presets with branding and page breaks; event-scope guest landing pages; event file storage with export-live file links; templates that carry default crew.

### Added — 2026-08-04 (video research)
- Fourth research pass: full transcript of a 2016 walkthrough video of the first-generation web rundown product our reference platform grew from (recorded in local research notes). Spec updated with newly confirmed v1 features: per-user column layout, private notes, personal vs. global highlights, per-user theme, per-cell change history and activity feed, event duplication, formatted PDF export, Space/Shift+Space show-caller shortcuts, follower auto-scroll, and item runtime clocks that count down then turn red counting up on overrun. The video also validated the web-first Mac/PC + phone/tablet companion strategy.

### Added — 2026-08-04 (Phase 1 start)
- Phase 1 design proposals for review, per the build prompt's gate: [docs/DATA-MODEL.md](docs/DATA-MODEL.md) (Postgres schema for identity/teams/events/rundowns/sharing/show-state, plus the Yjs rundown document shape with reconciliation rules and persistence strategy) and [PROTOCOL.md](PROTOCOL.md) (versioned WebSocket protocol: session establishment for signed-in/join-code/guest clients, NTP-style clock sync, server-authoritative show state with monotonic sequence numbers, caller transport commands, guest JSON projection, presence, reconnect/staleness contract, error codes).

### Changed — 2026-08-04 (later)
- Rewrote [BUILD_PROMPT.md](BUILD_PROMPT.md) as the definitive kickoff prompt: added the showcaller event-creation flow, the show-day multi-device broadcast model (join codes/QR, roles, server-authoritative show state with client-side clock-offset countdowns, reconnect/stale handling), and a cross-platform strategy — one responsive web app for Mac/PC browsers plus phone/tablet companion surfaces (PWA, wake lock) in v1, with timing/protocol logic isolated in platform-agnostic packages and a versioned documented WebSocket protocol so native iPhone/Android apps can be added later without a rewrite. Build order expanded to seven phases ending with protocol docs and self-hosting packaging.

### Added — 2026-08-04
- Completed a third research pass: hands-on exploration of a desktop timecode-driven show-automation reference app. Recorded in local research notes: frame-accurate cue timelines chased by external timecode, typed automation tracks (camera cuts, graphics, OSC/MIDI/HTTP/GPIO, text, playback), live-punch cue authoring, live override controls (skip/hold/take), per-cue flags/markers/auto-numbering, and companion-device pairing. Spec's future-scope section extended with a possible timecode-chase "pro mode" and live override verbs.
- Project kickoff: product spec and build prompt ([BUILD_PROMPT.md](BUILD_PROMPT.md)), README, and permanent project rules ([CLAUDE.md](CLAUDE.md)).
- Completed a detailed product-research pass for the core rundown/show-caller scope; findings captured in local research notes (kept out of the repo by design). Spec updated with: overflow-menu structure (Settings / Views / Export / Guest Pass / History), prompter behavior and controls, speaker-timer sharing, guest-pass column visibility, event content model (rundowns, folders, file uploads, CSV import), and timing-engine details (cascade recalculation, hard starts, hide/mute duration).
- Completed a second research pass covering event project management; recorded as future (post-v1) scope: task lists with reusable templates, nested subtasks, milestones, dependencies, tags and watchers; list/Gantt/calendar views; public read-only calendar links; per-event content hub (notes, files, links); per-event team chat; notification fan-out to assignees and watchers; guest users with task-scoped visibility; org-level KPI dashboard.
- This changelog.

### Changed — 2026-08-04
- Repo hygiene: all reference material moved to local-only files excluded via `.gitignore`; git history rewritten to a single clean root commit containing no reference material.
