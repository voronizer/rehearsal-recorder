# The design system

How РЭХА's screens look and how they work: each rule in a line or two, why
it is there, and what in the code carries it. The full reasoning, with the
mockups and rulings behind every rule, is the spec,
[superpowers/specs/2026-10-08-design-system-design.md](superpowers/specs/2026-10-08-design-system-design.md);
the numbers here are its numbers. A path inside `ui/src/` is written from
there: `lib/notices.ts` is `ui/src/lib/notices.ts`.

Three decisions sit under the rest. The app has its own look, the same on
the Mac and on Windows, and takes three habits from the system it runs on:
its font, the order of a dialog's buttons, and its words (D3). The app and
reha.stream share one foundation of colours, font and sizes, so the site
shows the app as it is; the site keeps its own big headings and layout
(D4). And the rules cover how a screen works as much as how it looks (D5).

## Where things stand

The foundation is in: the theme values, the shared components, Undo, the
showcase and the check. Every screen is redone on it: the start screen, the
rehearsal screen, the recording screen, Review (the screen after Stop),
History, Drafts (the unsaved takes the app offers at its start), Settings,
and the big player that Review and History open takes in. Their pieces are
the shared ones, New set's song list included, which the start screen
shares with Settings' Sets, and the check's [allow-list](#the-check) is
empty. Where a rule below says "as each screen is redone", the screens'
pull requests have carried it out. On reha.stream the pieces of the app are
the real components, and the page around them takes the app's light colours,
the system's font and the five text sizes (`site/src/page/page.css`); its big
headings, corners and layout are its own. Only the link picture
(`site/og.html`) keeps Instrument Sans, since it is drawn once into a PNG.
The new look goes out in one release.

## The foundation

Every value lives in one file, `ui/src/index.css`, which the app, the
showcase and reha.stream all import. A screen uses the names (`bg-primary`,
`text-sm`, `rounded-md`), never a value.

### Colour

- **F1. One accent, cobalt.** `oklch(0.56 0.24 266)` with a white label, the
  same in both themes: one bright colour for what matters, on a screen that
  is otherwise nearly black and white. White on it reads at 4.8:1.
  `--primary`, `--primary-foreground` and `--ring`; reha.stream's accent is
  the same variable (`site/src/page/page.css`).
- **F2. The accent is for the one main action and for what plays.** A blue
  that also meant "on", "selected" and Stop pointed at nothing in
  particular. A selected tab, pill or row, and a switch that is on, are
  `bg-selected`, a grey. Stop is `strong`, the text's own colour
  (`Button variant="strong"`): that look is Stop's alone. The record red,
  the danger red and the statuses keep their own colours. In a set, the song
  the next take is named after is a selected row, with *next* and ✓ in the
  text's colours; notes coming in from MIDI are grey; notes played in the
  player's notes lane stay in the accent, as what plays. Whatever is blue
  today for "selected" or "on" turns neutral as each screen is redone, and
  so do the MIDI notes.
- **F3. A mark's label is one of eight colours, and blue is orange.** A blue
  mark disappeared into the played part of a waveform, which is the accent;
  now cobalt is the only blue in the app. The stored key stays `"blue"`, so
  no library needs a migration, and is drawn with `--label-orange`
  (`lib/labels.ts`); orange stands sixth in Settings' picker, where blue
  was.
- **F4. A group has no border.** An outline round every panel made the
  screens busy. In the dark theme a card a shade lighter than the page is
  enough to set a group apart. In the light theme the page is white, as the card
  is: a grey page with grey fills on it read as grey on grey, and grey text
  on them fell under 4.5 to 1. So there air and the group's own lines set
  it apart, and grey is left for a side panel, a well, what is selected, a
  hover and a pill. On a side panel a card is white on the grey in light,
  and lighter than the panel in dark. `lib/theme.test.ts` checks that the
  card is at least 0.03 lighter than the page in dark and than a side panel
  in light, and that grey text reads at 4.5 to 1 or more on every fill in
  both themes: the page, a card, a side panel, a pill, a secondary button,
  a hover and what is selected. The `Card` component
  is C7. Fields, buttons and dialogs keep their frames. The bordered panels
  lose theirs as each screen is redone.

### Type

- **F5. Five text sizes, in rem: 12, 14, 16, 20 and 24, with body text at
  14.** Fifteen sizes made no order, and a size in px ignores the Appearance
  scale in Settings. `text-xs`, `text-sm`, `text-base`, `text-xl` and
  `text-2xl`; the body is `text-sm`. A screen's old sizes go 9, 10 and 11 to
  12; 13 and 15 to 14; 18 to 16; 22 to 20; 26 and 28 to 24. Text sized from
  the window (the recording clock, the track tiles) keeps sizing from it.
  Two weights, 400 and 600, are enough to tell a heading from text at five
  sizes. The check refuses px sizes and sizes off the five; the weights are
  not checked.
- **F6. The system's font**, San Francisco on the Mac and Segoe UI on
  Windows (`--font-sans`). Nothing is downloaded, so the app looks the same
  in a room with no internet. Figures take the `tnum` class: every digit the
  same width, in the same font, so times and counts line up in a column.
  `font-mono` is for file paths and technical values.
- **F7. No capitals made by CSS, and buttons in sentence case.** A label
  reads as it is written, "Last time" rather than "LAST TIME", and a button
  is a plain phrase, "Start rehearsal", with no Title Case on the Mac
  either. A heading that relied on capitals gets its weight and size when
  its screen is redone. The check refuses `uppercase`.

### Space and shape

- **F8. More air on every screen.** Big type and room round it, with little
  on screen at once (D6). How much is settled per screen, on its mockup; on
  the rehearsal screen the room comes from lower lanes (C6). Spacing takes
  the steps 2, 4, 8, 12, 16, 24, 32, 48 and 64 px. The check leaves spacing
  alone, since alignment needs its small odd offsets, so this document and
  the showcase carry it. `--screen-pad-y` is the space above and below a
  screen: Shell pads by it, and the player's master strip holds to the edge
  past it, so the two cannot drift apart. In a window too short for the
  recording screen, things give way in one order. First the clock and the
  take's name over it get smaller, down to the clock's 3 rem. Then the
  tiles' least height gives way, from 12.5 rem down to 6 rem. Only then
  does the screen scroll. The clock is also never bigger than 10:00:00 has
  room for inside the screen's air (32 px round the screen, 48 between its
  two groups and 24 inside one), so after ten hours it does not run off the
  left edge. `screens/Recording.tsx` fits this as the screen comes up and
  when the window or the Appearance scale changes, never because of
  anything the take does, so nothing moves while the band plays (B4).
- **F9. Three corner radii by role, plus round.** Nine radii said nothing;
  three say what a thing is. 4 px for small things (key chips, tags, take
  bars, M and S): `rounded-sm`, or bare `rounded`. 8 px for controls
  (buttons of every size, fields, selects, menus): `rounded-md`. 12 px for
  groups and dialogs: `rounded-lg` or `rounded-xl`. `rounded-full` for round
  things (play buttons, pills). A take's bar is `rounded-sm` at every size
  and in every place (after a take, under Last time, in History's strip, on
  a song's page and in Marks): one 2 px wide is a pill, since the browser
  cuts a corner down to fit the side it is on. A
  graphic, such as a 1-2 px line or a mark's diamond, keeps its own, with
  a `design-ok` comment ([the check](#the-check)). The check refuses
  `rounded-xs`, `rounded-2xl` and up, and a radius of one's own in
  brackets; `rounded-none` passes.

### Motion

- **F10. Smooth.** Motion says where a thing came from and that the app
  heard the click; it is never decoration, and it is short, never over
  400 ms (F11). What appears rises 12 px and fades in over 250 ms, easing
  out: `animate-rise`, on `--ease-smooth` (`cubic-bezier(.2,.8,.2,1)`). A
  screen brings its groups in one after another, 40 ms apart, by setting
  `--i` on each to its place. Dialogs, menus and notices take 220 ms
  (`animate-in`, `animate-out`); a hover's colour takes 200 ms, the default
  transition. The screens take on `animate-rise` as each is redone.
- **F11. Motion gives way.** Someone who turns on the system's Reduce motion
  has said that movement on screen bothers them, and the app takes their
  word for it. While a take records, the screen is read from across the room
  by people playing: it is there to show that the take is running, how long
  it has run and what is coming in, so apart from the meters and the clock
  nothing on it should move or draw the eye. Do not add an animation to the
  recording screen. Under Reduce motion, and while a
  take records, `animate-rise`, `animate-in` and `animate-out` do not play:
  a dialog is simply there. Spinners and pulses (`animate-spin`,
  `animate-ping`, `animate-pulse`) stand still too: a still arc still says
  "busy". `index.css` turns them off; the recording screen puts
  `data-recording` on `<html>` while it is up; what CSS cannot reach,
  such as a smooth scroll, asks `motionOff()` in `lib/motion.ts` as it
  moves (a scroll through `scrollBehavior()`). Meters and the clock are
  readings, not motion, and keep moving; the record dot is still. So are the
  metronome's beat dots and the window's edge lit on each click
  (`BeatDots`, `EdgeLight`): they go on and off on the click with no fade
  or transition, and keep doing so while a take records and under Reduce
  motion, since the band may count on them. The count-in's digits are a
  reading in the clock's place. Nothing takes longer than 400 ms
  (`lib/theme.test.ts` checks every duration in the file).

## The system's habits

- **P1. One place knows which system it is**, `lib/platform.ts`: `system()`,
  and `useSystem()` for a component that has to redraw when it changes.
  Checks scattered through the code are how a Mac word ends up on Windows.
  `setSystem()` tells it to be another system, which is how the showcase
  shows both.
- **P2. The system's words.** ⌘ or Ctrl, Finder or Explorer, the Trash or
  the Recycle Bin: a list of keys that says Ctrl on a Mac is wrong. They
  come from `words(useSystem())`; `lib/deletion.ts` says where a removed
  thing went in them, or "the _deleted folder" on a computer with no Trash.
- **P3. The system's order of dialog buttons.** On the Mac the action is
  rightmost; on Windows it comes first, where Windows has taught people to
  look for it. `DialogButtons` (C3) stands them in order.

## Shared components

Each piece below is to be one component, so that it looks and works the
same wherever it appears. Those that exist are in `ui/src/components/ui/`,
each with a story for every state (U5), except three that are shared but
live outside it: the notices (`components/Notices.tsx` and
`lib/notices.ts`), `ConfirmDialog` (`components/ConfirmDialog.tsx`) and
`TakeTitle` (`components/TakeTitle.tsx`). The metronome's pieces live
together in `components/metronome/`, and the backing track's in
`components/backing/`, each with its story beside it (the last lines
below). A screen that still builds a piece of its own moves onto
the shared one when it is redone.

- **C1. Button.** Every button is the shared `Button`: a hand-made
  `<button>` has to remember the focus ring, the hover and the disabled look
  on its own, and some forgot. Variants say what a button is for: `default`
  (the accent, the one main action), `strong` (Stop), `destructive` (what
  cannot be brought back; full red in the dark theme too, where 60% read as
  switched off), `outline`, `ghost`, and `link` (the text's colour with a
  thin underline). Sizes say where it goes: `default`,
  `row`, `footer`, `footer-aside`, `icon`, `icon-row`, `icon-tiny` and
  `player`. The foot of a screen is one row, `FooterRow`: what the screen
  has to say at the left, its buttons at the right, the main one rightmost,
  so that it is in the same place on every screen. The main one is `footer`
  (56 px): Start rehearsal, Record take, Stop, Save take and Recover, which
  is Recover all while more than one take is listed or a run goes on. The
  ones beside it are `footer-aside`: Finish, Discard and Decide later.
  A take's own Recover in Drafts is `outline`, so the footer's stays the
  screen's one blue button (F2). A line between the two halves
  (`rule`) is for a left half that is a field, as the start screen's name
  field is. Review's left half is a line of text, and it has no line.
  Every variant has the same weight and the same 1 px border, so
  a toggle that swaps variants never changes width and never moves what is
  beside it; all but `link`, which has no frame: it is bare words, never
  swapped with a filled button, and a clear frame set them 1 px in from what
  they line up with. The check refuses `<button` outside `components/ui/`.
- **C2. The small player**, `PlayButton`: one round ▶ for a take in a list
  or on a page, where there were four hand-made ones in three sizes. 32 px
  (`size="row"`), or 48 on the song page (`"head"`); a thin border, and the
  accent while its take is loaded or playing. Its `look` comes from
  `playLook()` in `lib/playLook.ts`, and covers a take that is loading (a
  spinner after its first second), one that failed to load (it says so, and
  pressing tries again) and one not on disk (a ▶ that cannot be pressed).
  Played from a mark, it starts 5 s before the mark. The screens replace
  their own ▶ with it as each is redone. The big player is not part of it.
- **C3. Dialog**, `dialog.tsx`: one frame for every dialog, with 12 px
  corners, a 16 px title and the veil behind it; `size` is `default`,
  `narrow` (a list of keys) or `tall` (hung near the top and growing down,
  as New set does). Its buttons are `DialogButtons`, in the system's order
  (P3). The way out says "Cancel" in every dialog that has an action (one
  whose options act at once has only "Close"), and the action is a verb:
  "Finish", "Remove", "Delete". Enter presses the action, except in a
  question nothing can undo, where Enter presses Cancel and a stray key
  changes nothing; that question is `ConfirmDialog`, in
  `components/ConfirmDialog.tsx`. A red button only for what cannot be
  brought back. The title and text stay as they were while it fades out
  (`useHeld`, `lib/held.ts`). The check refuses `role="dialog"` and
  `<dialog>` outside `components/ui/`.
- **C4. A notice can carry one action**, such as Undo (B1):
  `notify({ …, action, onGone })` in `lib/notices.ts`. A notice with an
  action stays 10 s, whatever its kind, and the pointer over it pauses the
  time; `onGone` runs once, when it leaves without its action having run.
  `Notices.tsx` draws the notices above a dialog's veil, so an Undo is never
  under one. Three show at most, and a fourth makes room with the oldest
  that has no action: an Undo still in its time goes only when every other
  notice up has one too. ⌘Z or Ctrl+Z runs the newest notice's action
  (`hooks/useUndoKey.ts`), except in a text field, which undoes its own
  typing, with a dialog, a menu or a list open, or while a take records.
  What a button could not do is said in a notice of kind `error`, the
  footer's buttons included (Start rehearsal, Record take, Stop, Save take,
  Discard), as the evening's buttons and Settings say theirs. It stays
  until it is closed or its screen is left, and a retry puts it away; an
  answer that comes once its screen has gone says nothing
  (`hooks/useErrorNotice.ts`). It is drawn over the screen, so it moves
  nothing (B4).
  A call into Python that raised is not a notice: it goes in the red bar
  across the top (`components/ErrorBar.tsx`, from `lib/bridgeErrors.ts`),
  which lists every problem said until it is put away, oldest first and the
  same one once, so a second problem at start no longer hides the first.
  It lists the first 20 and counts the rest under them, each once ("and 5
  more"): in a cascade the first is the cause, and a full list stops
  changing while only the count moves. One Dismiss puts them all away; a
  long list scrolls inside the bar, which stops at 40% of the window. The
  bar is `aria-atomic="false"`, so a screen reader says only a new problem,
  not the whole list again; the count line is `aria-live="off"`, read with
  the bar rather than at each change. A problem raised in the page itself,
  such as a notice's callback that threw, goes in through `reportPageError`,
  which also sends it to crash.log (`log_problem`), once per problem, so the
  bar's "all of them are in ~/.rehearsal-recorder/crash.log" holds for it
  too.
- **C5. Kbd**, `kbd.tsx`: one key chip, in the colour of the text round it,
  so the same chip reads on a page and on a filled button. Its ⌘ or Ctrl is
  `words().mod`. On a button the chip is `aria-hidden`, and the button names
  its key with `aria-keyshortcuts`.
- **C6. Track lane.** A rehearsal lane is 56 px, 3.5 rem so it grows with
  the Appearance scale (`LANE_REM` in `components/Timeline.tsx`). At 96,
  five tracks took a laptop's whole screen. The Mono or Stereo line under a
  track's name is gone. The name has the plate's whole width, and a name cut
  at its end shows whole on hover and on keyboard focus (`Whole reach`).
  Under it is the fader, with M and S after it. M and S are
  `Toggle size="lane"`: 20 px, 12 px text and 4 px corners, 6 px apart,
  which keeps their 24 px touch areas apart (WCAG 2.5.8), and grey when on.
  Master's click button after its name is the same toggle.
  The fader shows keyboard focus on its thumb, in the shared ring, wherever
  a player stands (Review, the rehearsal screen, History): the browser's own
  outline would go round the whole track.
  The lanes are one group on the card's fill, with no lines between tracks:
  each lane's picture, a waveform or a lane of notes, sits on a well of its
  own (C7), with 3 px of the group's fill above and below it, and a Both
  track's audio and notes share one well split by a 1 px line. That split
  is two class strings, said once in `Timeline.tsx`.
  `LanePlate` is the plate beside a lane, the same for audio, notes and the
  master; `LanePlate grouped` is a plate in the group, with no fill or
  corners of its own. A notes lane is as tall as its plate needs. Master is
  its own group on the card's fill, sticky at the bottom in a band as wide
  as the lanes, so that no part of a lane shows beside it: its plate and,
  right of it on the same columns as a track's row, the click's lane on a
  well (`MasterClickLane`).
  A take's Backing track, the last lane above Master, has a dashed border
  round its plate and its well, in the muted text's colour at half
  strength, and "Stereo file" or "Mono file" after its name: a file played
  into the take, not an input the band recorded.
- **C7. Group**, `Card`: a panel set apart as F4 says, with 12 px
  corners, 16 px inside, and no border or shadow. A screen gives it more air
  with `className`. It takes the place of about 21 hand-made bordered boxes
  as each screen is redone. A group of rows, such as the start screen's
  tracks or the evening's songs on the rehearsal screen, splits them with
  1 px lines and lets each row keep its own padding. Where each row holds a
  picture of its own, as the player's lanes do, the pictures' wells split
  the rows instead, and there are no lines. A well is where a picture or a
  recording tile sits in its group: `bg-well`, with 8 px corners and 3 px of
  the group's fill round it. `--well` is the side panel's colour,
  `var(--panel)`, in both themes, a shade darker than the card it is on. The
  page's colour was faint on the card in dark, and in light, where the page
  is white as the card is (F4), it would not show at all.
  `lib/theme.test.ts` checks that a well is the side panel's colour.
- **C8. Everything else that is built more than once.** About thirty kinds of
  piece are built two to sixteen times each, and each copy drifts from the
  others. Each becomes one shared piece, taken from shadcn/ui where it has one
  (U1). Some are in `components/ui/` already, and the copies made by hand move
  onto them: dividers (`Separator`), chips (`Badge`), progress bars
  (`Progress`), and, added with the start screen, on/off and pick-one buttons
  (`Toggle` and `ToggleGroup`, with arrow keys inside a group), one list row
  (`Item`, every row reachable by keyboard), warnings (`Alert`), loading
  (`Spinner`), empty states (`Empty`), tooltips (`Tooltip`) and meters
  (`Meter`); added with Review, checkboxes (`Checkbox`) and a song's takes as
  columns (`TakeColumns`), which Last time and Review share; added with
  History, expanding (`Collapsible`), which opens a rung of a song's ladder.
  Two more of our own live in `components/`. The set card, `SetCard`
  (`components/NextTakeSongs.tsx`), is one piece under Next take and in
  History, with the same title on both, "Gig on the 25th · 4 of 6 played".
  Given `onGoTo` it is History's: a song played goes to its takes, one not
  played is disabled and says so, and no song is next or lit. The pane head,
  `PaneHead` (`components/PaneHead.tsx`), heads History's three pages, a
  rehearsal's, a song's and a label's: what leads it, the title with the
  pencil after it, the lines under it and the actions at the right (B6). Only
  History uses it, so it is not in `components/ui/` (U3). Settings' tabs are
  built from two more. `SettingsGroup` (`components/SettingsGroup.tsx`) is
  one group of a tab: a `Card` 24 px inside that rises in at its place. Given
  a title, it is a region named by its heading, with a hint under the heading
  and an action at its right, where Keys puts its switches. Only Settings
  uses it, so it is not in `components/ui/` (U3). `PickRow`
  (`components/ui/pick-row.tsx`) is a pick-one in a group: the row's name
  with the shared `switch` beside it, named by it. Rate, Depth, the copies'
  format, What gets sent, Theme and Scale are `PickRow`s, and Keys' On and
  Off are the same switch at a group's head, so every choice of one among a
  few words looks and works alike. The metronome's Sound and Count-in are
  `PickRow`s as well, behind the gear on the rehearsal screen and in
  Settings, so it is in `components/ui/` (U3).
  The rest are added by the first screen's pull request that needs them: one
  ✕, one link, one size of icon button, a field with a button (InputGroup),
  screen header and side panel. A take's name is written by
  `components/TakeTitle.tsx` (`TakeTitle` in lists, `GoTitle` in headers and
  pills); only the song tabs (`SongTab.tsx`) and the song ladder
  (`SongLadder.tsx`) still draw the number themselves. A track that records is
  one tile, `TrackTile` (`components/TrackTile.tsx`), where the MIDI tile was
  a copy of it: its levels, with a narrow column for its notes on Both, or
  with `kind="notes"` a MIDI track's notes alone. Its fill is `Meter` up, and
  its name is `TileName` (B6). On the recording screen the tiles are one group
  on the card's fill, each tile on a well of its own (C7), and reha.stream
  shows them so. A take drawn as a bar is as tall as it ran against the
  longest, through `drawnLength` (`lib/takeScale.ts`), never under a few
  pixels. The bars of an evening's takes, on the rehearsal screen and in
  History, of a song's ladder and of the Marks page are filled alike, from
  `TAKE_FILLS` beside it: the plain fill, the starred one and the quiet one (a
  false start, or a take not on disk). Each place adds only what its bars do
  under the pointer. "Selected" has two looks instead of seven: the white
  plate inside a switch, and a grey fill for a row, pill, tab or toggle that
  is on. The full table, with every place each piece is built today, is C8 in
  the spec.

The other shared components, each with its stories:

- **Input**, `input.tsx`: a text field, with the shared focus ring and a red
  frame when `aria-invalid`: the rehearsal's name on the start screen, the
  rename dialogs, a mark's note, a label's and a set's name, the folders in
  Settings.
- **Label**, `label.tsx`: the name over or beside a field, on the start
  screen, in Settings and its Sets and Under the hood, and in New set. It is
  regular weight, as the system's own form labels are.
- **Select**, `select.tsx`: a pick-one list that opens over the screen, in
  `default` and `sm` sizes, for a choice too long for a row of buttons: a
  track's input on the start screen, the audio driver and device, the output
  channels, a MIDI port, and the label a deleted label's marks get.
- **Popover**, `popover.tsx`: a small panel that opens from a button and
  closes on Esc or a click outside, for a few controls that need no screen
  of their own: a track's icon grid, the playback volume in the header, the
  background work list, a label's colours, and *All songs…* under the take's
  name. `PopoverAnchor` hangs one from something that is not its button,
  with the focus left where it is: the line under the Next take field that
  says an old name is a song's now, as wide as the field.
- **DropdownMenu**, `dropdown-menu.tsx`: a menu of things to pick or do,
  with a check on the chosen one. The set picker beside **Start rehearsal**
  is its one use so far.
- **Separator**, `separator.tsx`: a 1 px line in the border colour, across
  or down. Under the hood's line over the interface check is its one use.
- **Badge**, `badge.tsx`: a small pill for a word or a count, in the accent,
  a neutral grey, the danger red (full in both themes, as a destructive
  Button is), the signal green or the warning yellow, its word at 600. The
  *false start* on a take's row is one, and so is each of a song's old
  names under its title in History, `outline` with its ✕; the chips still
  made by hand move onto it.
- **Progress**, `progress.tsx`: a thin bar in the accent for how far along a
  job is, where it was started (the take being saved under Stop, a crop, a
  draft, a new version downloading in Under the hood) and in the background
  work list.
- **Tooltip**, `tooltip.tsx`: a small tip in the text's colour. On hover it
  comes after 400 ms, so a pointer on its way across the screen is not
  asking; on keyboard focus it comes at once. Focus the mouse left opens
  none: a click, or a menu or popover shut with a click handing focus back
  to its button. It is gone with Esc or the pointer leaving. It is for a
  name a row had to cut, shown whole (B6), for what an icon button does, and
  for a word on a button that needs a line to say what it does (Stereo):
  C8's native `title` tooltips. A tip that only repeats its button's name is
  for the eyes (`aria-hidden` inside it), so a screen reader does not hear
  the name twice. Each `Tooltip` has its own provider, so it needs nothing
  round it.
- **Sheet**, `sheet.tsx`: a panel that slides in from the left or the right
  over the window's full height, 28 rem wide and never wider than the window
  less 3 rem. It is a dialog on the Dialog's veil and z-index, so the notices
  stay above it and a click on one does not close it (C4); Esc, the veil and
  its ✕, the shared `Button`, close it and the focus goes back to the button
  that opened it. For the start screen's left part in a narrow window, the
  narrow form of C8's side panel.
- **Toggle**, `toggle.tsx`: a button that stays pressed (`aria-pressed`), in
  `default` and `outline`, sized as Button's `row` (32 px) and `icon-row`,
  and `lane`, the 20 px square of M and S on a track's plate (C6), with 12 px
  text and 4 px corners. On is the grey `selected` fill, never the accent
  (F2), and it has the same weight and 1 px frame on or off, so pressing it
  moves nothing. C8's on/off buttons: Stereo, the strip's Songs, the
  player's Repeat, and M and S. Check signal says what pressing it does
  ("Check signal", "Stop checking"), and a toggle's name must not change
  with it, so it is a Button, grey while the check runs.
- **ToggleGroup**, `toggle-group.tsx`: pick one or several, with the arrow
  keys moving along the group and Tab leaving it. `default` and `outline` are
  Toggles joined into a bar; `switch` is History's switch, a grey track with
  the chosen item a plate on it with a light shadow, as wide as the screen
  makes it (`size` does nothing for it). History's two, the view and Group
  by, are `orientation="horizontal"`: ← and → move along them, and ↑ and ↓
  stay the list's while one of them has focus. With `type="single"`,
  pressing the chosen item again empties the group (`onValueChange("")`),
  so a pick-one that must always have one chosen ignores the "", as
  Audio · Both · MIDI does (`ModeSwitch`), and so does a mark's label
  (`MarkerDialog`). In a dialog a pick-one group is one Tab stop too
  (`useDialogFocusKeys`). C8's three identical segmented switches and its
  pick-one groups.
- **Alert**, `alert.tsx`: a box for a line the screen has to say, with an
  icon, a title and a text, all optional. `warning` is the theme's `warn`
  colour on the icon and the edge with a faint wash behind; `destructive` is
  a failure; `default` is neutral. C8's warnings and errors. Its `size` is
  `box`, the default, or `line`: the icon in the variant's colour, and one
  line of 12 px words, red for `destructive` and in the text's colour
  otherwise. It is 24 px tall whatever it says, with no box or wash, and
  cut with "…" where the room ends, whole in the shared tip. `line` is for a
  place that keeps one line for whatever it has to say, as the player does
  (B4). `Warning`, from the same file, is a `warning` box with its triangle
  and one paragraph, said as a status: for a warning over a list that stays
  as long as it holds, as the start screen's tracks and the unsaved takes
  have.
- **Spinner**, `spinner.tsx`: lucide's `Loader2Icon`, turning, `role="status"`
  and named Loading. It is there from the start but invisible for the first
  second (`SPINNER_AFTER_MS`, or its `after` in ms), so a quick answer does
  not flash it and nothing moves when it shows (B4, B5). It stands still under
  Reduce motion and while a take records (F11). C8's loading signs. A control
  that keeps its own icon until the spinner takes its place, as the small
  player, Look again, Check signal and Start do, counts the second with
  `useAfter` (`hooks/useAfter.ts`), the hook the Spinner counts with.
- **Empty**, `empty.tsx`: an empty list that says what will be here and how it
  gets here (B7): a title, a line, and the button that fills it. C8's empty
  states.
- **Item**, `item.tsx`: the one list row (C8): a title, a line under it and
  what can be done at the end, in `default`, `outline` and `muted`. A row that
  goes somewhere is an `asChild` link or button, which Tab reaches and Enter
  follows, with the shared focus ring.
- **Meter**, `meter.tsx`: one meter for a reading that moves, C8's meter:
  the signal check's level (`tone="signal"`, the signal green) and the notes
  check's velocity (`tone="notes"`, grey in the text's colour), and a
  recording tile's level and notes. `sides` are values from 0 to 1. Across,
  the default, it is one thin bar, and two sides split it along its length,
  the first above, the second below, so a dead half of a pair shows. With
  `direction="up"` it fills the box it is given, with no frame or ground of
  its own, as the tile is its ground: each side rises from the bottom,
  beside the other, with a line on its top, and a side at 0 draws nothing.
  `held` draws a 2 px line where each side's peak stands, and a side in
  `clipped` is drawn in the danger red. The tile keeps its own dB scale and
  gives the meter how far each fill reaches. It follows its value over
  75 ms and keeps doing so under Reduce motion and while a take records: a
  meter is a reading, not motion. It is a picture, hidden from a screen
  reader, unless given a `label`, and then a `meter` at its largest side.
- **Whole**, `whole.tsx`: B6's pieces for a long name. `Whole` is a plain
  text that shows whole in a tip on hover when it is cut; the keys do not
  reach a plain text, so it has no keyboard focus to show on. With `reach`
  it is a Tab stop while it is cut, with the shared focus ring, and its tip
  shows on keyboard focus too; one that fits is no stop. A name on a track's
  plate, and a notes plate's name and port, are `Whole reach`. `useCut` and
  `WholeTip` do the same round a button, a link or anything with a
  `tabindex`, the tip also showing on keyboard focus and staying while focus
  is there, even when focusing scrolled the panel. The tip is for the eyes:
  what it says is in the page already, so it is not read out again as the
  control's description.
  `Figures` is the line of figures beside a name: it takes the room the name
  leaves, drops whole figures, the least needed first (`lib/figures.ts`), and
  shows them all on hover once it has dropped some; a screen reader reads
  the whole line, whatever shows. That tip is for the pointer, and a line
  that has dropped everything has no width left to hover, so it says when
  it drops any (`onDropped`) and the name's tip, which the keyboard reaches,
  says the whole line under the name (WholeTip's `figures`, drawn by
  `FigureLine`). Where that tip is a whole row's, as on Earlier's rows and
  Recording with, the line has no tip of its own (`tip={false}`). A figure
  can be drawn as more than its words, such as a ★ take with the star icon
  (`node`): it is measured and shown as drawn, and read out as its `text`.
- **Mark**, `mark.tsx`: a mark's pieces (C8). `LabelDot` is the one label
  dot, 8 px and round, in the label's colour; `MarkLine` is the one note
  line: the dot, the time, the take where the line is away from it, then the
  label and what was written, cut at the end of the room. `MarkTick` is one
  mark on a take's bar: a 3 px tick in the label's colour where the mark
  fell, as tall as its caller makes it. On the bars of an evening's takes,
  on the rehearsal screen and in History, it passes under the take's number
  and name. Last time, the rehearsal screen and the player use them, and so
  does History: a label's dot in its list and on its page (`LabelList`,
  `MarksPage`), the notes from last time on a song's page (`SongPage`), and
  the ticks on the bars of a song's ladder and the Marks page (`SongLadder`,
  `MarksPage`). The other dots, note lines and ticks move onto them as their
  screens are redone.
- **Checkbox**, `checkbox.tsx`: shadcn's, in the theme. A 16 px square with
  the 4 px corner of a small thing (F9). Ticked, it is filled in the text's
  colour, never the accent (F2), with the shared focus ring. It is Radix's
  checkbox, a button, so Space on it ticks it; on a screen where Space does
  the main thing, as Review's does, the box gives up its focus after a
  change, so the next Space is the screen's. Review's cloud line, Folders'
  **Send saved takes automatically** and Under the hood's **Check for new
  versions** use it.
- **TakeColumns**, `take-columns.tsx`: a song's takes as columns, C8's
  columns, each as tall as the take ran (`drawnLength`, so none is under a
  few pixels), the longest filling `height`. `numbers` puts each take's
  number under its column. The take the screen is about is lit: in the
  text's colour, or full green if it is starred. A starred take that is not
  lit is a paler green, and the rest are grey. Last time lights the take its
  ▶ plays and Review the take just recorded, so the two screens draw them
  alike. Last time draws every song to the scale of its longest take
  (`longest`). The columns are a picture, hidden from a screen reader: the
  screen that uses them says them in words; Review also puts the tip on
  them.
- **Collapsible**, `collapsible.tsx`: shadcn's, C8's expanding. A part that
  opens and closes under its trigger: `Collapsible`, `CollapsibleTrigger`
  and `CollapsibleContent`. It has no look of its own. The trigger is what
  the screen puts in it, a `Button` as a rule; Radix sets `aria-expanded`
  on it, and Enter or Space opens and closes the part. A rung of a song's
  ladder in History is its one use so far: the rung is the trigger, its
  chevron says whether it is open, and its takes are the part.
- **Slider**, `slider.tsx`: shadcn's, on the theme. A thin grey track, the
  part set in the text's colour rather than the accent (F2: a setting, not
  what plays), and a round thumb that shows keyboard focus in the shared
  ring, as a fader's does (C6). Its name and its reading in words go on the
  thumb, which is what a screen reader reaches. `onValueCommit` is the value
  let go of, by the pointer or a key, for a setting saved and heard only
  then. The click's volume is its first use.
- **PickRow**, `pick-row.tsx`: a pick-one of a few words beside its name,
  as C8 says.

The metronome's pieces, in `components/metronome/` (spec Parts 4 to 8):

- **NoteGlyph**, `NoteGlyph.tsx`: the eighth note, drawn, after every tempo
  in 6/8 the interface draws; plain text says "♪" (`tempoUnit` in
  `lib/format.ts`). `TempoUnit` beside it is what a tempo counts, "bpm" or
  the eighth, with the tip "Beats a minute" or "Eighths a minute: the six
  clicks of a bar", in the room "bpm" takes either way. `MeterText` is a
  tempo and its signature in a line, "128 bpm · 4/4", with the drawn eighth
  in 6/8: Master's tip and tag.
- **TempoField**, `TempoField.tsx`: the tempo as a number field with − and
  + on either side and its unit after it. Enter or leaving the field counts
  what was typed; not a number puts the last one back, and empty is no
  tempo, shown as "—".
- **SignatureSelect**, `SignatureSelect.tsx`: 4/4, 3/4, 2/4 or 6/8, in the
  shared select, each as wide as the others.
- **TapButton**, `TapButton.tsx`: Tap, and T while the player's keys are on
  (B9). After a press the band's pads count as taps until they pause; pads
  Python cannot open are said in the screen's notice (`onError`).
- **ClickSwitch**, `ClickSwitch.tsx`: the metronome's icon as a `Toggle`,
  grey when on: whether Record clicks, and mid-take whether it still does.
- **BeatDots**, `BeatDots.tsx`: a dot a click, the accented ones larger, 6/8
  in two groups of three, the click heard now lit in the accent with no
  fade (F11). It keeps the room of six.
- **StatusLine**, `StatusLine.tsx`: the line under the row, with its one
  link after the words, a warning's icon in amber and its words in the
  text's colour. It keeps two lines' room.
- **ClickSettings**, `ClickSettings.tsx`: the click's output, volume, sound
  and count-in, behind the row's gear ("Click and backing track", with the
  backing track's output after them), and its pieces for Settings › Click
  & backing track, which read and save through `hooks/useClickSettings.ts`.
  The output's first item is "Where the player plays", shown until the
  click has an output of its own; one saved and not plugged in shows under
  its own name, through `DevicePicker`'s `missing`.
- **MetronomeRow**, `MetronomeRow.tsx`: the row at the rehearsal screen's
  footer, left of Finish and Record, with BackingRow under it once any
  song has a backing track, and the backing track's sentence after the
  line's link. `MetronomeRowView` draws it from its props alone. Its count
  from the last take is `hooks/useTempoCount.ts`, as a song's page counts.
- **TakeRow**, `TakeRow.tsx`: the row while a take records, at the
  footer's far left: the switch, the take's tempo and signature, the dots
  and the line, with BackingTakeRow under it.
- **CountIn**, `CountIn.tsx`: the count-in's digit in the clock's place and
  at its size, the accented ones in the accent.
- **EdgeLight**, `EdgeLight.tsx`: the window's edge lit in the accent on
  each click of a take, 14 px on the first of a bar and 7 px on the others,
  on and off with no fade (F11), hidden from a screen reader.
- **SongTempoRow**, `SongTempoRow.tsx`: a song's tempo on its page in
  History, in the pane head's lines: the tempo field, the signature, Tap
  and the metronome's ▶ (32 px and square, not the head's round 48 px
  `PlayButton`, C2), and its line from `songLine`. A change is saved to the
  song at once. "count it from a take" opens a `DropdownMenu` of the song's
  takes, the starred first, then the newest; halve and double follow a
  count, which is kept while the page is open (`hooks/useTempoCount.ts`).
  ▶ plays the page's tempo and leaves the rehearsal screen's row as it is;
  its dots light from what Python says it plays.
- **MasterClick**, `MasterClick.tsx`: the click with the take, in Master's
  plate after its name: the metronome's icon as the 20 px lane toggle,
  held to the name's line so the plate stays 56 px, grey when on, disabled
  for a take recorded without the click, its tip on the box round it so it
  shows then too. On or off for the whole app (`hooks/usePlayerClick.ts`).
- **MasterClickLane**, `MasterClickLane.tsx`: Master's lane, its click as
  stripes on a well over the same seconds as the tracks' pictures, a bar's
  stronger than a beat's, from `clickLines` (bars only past 120 clicks in
  view, every fourth bar past 480), at half strength while the click is
  off, with the playhead, the region and the tempo in its corner. A drag
  across it sets the region as one across the tracks does.

`MetronomeSettings` (`components/MetronomeSettings.tsx`) is Settings ›
Click & backing track: the gear's pieces from `ClickSettings.tsx` and
BackingSettings in `SettingsGroup`s, tempo drift, and the tab's own
checkbox for the tempo in WAV files. `DevicePicker`'s
`unavailable` lists a device that cannot be picked there, greyed, with its
reason under its name: the click's output says so of a second ASIO card.
One already saved that cannot be picked now keeps its name alone in the
box, on one line (B4), and the reason shows under the box.

The backing track's pieces, in `components/backing/` (backing-track spec
Parts 5 to 8):

- **BarOneField**, `BarOneField.tsx`: where bar 1 is in the file,
  "0:00.80" (`formatBarOne`), between − and + as TempoField has them, a
  hundredth of a second a step. Typed as minutes and seconds or seconds
  alone, taken on Enter or on leaving the field; not a time puts the last
  one back. ↑ and ↓ in the field step it, a tenth with Shift.
- **FileStart**, `FileStart.tsx`: the start of the file drawn with the
  shared `Waveform`, from 0 to four bars past bar 1 and 8 s at least, a
  scale kept while the page is open. The song's bars, numbered, and beats
  are lines in the accent at half strength; bar 1 is a full line with its
  marker, a slider dragged or moved with ← and →. The playhead is a line
  in the text's colour, and the part played is in the accent, as a lane's.
- **SongBacking**, `SongBacking.tsx`: a song's backing track on its page,
  under SongTempoRow: the icon, the file's name and length, BarOneField,
  ▶ (32 px and square, as the tempo row's) and ⋯, a `DropdownMenu` with
  Replace… and Remove; FileStart under them, and the line from `pageLine`
  in two lines' room, its links as the tempo row's. One ▶ of the page plays
  at a time.
- **BackingRow**, `BackingRow.tsx`: the row under the metronome's on the
  rehearsal screen, 32 px like it: the backing track's icon as a `Toggle`,
  grey when on (F2), the file's name cut to its room with its length kept
  whole, the shared `Slider` for the volume, and ▶ (32 px and square). A
  free take and a song with none say so in the file's place, in the status
  line's size on up to two lines. The volume is sent when let go, or once
  the arrow keys stop.
- **BackingTakeRow**, `BackingTakeRow.tsx`: the same row while a take
  records, with how far the file has got and no ▶; the switch is disabled
  for a take recorded without it.
- **BackingSettings**, `BackingSettings.tsx`: the backing track's output and
  volume for Settings › Click & backing track, through
  `hooks/useBackingSettings.ts`; `compact`, the output alone, behind the
  metronome's gear. As the click's, its first item is "Where the player
  plays", and one output gets the line that a stereo file is played in
  mono. Picking an output plays two seconds of it.
- **NewSongDialog**, `NewSongDialog.tsx`: New song, from the button over
  History's song list, or in History's Empty before the first rehearsal:
  the shared `Dialog`, the title's field, and a line under it that keeps
  its height and says why Create waits. A title that is a song's already
  has Open it after the line, a link in its words, to that song's page.

## Writing components

These hold after the rollout too, for every new screen and feature.

- **U1. Use what exists first.** A component that already exists is one
  less to keep in step with the theme and the keyboard; shadcn's come on
  Radix, with focus, keys and screen readers already handled, and its own
  command is the documented way to add one, chosen over a leaner way of our
  own. In this order: a shared component in `components/ui/`; then a
  component from shadcn/ui, added with that command
  ([below](#adding-a-shadcn-component)); then our own, only when shadcn has
  nothing like it, as with `PlayButton` and `LanePlate`.
- **U2. A different look is a variant, not a copy.** A copy drifts: a fix or
  a restyle reaches one and not the other, which is how the app came to have
  four dialog frames and four key chips. A smaller toggle is a new size in
  `Toggle`, as `lane` is; a component is never copied to change it. A shadcn
  component, once added, is our code, and is changed in its own file to
  follow the theme.
- **U3. Shared, or the screen's own.** A piece used on two screens or more
  is shared. A piece of one screen may live with that screen, built only
  from shared components and theme values; when a second screen needs it, it
  moves to the shared ones instead of being copied. Copying is how there
  came to be four small ▶.
- **U4. Radix and other building blocks only inside `components/ui/`.**
  Screens use the shared component, so a fix or a restyle reaches every
  place at once. The check refuses a Radix import anywhere else.
- **U5. A shared component comes with its story and its line.** The story
  is where it is seen in every state, in both themes and on both systems,
  before a screen depends on it; the line is how the next person finds it
  instead of building another (U1). The story sits beside it
  (`button.stories.tsx` beside `button.tsx`), and the line goes in this
  document. The check refuses a component with no story.

### Adding a shadcn component

```bash
cd ui
npx shadcn add toggle
```

`ui/components.json` tells the command where things go, so the file lands
in `src/components/ui/`. Then:

- **Never overwrite `button.tsx` or `input.tsx`.** Some components bring a
  button or an input with them (`dialog`, `input-group`); ours have their
  own variants and sizes, so answer no when the command asks.
- shadcn's components import `cn` from the `cn` package. Change
  `from "cn"` back to `from "@/lib/utils"`, the app's own, and if the
  command added `cn` to `package.json`, take it out again.
- Put it on the theme (U2). `npm run design-check` names every raw colour,
  radius or text size in it, and it is fixed in the file: nothing in
  `components/ui/` can go on the allow-list.
- Write its story and its line here (U5).

Where the command cannot reach ui.shadcn.com, the same source is in
shadcn's repository on GitHub, under `apps/v4/registry/new-york-v4/ui/`; the
foundation's came from commit `c2a67849be260701852b0977ba15eb5f3a0ce2a4`. A
copy needs `@/registry/new-york-v4/ui/` changed to `@/components/ui/` as well
as the `cn` import.

## How screens work

- **B1. Moving to the Trash happens at once, with Undo.** A question before
  every removal gets answered without being read. Deleting a take or a
  rehearsal, clearing false starts, discarding a take (on Review and in
  Drafts) and cropping happen when clicked, and a notice says, for example,
  "“Pałyn 5” went to the Trash." with **Undo**, also on ⌘Z or Ctrl+Z, for
  10 s. Undo brings it back whole: its name, star, marks, notes and cloud
  copy. `offerUndo()` in `lib/trash.ts` raises the notice. Python keeps what
  went in `<recordings>/_deleting/` (`src/rehearsal_recorder/holding.py`)
  and sends it on to the Trash when the notice ends, when the app quits, or
  at the next start after a crash; nothing is destroyed either way. A track
  taken off the start screen has it too ("{name} was taken off."), and puts
  the track back in its place with its readings. So does a song's old name
  forgotten from the song's page in History ("“Palyn” was forgotten."):
  Undo gives the name back to its song (`forgetSongName` in
  `lib/songNames.ts`), or says why it cannot, when the name has become
  another song's since or its song was merged away. "Make Palyn a new song"
  under a name field forgets the name with no notice: the field takes it at
  once, as a new song's. A song taken out of a set by its ✕ in
  Settings › Sets has it too ("“Pałyn” was taken out of the set."), a
  notice for each song, so two taken out keep an Undo each
  (`set-song:{n}`). Undo puts the song back into its set as Python has it
  then, before the song that followed it, or at its old place if that one
  has gone too (`putSongBack` in `hooks/useSets.ts`), whichever screen is up
  by then; if the set has been deleted, it says so. In New set on the start
  screen ✕ raises no notice: nothing is saved there until Create set.
- **B2. A question only where nothing can be undone**: finishing a rehearsal
  by Esc, removing a rehearsal from history, deleting a label that has
  marks, deleting a set, and merging two songs. Each is a `ConfirmDialog`,
  where Enter presses Cancel. The **Finish** button itself does not ask. Its
  text counts properly, "1 take is saved", through `savedLine()` in
  `lib/format.ts`.
- **B3. Load errors show everywhere.** A ▶ that fails without a word looks
  like a button that does nothing; an honest failure beats a silent fallback
  (CONTRIBUTING.md). A take that fails to load says so wherever its ▶ is:
  `PlayButton`'s failed look (C2). The screens get it with the small
  player.
- **B4. Nothing jumps.** A field keeps a line under it for its error, so an
  error appearing moves nothing, and a list keeps its place while it loads:
  a layout that jumps is a bug. On the start screen the Check signal button,
  a track's port line and Start's unseen Space chip hold their room, as the
  song rows do. On the rehearsal screen Finish and Record keep their key
  chips, unseen, while a take is in hand, and Record keeps room for a number
  of two digits; Mark is as wide as Open mark; and the player keeps
  one line between the transport and the map for what it has to say, one
  thing at a time (a load error, then Cropping, then the output's warning),
  so the timeline never moves when it fills. On the recording screen the
  disk line holds the room of the longest thing it can say, and a tile's dB
  figure holds the room of "-100.0", the widest it can read. On Review the
  cloud line holds its room from the start, before the setting has
  answered, and the header is as tall with the song's columns as without
  them: it changes only with the title's lines. Every redone screen's
  header (`Shell`'s `air`) is as tall as the 36 px work button, so the
  button arriving in it moves nothing. In Drafts a take being recovered
  shows its progress in the place of its line, both 16 px, so the row keeps
  its height, and the footer's word and the rows' Recover stay as they were
  when a button was pressed until the run ends. A footer button's error is
  an error notice (C4), so it moves nothing. With its keys off in
  Settings › Keys (B9), a key chip is not drawn and keeps no room. The
  unseen chips above hold theirs because they come back while their screen
  is up; keys turned off come back only from Settings, another screen.
  Settings' own **Back** is the one exception: its Esc chip keeps its room
  unseen (`Shell`'s `backKeyRoom`), because the switch is on that screen
  and the title would jump 36 px each time it is turned.
  These are the model; the rest as each screen is redone.
- **B5. Loading.** Under 1 s nothing shows, so a quick answer does not
  flash; from 1 s a spinner takes the place of what is loading; past 10 s it
  says what it is doing. `PlayButton` already waits its second
  (`SPINNER_AFTER_MS`), and so do the player's Play, the share dialog's
  options and its Remove, and a lane of notes being read, which says so in
  its place if they cannot be read. Drafts' Recover and Recover all wait
  their second too, then turn a Spinner in the button that is working, and
  a take's progress comes from the journal. While History reads its
  rehearsals, it shows the Spinner, unseen for its first second, and from
  10 s "Reading the folder…" beside it (`useAfter`). Settings' Look again
  keeps its words and its width while it looks, and after its second a
  Spinner takes its icon's place. While Under the hood asks Python for its
  page, it shows the Spinner, unseen for its first second, and from 10 s
  says beside it what it is doing. The rest as each screen is redone, on
  shadcn's Spinner.
- **B6. Long names.** A name never gives way to a secondary figure: the name
  is what tells one thing from another. The figure wraps, goes first, or
  hides and shows on hover, as a recording tile's dB figure does; a cut
  name shows whole on hover, and on keyboard focus when it is a button, a
  link or has a `tabindex` (`useCut` and `WholeTip` round it; `Whole` is a
  plain text and shows on hover only, unless it has `reach`, which makes it
  a Tab stop while it is cut, as a track's name on its plate is); where a
  name has room for a second line, it wraps; the figures beside it are
  `Figures`, which drop whole, least needed first. As each screen is
  redone. A recording tile's name runs up the tile and takes up to two
  lines at 2.25 rem. A name still too long gets smaller, down to 1.5 rem,
  and past that it is cut and whole in the tile's tooltip on hover. Short
  names keep 2.25 rem. `TileName` fits it on an unseen copy, and again only
  when its room changes size, so nothing that comes during a take changes
  it. On Review the take's name is the header's title, on up to two lines
  and then cut with its number kept, whole in the tooltip, with the pencil
  after its last word. The song's takes tonight stand beside it as columns,
  as small as Last time's, and give way to it whole; once they have, the
  title's tooltip says them, and the 1 px line after them goes too. The
  subtitle never makes them give way: a long rehearsal name runs on into the
  room the columns leave, is cut where that ends, and is whole in the
  tooltip. In History each page has the pane head (`PaneHead`, C8): the
  title on up to two lines, then cut and whole in the tooltip, with the
  pencil after its last word, as on Review. The actions at its right get
  what the title leaves: a rehearsal's figures give way to its name whole,
  before the name takes a second line, and Delete stays. Under the name the
  date is whole, the set is cut to half the line at most, and the folder's
  path has the rest. The path is the button that opens the folder, cut at
  its end, and its name and tip are in the system's words (P2), "Show in
  Finder", with the whole path in the tip while it is cut. A rehearsal not
  on disk has its path as plain text. A row in History's lists has its name
  on up to two lines, then cut, and the figures beside it give way first,
  as on Earlier's rows. The header's totals are `Figures` too, the size
  dropping first and the count last. A take's row in Drafts has the
  rehearsal's name on up to two lines, then cut, whole in the tip and a Tab
  stop while it is cut (`Whole reach`); a name that fits on two lines is
  whole and is not a stop.
- **B7. Empty states.** An empty list that only says it is empty leaves the
  person to guess what to do next. So an empty list says, in its own place,
  what will appear there and how it gets there: an empty set under Next take
  says "This set has no songs yet. Add them in Settings › Sets." On shadcn's
  Empty, as each screen is redone. History's four use it: no rehearsal
  yet ("Every rehearsal where you saved at least one take shows up here.",
  with New song for a song made before its first take),
  no song yet ("A take named after a song shows up here."), a rehearsal
  with no takes left, and a label with no marks, which says where they come
  from ("Marks given the label Fix in the player gather here, from every
  rehearsal."). Settings › Sets has two. With no set yet, one across both
  columns says what a set is and how one is made ("A set is the songs a
  rehearsal goes through, in order. Make one with New set, then pick it
  beside Start rehearsal."), with New set in it. A set with no songs says
  "No songs yet" and "Add them below, in the order you play them."
- **B8. Wording.** A name in a title is in quotes (*Delete “Fix”?*). A
  sentence said in two places comes from one place. Each kind of figure is
  written one way, through `lib/format.ts`, and a screen shows a figure
  once.
- **B9. Single-key shortcuts can be turned off**, in Settings › Keys, and are
  on by default. Space starts a take and ↑ and ↓ pick the next take's song,
  and WCAG 2.1.4 asks for a way to turn off shortcuts that are one plain key.
  The tab has two groups, each with its switch at its head (the shared
  `switch`, On and Off) and a row per screen under it of what its keys do
  there. "Space and Esc" is Space's main action and Esc's step back on every
  screen. "The player's keys" are the arrows, Home, M, R and ? in the player,
  ↑ and ↓ on the rehearsal screen and in History's lists, and T, which taps a
  tempo on the rehearsal screen and on a song's page (the metronome's Tap,
  through `useKey`). `lib/keys.ts` holds the two, in force as soon as they are
  switched, and Python keeps them (`save_keys`, as `space_keys` and
  `player_keys`). Anything there but `false` is on, so a config edited by hand
  never turns keys off. Off, the key hooks (`hooks/useSpacebar.ts`) leave
  those keys to the browser: Space presses the focused button, and ↑ and ↓ in
  the Next take field are the field's. A click leaves a button focused on
  Windows (Chromium) but not on the Mac (WebKit), so the words for musicians
  say only Tab. Their chips (`Kbd`) are not drawn (B4), and their keys leave
  the buttons' `aria-keyshortcuts`. The player's keys button stays, and its
  list names only the keys that work. ⌘Z or Ctrl+Z, and Esc in a dialog or a
  text field, always work.

## Where the rules live

- **K1. This document**: each rule in a line or two, with its reason and
  what carries it. The spec says how each rule was reached, with its mockups
  and arguments; this says what holds now, short enough to read before
  writing a screen. A pull request that adds a shared component, or changes
  a rule, changes this too.
- **K2. The showcase is Storybook**, run on your own computer. It shows
  every shared component in every state, light and dark, as on the Mac and
  on Windows, side by side, where the app would have to be driven into each
  state by hand to see it. It was decided to keep it on the computer (R22):
  it is not published, neither in pull request previews nor on reha.stream.
  CI builds it, so a story that does not build fails the pull request.
- **K3. CI refuses what breaks the rules**, with `npm run design-check`, the
  Design check step of the interface job in `.github/workflows/checks.yml`. A
  rule that lives only in a document wears away one screen at a time; the
  check names the line on the pull request, before a reviewer has to.
  Spacing is not checked (F8).

### The showcase

```bash
cd ui
npm run storybook                 # then open http://localhost:6006
```

The toolbar has two switches. **Theme** is dark (the default) or light.
**System** is mac (the default) or windows, and tells `lib/platform.ts`
which system to be, so a component's words and keys, and a dialog's button
order, follow it. Stories are `ui/src/**/*.stories.tsx`, each beside its
component.

`npm run build-storybook` is what CI runs, in its Showcase step; it writes
`storybook-static/`, which git ignores. It does not check types:
`npm run build` does, the stories included.

### The check

```bash
cd ui
npm run design-check
```

It reads every `.tsx` and `.ts` under `ui/src/`, stories included and
tests left out (class strings live in `.ts` files too, such as
`lib/labels.ts`), prints each problem as `path:line rule text`, and then
says what each broken rule is for. The rules are in
`ui/scripts/design-rules.mjs`, and their tests, which Vitest runs, in
`ui/scripts/design-rules.test.mjs`.

| Rule | Refuses |
|---|---|
| `px-text` | a text size in px: `text-[13px]`, or `fontSize` in a style |
| `text-size` | a text size off the five: `text-lg`, `text-3xl` and up, `text-[…rem]` |
| `raw-colour` | a colour round the theme: a Tailwind palette colour, or white or black, after a colour utility (`bg-amber-500`, `text-white`, `border-black/20`); a hex, or an `oklch(…)`, `rgb(…)` or `hsl(…)`, written out |
| `radius` | a corner off 4, 8, 12 or full: `rounded-xs`, `rounded-2xl` and up, `rounded-[…]`; `rounded-none` passes |
| `uppercase` | the `uppercase` class |
| `raw-button` | a hand-made `<button>` outside `components/ui/` |
| `radix` | Radix imported outside `components/ui/` |
| `dialog` | `role="dialog"` or `<dialog>` outside `components/ui/`; a selector that finds one, `[role="dialog"]`, passes |
| `story` | a component in `components/ui/` with no story beside it |

**The allow-list.** While the screens were redone, one pull request each,
`ui/design-check.allow.json` let a file not yet redone break the rules it
was listed for, by file and rule, and each screen's pull request took its
files off. Every screen is redone, and the list is empty for good, `{}`: a
new screen or feature keeps the rules from its first line. The test
*the allow-list is empty: every screen is redone*, in
`ui/scripts/design-rules.test.mjs`, fails when anything is put back on the
list, and the check says "0 known cases in 0 files are on the allow-list".
Nothing in `components/ui/` could ever be listed: that is where the rules
are kept, so a problem there is fixed.

**`design-ok`.** Two kinds of thing are outside what the rules mean: a
small graphic that keeps its own corner, such as a mark's diamond on the
waveform or a tooltip's arrow, and text sized from the window rather than
from the scale (the recording clock, the names and readouts on the track
tiles). Such a line is let off one rule by a comment on it, or on the line
above, that says why, as `//` or `{/* */}`, whichever the line allows. Two
from the code, in `components/Timeline.tsx` and `screens/Recording.tsx`:

```tsx
// design-ok(radius): the marker's diamond on the waveform, a graphic that keeps its own corner
// design-ok(px-text): the recording clock is sized from the window's height (CLOCK_SIZE)
```

A comment with no reason lets off nothing, and it is for those two kinds
only: any other line that breaks a rule is fixed, since nothing goes on the
allow-list any more.
