# Design system: one set of rules for how РЭХА's screens look and work

The app reads as a set of components rather than one thing. Each screen was
built when its feature was, and each settled its own look:

- **The same piece is built several times.** Four hand-made small ▶
  buttons in three sizes with four prop types, four copies of the dialog
  frame, four key chips, six kinds of screen header on seven screens,
  and about thirty more kinds of piece like them (C8).
- **The screens are a visual mess.** Fifteen text sizes, 70 font sizes in
  px that ignore the Appearance scale, fifteen spacing steps, nine corner
  radii, 56 hand-made `<button>`s beside 96 shared `Button`s. Blue means
  the main action, Stop, "on", "selected", notes coming in from MIDI, and
  *next* and "played" in a set; there are seven kinds of "selected", and
  figures are mono in one place and sans in the next.
- **Screens work differently too.** Six questions only move files to the
  Trash, and none of them can be undone; Enter cancels in one dialog and
  opens a folder picker in another; on Windows the dialogs still say "the
  Trash".

(Counted on main 45dee41 and 64682da on 2026-10-08, the audit page is
https://claude.ai/artifact/BuCwLhqC1J74htqubqeqHH; counted again on main
f0096a1 on 2026-10-10, after song sets, keeping the laptop awake and MIDI
recording, in the project's files at `design-system/reaudit-2026-10-10/`.)

This sets shared rules: a foundation of colours, type, spacing, radii and
motion that the app and reha.stream both use, a small set of shared
components that replace the copies, rules for how screens behave, and the
checks that keep them. Then every screen is redone on them, one at a time,
and the new look ships in one release.

Alex settled it on 2026-10-08 in the thread "Дизайн-система и правила
экранов", from Alex's words: «нужно чтобы ты поискал правила и
рекомендации как строятся интерфейсы и дизайн системы … и мы с тобой
приняли общие правила и конвенции как у нас должны выглядеть и работать
экраны». The research (284 sources) is at
https://claude.ai/artifact/SvcLUrEkN89NmuwFm4ZMRQ. Each visual question was
answered on a mockup of the real app built from main, and each answer was
layered into the next mockup:

| Question | Mockup |
|---|---|
| Own look or each system's | https://claude.ai/artifact/1DAB2aB61ha9yxw3jeA8hZ |
| The accent | https://claude.ai/artifact/P6KHZxaWq5nML7LhAHQAVj |
| Text sizes | https://claude.ai/artifact/8S1a9BGt42QPL75LMjAs99 |
| The blue mark colour | https://claude.ai/artifact/Ewa5kYjFLPFJfB5TX2vvmX |
| Air, track lanes, M and S | https://claude.ai/artifact/UFHzBhAR9zrPf8YE1zmAHP |
| What sets a group apart | https://claude.ai/artifact/9MyHWVq7vxZZ1r5vNVvkEg |
| Corner radii | https://claude.ai/artifact/4F4aUodKJSXLutUZonHeXU |
| Letter case | https://claude.ai/artifact/TdTXuHQfFasDY1ixQeC9kP |
| One small player | https://claude.ai/artifact/8Wh4rzYDcn5yoPWucJW9am |
| Ask before the Trash or undo after | https://claude.ai/artifact/6MBUux1YHf2jKLrYk5bcgR |
| Motion | https://claude.ai/artifact/W63fEPXy3yMC5vNQ32Lsgh |
| Colour of notes coming in from MIDI | https://claude.ai/artifact/6z7XpRAL3fFXjNrx7LfqfC |

The rulings, numbered R1 to R23 with their times, are in the project's
files at `design-system/rulings.md`, with each mockup's sources beside it.

## Decisions

- **D1. Refresh the look** (R1), not only tidy it and not start from
  scratch. Colours, type, density and the shape of details change together
  with the rules, and reha.stream changes with them.
- **D2. The rules are principles, not edits to today's lines** (R2; Alex:
  «код может уехать вперед пока мы тут обсуждаем»). Line numbers below
  describe main f0096a1, where the audit was taken again on 2026-10-10;
  the plan checks them once more on the main of its day.
- **D3. Our own look, with the system's habits** (R3). One set of components
  on Mac and Windows. What follows the system: its font (San Francisco,
  Segoe UI), the order of buttons in a dialog, and its words (⌘ or Ctrl,
  Finder or Explorer, Trash or Recycle Bin).
- **D4. One foundation for the app and reha.stream** (R4): colours, font and
  the size scale. The site keeps its own big headings and layout; the app
  keeps its own components.
- **D5. Both how screens look and how they work** (R5): dialogs and
  confirmations, empty states, errors, keys, loading and wording.
- **D6. What to take from the apps Alex likes** (R6, R7: apple.com,
  thefirstthelast.agency, animaapp.com, lusion.co): big type and a lot of
  air with little on screen at once; a nearly black-and-white palette with
  one bright colour for what matters; smooth motion; a story told by
  scrolling, mostly on the site. No 3D.
- **D7. The rules live in three places** (R8, R22): a document in the repo,
  a showcase of every component that runs only on the computer, and CI
  checks.
- **D8. Screen by screen, one release** (R9, R23). The foundation first,
  then one PR per screen merged into main as it is ready. The release with
  the new look goes out when every screen is done.

## The foundation

One theme file holds every value below. It is `ui/src/index.css` today,
which the site already imports (`site/src/page/page.css:3`,
`site/src/stage/stage.css:3`); the site's page colours, which copy today's
blue by hand (`page.css:15-24`), take their values from it.

### Colour

- **F1. One accent, cobalt** (R10): `oklch(0.56 0.24 266)` with a white
  label, the same in both themes. The label reads at 4.8:1, and the accent
  against the background at 3.8:1 dark and 4.8:1 light.
- **F2. The accent is for the one main action and for what plays** (R10's
  role split). A selected tab, pill or row, a switch that is on, and Stop
  are neutral, not blue. The record red, the danger red and the statuses
  keep their own colours. In a set's list the song the Next take field
  names is a selected row, and *next* and a played ✓ are in the text's
  colours (cobalt in all three today, `NextTakeSongs.tsx:53,61,67`,
  `SetPlayed.tsx:87`). Notes coming in from MIDI are neutral, in the
  text's colour, a grey fill on a tile (Alex, 2026-10-10 22:23Z, "Серый"
  on the mockup): the check's bar and "✓ notes", the tile's notes fill
  and its MIDI sign (cobalt today, `NotesCheck.tsx:25,31`,
  `PortPicker.tsx:113`, `MidiTile.tsx:24,135`, `TrackTile.tsx:128,167`).
  Played notes in the player's notes lane stay in the accent, as what
  plays (`NotesLane.tsx:149`).
- **F3. Marks keep eight colours, and blue becomes orange** (R12):
  `oklch(0.68 0.17 48)` light, `oklch(0.7 0.17 45)` dark. Cobalt is then the
  only blue in the app, and the played part of the waveform (the accent,
  `Waveform.tsx:118`) no longer swallows a blue mark. Labels that are blue
  today show orange; orange takes blue's place, sixth, in Settings' picker.
- **F4. A group is set apart by its fill, with no border** (R16). Today's
  bordered panels (Last time, the track rows, History's lists and song
  groups, the rehearsal lanes, Next take) lose their outline and keep or
  gain the card fill. Fields, buttons and dialogs keep their frames. The
  fill must tell a group from the page in both themes. Since song sets
  and MIDI the same goes for the set card and song rows under Next take,
  History's set card (a border with no fill, `SetPlayed.tsx:47`), Settings
  › Sets' detail, the MIDI tile, and the notes plate and lane.

### Type

- **F5. Five text sizes, in rem: 12, 14, 16, 20, 24, with body text at 14,
  on Mac and Windows** (R11). There are no font sizes in px, so all text
  follows the Appearance scale. Today's sizes map as 9, 10 and 11 to 12;
  13 and 15 to 14; 18 to 16; 22 to 20; 26 and 28 to 24. The 9 px is new
  with MIDI, the row names in the notes lane (`NotesLane.tsx:172,186`);
  at 12 the lane grows to fit them. The recording clock
  and the track tiles keep sizing from the window. The site's big headings
  are its own (D4).
- **F6. The system font** (D3), as `--font-sans` sets it today
  (`index.css:12`).
- **F7. No capitals set by CSS, and buttons in sentence case** (R18). The 17
  labels that `uppercase` turns into capitals ("LAST TIME", "NEXT TAKE")
  show as written ("Last time", "Next take"). Buttons and tabs stay a plain
  phrase, "Start rehearsal", with no Title Case on the Mac either. A heading
  that relied on capitals gets its weight and size when its screen is
  redone.

### Space and shape

- **F8. More air on every screen** (R13), the rehearsal and recording
  screens included; how much is set per screen, with its mockup. On the
  rehearsal screen the room comes from lower track lanes (C6).
- **F9. Three corner radii by role, plus full** (R17). 4 px for small
  things (key chips, tags, take bars, M and S); 8 px for controls (buttons
  of every size, fields, selects, menus); 12 px for groups and dialogs; full
  for round things (play buttons, pills). Graphics such as 1-2 px bars and
  marker lines keep their own. This replaces nine values.

### Motion

- **F10. Smooth** (R21). Whatever appears rises 12 px and fades in over
  250 ms, easing out (`cubic-bezier(.2,.8,.2,1)`). A screen brings its
  groups in one after another, 40 ms apart. Dialogs, menus and notices take
  about 220 ms, and a hover's colour 200 ms.
- **F11. Motion gives way** (R21): the system's Reduce motion turns
  entrances off; nothing moves on the recording screen while recording;
  nothing takes longer than 400 ms. Meters and the clock are readings,
  not motion, and keep moving. Today only `SongLadder.tsx:91` looks at
  Reduce motion (`BeforeTonightCard`, the other one, is gone), and
  History's set card scrolls to a song smoothly without asking
  (`RehearsalOverview.tsx:185`).

## The system's habits

- **P1. One place knows which system it is.** `lib/platform.ts` already
  has `IS_MAC` and `IS_WINDOWS` (`platform.ts:6-13`); Under the hood checks
  again on its own (`UnderTheHood.tsx:272`). Everything asks
  `lib/platform.ts`, and it can be told which system to be, so the
  showcase can show both.
- **P2. The system's words.** ⌘ or Ctrl, Finder or Explorer, and Trash or
  Recycle Bin. Today every dialog says "the Trash" on Windows too
  (`lib/deletion.ts:27-44`), while Under the hood says "Recycle Bin"
  (`UnderTheHood.tsx:424-426`).
- **P3. The system's order of dialog buttons.** On the Mac the action is
  rightmost; on Windows the action comes first. Today the Mac order is used
  on both (`ConfirmDialog.tsx:53-66`).

## Shared components

Every piece below has one component, used everywhere it appears. Each one
is shown in the showcase in every state, in both themes, as on the Mac and
on Windows.

- **C1. Button.** Every button is the shared `Button`; the 56 hand-made
  ones go. Its sizes are named for their place. A red (destructive) button
  is full colour in the dark theme too: today it is at 60% there
  (`button.tsx:12-13`) and reads as switched off.
- **C2. The small player** (R19). One round ▶, 32 px, with a thin border,
  a 14 px icon and a fill on hover, cobalt while its take is loaded or
  playing, like the big ▶. The song page uses it at 48 px. It replaces the
  four hand-made buttons (the start screen's 28, the rows' 32, Marks' 32,
  the song page's 52) and their four playback prop types with one. The big
  player is not part of it. All of them play through the one Python
  player already (`api.py:3351-3369`); the map of the four is in the
  project's files at `design-system/q-player/small-players-map.md`.
  - Played from a mark, it starts 5 s before the mark everywhere (the one
    that used 3 s, BeforeTonightCard, went with song sets).
  - A take that fails to load says so wherever it is; History's three
    views fall back to ▶ silently today.
  - It has a focus ring; none of the four has one today.
  - A take not on disk shows a ▶ that cannot be pressed, the same way in
    every list (today one list shows none and another a dashed one).
- **C3. Dialog.** One component instead of four copies of the frame: radius
  12, a frame, a 16 px title. Its buttons follow P3. The cancel button says
  "Cancel" everywhere, and the action is a verb ("Finish", "Remove",
  "Delete"). Enter presses the action, except in a dialog whose action
  cannot be undone, where Enter presses Cancel. A red button only for what
  cannot be brought back. The title and text stay as they were while the
  dialog animates closed (today they empty first). The map of every dialog
  is in `design-system/q-dialog/dialogs-map.md`.
- **C4. Notice, with an action** (R20). A notice can carry one button, such
  as Undo. Notices show above a dialog's dark overlay (today they sit under
  it, `Notices.tsx` z-40 against the dialog's z-50). A notice with an
  action stays 10 s, and hovering it pauses the time.
- **C5. Kbd.** One key chip for the four kinds today, with the system's
  words (P2).
- **C6. Track lane** (R14, R15). Rehearsal lanes are 56 px (92-96 today,
  `Timeline.tsx:23-24`), and the Mono or Stereo line under a track's name
  goes. M and S are 20 px, with 12 px text and a 4 px radius; the gap
  between them stays at least 4 px, which keeps their 24 px touch areas
  apart (WCAG 2.5.8). A notes lane is as tall as its plate needs, its
  plate is a variant of the audio plate (a copy today,
  `NotesPlate.tsx:41`), and a track that records both is one group, its
  two halves split by a `Separator` (a dashed border drawn three ways
  today).
- **C7. Group.** A panel set apart by its fill (F4), radius 12, with the
  screen's spacing inside. It replaces about 21 hand-made bordered boxes
  with eleven different paddings; the shared `Card` is never used today.
- **C8. Everything else that is built more than once.** The small player
  was one example of many (Alex, 15:28Z: «я подозреваю что у нас куча
  похожих»). A sweep of `ui/src` on main 64682da found about thirty more
  kinds of piece, each built two to sixteen times; the full lists with every place are
  in the project's files, `design-system/q-dupes/controls.md` and
  `display.md`. Song sets and MIDI added to most rows; the counts below
  are on f0096a1, and what was added is in
  `design-system/reaudit-2026-10-10/new-ui.md`. Each becomes one shared piece, taken from shadcn/ui where
  it has one (U1):

  | Built more than once today | Becomes |
  |---|---|
  | 13 on/off and pick-one buttons made by swapping two Button looks; 3 identical segmented switches (History's, Marks' and a track card's Audio · Both · MIDI); 3 pick-one grids in popovers | shadcn Toggle and ToggleGroup, arrow keys inside a group. A pick-one group keeps today's History switch look: a grey track, the chosen item a white plate with a light shadow (Alex, 19:50Z: «мне нравятся переключатели в "сейчас"»); Settings' button rows and the marker's kind picker take it too. A toggle that is on gets the grey fill of a selected row (F2) |
  | About 18 small icon actions (rename, delete, share) in two sizes, the pencil beside a title among them in 4 places, one a raw button with no focus ring; the take's toolbar built twice, in two orders | one icon-button size; one take toolbar, the same buttons in the same order everywhere |
  | About 15 whole rows made into buttons, and 2 rows that only a mouse can open; four side lists nearly identical (History's three and Settings › Sets); seven looks for "selected" | one list row (shadcn Item), every row reachable by keyboard; "selected" has two looks instead of seven: the white plate inside a switch, a grey fill for a row, pill, tab or toggle that is on. The row that ↑ and ↓ point to under Next take, while the field keeps the keys, shows the shared focus ring |
  | 10 text links with 5 hovers (one of them cobalt) and 3 focus rings | one link look: the text's colour with a thin underline, one hover and the shared focus ring |
  | 7 close and remove ✕ buttons in 5 sizes | one ✕ |
  | The small headings set in capitals (F7), in 2 sizes, 3 letter spacings and 2 weights; 10 section headings in Settings made of a label and a grey hint; the set card's title at 15 px, and two more sub-headings of their own | one heading for a group and one for a section (F7: no capitals) |
  | Label colour dots in 5 sizes in 11 places; mark ticks in 4 shapes; 10 chips and pills made by hand, while `Badge` is never used | one dot, one tick, Badge |
  | About 22 warnings and errors: 7 boxes and 4 edges in raw amber beside the theme's warning colour, plain red lines, errors beside a label, three different error icons | shadcn Alert for a box, one line style for a field (B4), one icon per meaning |
  | 15 loading signs: spinners in 5 sizes, a spinning refresh icon, plain text | shadcn Spinner, one size per place (B5) |
  | A take drawn to scale 7 times (Review's bars of tonight's goes are the 7th), each with its own scale, playhead and "starred" green; "how far along" computed 6 times (the notes lane copies the waveform's) | the forms stay where they show different things (the whole evening in one strip, a song's goes as columns, one take with its marks, the map in the player); they share one way to draw length, the starred green, a mark's tick and the playhead, and one helper for "how far along". One take with its marks is one component in two sizes, a row and a mini. Whether the start screen keeps columns is settled on its mockup (Alex, 19:14Z: «в смысле все одинаковое будет?»), and Review's bars take the same answer |
  | A take's name written 8 ways ("01", "Take N", the go in a mono box, the raw name, the go under a bar, "→ Pałyn 12"); "Not named" typed in 6 places | `TakeTitle` everywhere |
  | A rehearsal's date in 6 forms; counts and plurals written inline about 25 times beside helpers that exist, with two more copies each of `goesLabel` and a new `songsLabel`; "1 inputs"; the evening's figures in 6 places; the device line 4 times | `lib/format.ts` only (B8) |
  | The set under Next take and the set in History built twice, as twins (`NextTakeSongs.tsx:83-141`, `SetPlayed.tsx:31-100`) | one set list, on both screens |
  | The MIDI tile on the recording screen a copy of the track tile, and the notes plate a copy of the audio plate | variants of the track tile and of the lane plate (U2, C6) |
  | "Not on disk" in 6 places, 4 wordings, 2 colours; "not connected" for a MIDI port in 5 places | one wording, one look for each status |
  | Progress bars made by hand twice beside `Progress`; level meters 5 ways (the notes bar on the start screen and the notes fill on a tile are new), the clip level defined twice | `Progress`; one meter |
  | 5 hand-made empty states beside `EmptyState` | shadcn Empty (B7) |
  | About 95 native tooltips; a cut name shown whole in one place only when cut, in another always | shadcn Tooltip, one rule (B6) |
  | 4 expand and collapse toggles with 3 chevron behaviours | shadcn Collapsible |
  | 3 native checkboxes, 2 styles | shadcn Checkbox or Switch |
  | Text fields: a track's name on the start screen is a raw text area that wraps, with no focus ring at all (`NameField.tsx:47`), the folder field and its Browse button twice, inline editing set up twice | Input and shadcn InputGroup; a name that wraps is a variant of Input (U2) with the shared focus ring |
  | 9 dividers made 4 ways, and a dashed line joining a track's audio and notes, while `Separator` is never used | `Separator` |
  | The side panel 3 ways; the head of History's right pane 3 ways; 6 screen headers | one side panel, one pane head, one screen header |
  | The mark note line 3 times; the disk-space line twice, low space yellow in one and red in the other | one each |
  | One meaning, two icons: copy to the cloud (two cloud icons), the star (an icon and a ★ character), "it arrives" (an icon for signal, a ✓ character for notes) | one icon per meaning |
  | 6 drag grips: the label and set lists' move by the keys too (dnd-kit), the player's four only by mouse | one grip, moved by arrow keys too |
  | Three surfaces built by hand beside the shared Popover: `ActivityButton`'s, the set picker's menu, and the old-name line under Next take | the shared Popover, and shadcn DropdownMenu for a menu (U4) |

## Writing components

These rules hold after the rollout too, for every new screen and feature.

- **U1. Use what exists first.** In this order:
  1. a shared component the app already has, in `ui/src/components/ui/`;
  2. a component from shadcn/ui, added with its own command
     (`npx shadcn add kbd`) into the same folder;
  3. our own component, only when shadcn has nothing like it (the small
     player C2, the track lane C6).

  Today the nine components in `components/ui/` were copied in by hand and
  there is no `ui/components.json`, so the shadcn command does not work
  yet; the foundation PR sets it up. shadcn already has a Dialog, Kbd,
  Field (with a line for a field's error), Spinner and Empty (an empty
  state), so C3, C5, B4, B5 and B7 are built on those.
- **U2. A different look is a variant, not a copy.** A smaller button is a
  new size in `Button`, as M and S are (C6); a component is never copied
  to change it. A shadcn component, once added, is our code: it is changed
  in its own file to follow the theme.
- **U3. Shared or the screen's own.** A piece used on two screens or more is
  a shared component. A piece of one screen may live with that screen, but
  is built only from shared components and theme values. When a second
  screen needs it, it moves to the shared ones instead of being copied.
  This is how today's four small ▶ came to be.
- **U4. Radix and other building blocks only inside `components/ui/`.**
  Screens use the shared components, never Radix directly. Today seven files
  do: the four dialogs, `ActivityButton.tsx`, `RenameSongDialog.tsx`, and
  `SetPicker.tsx`, which builds its own menu on Radix's DropdownMenu.
  shadcn has a DropdownMenu; it goes into `components/ui/` (U1).
- **U5. A shared component comes with its story and its line.** Every state
  in the showcase, in both themes and as on both systems, and a line in the
  document (K1) saying what it is for.

## How screens work

- **B1. Moving to the Trash happens at once, with Undo** (R20). Deleting a
  take, deleting a rehearsal, clearing false starts, discarding a take (on
  Review and in Drafts) and cropping no longer ask. A notice says "{name}
  went to the Trash." with Undo, also on ⌘Z or Ctrl+Z, for 10 s. Undo
  brings it back whole, with its name, star, marks and .mid files: the
  record is kept until the notice ends. Today putting a file back from the
  Trash does not bring the take back into the app
  (`store/library.py:994-1003`). Anything else that is removed at once gets
  the same notice with Undo: a song taken out of a set (`SetEditor.tsx:80`),
  a song's old name forgotten (`OldNames.tsx:29`) and a track taken off the
  start screen (`Setup.tsx:941`). Today none of them can be brought back.
- **B2. A question only where nothing can be undone** (R20): finishing a
  rehearsal by Esc, removing a rehearsal from history, deleting a label
  that has marks, deleting a set (`SetsSettings.tsx:143`), and merging two
  songs, which only renaming the takes one by one splits again
  (`HistoryScreen.tsx:1302`). The Finish button itself still does not ask (step 7 of
  #12). Its text says "1 take is saved" (today "1 take are saved",
  `Rehearsal.tsx:566-568`).
- **B3. Load errors show everywhere** (C2).
- **B4. Nothing jumps.** A field keeps a line under it for its error, so an
  error appearing moves nothing; a list keeps its place while it loads.
  The two name fields for a set put the error beside their label instead,
  cut to one line (`SetsSettings.tsx:203-213`, `SetPicker.tsx:183-191`).
  The new pieces that already hold their room (the Check signal button,
  the notes warnings on the start screen, the song rows) are the model.
- **B5. Loading.** Under 1 s nothing shows; from 1 s a spinner takes the
  place of what is loading; past 10 s it says what it is doing. The notes
  lane shows nothing at all while it reads a .mid (`NotesLane.tsx:43`).
- **B6. Long names.** A name never gives way to a secondary figure: the
  figures wrap or go first, and a cut name shows whole on hover. Today the
  device name in "Recording with" is cut at 100% in an 1100 px window
  and shrinks to nothing at 125%, while
  "18 inputs · 48 kHz · 24 bit" beside it keeps its room (`Setup.tsx:703`),
  and the start screen's left part cuts a song name to "D…". Song sets
  added six more places where a set's or a song's name is cut while a count
  keeps its room (the set card and song rows under Next take, History's set
  card, the set picker's menu, the set editor, and the head of History's
  pane, where the set's name shrinks and the date does not). A figure
  that does not fit hides and shows on hover, as the MIDI tile's count
  already does (`MidiTile.tsx:77-102`); today an audio tile's dB is cut to
  "-6" at 16 tracks in a window under 1280 px (`TrackTile.tsx:146-154`).
  Where a name has room for a second line it wraps, as the MIDI pieces
  already do (the notes plate, the port picker, the track name field).
  The recording tiles' upright names, which are cut, and the lane plates'
  names beside M and S are settled on those screens' mockups.
- **B7. Empty states.** An empty list says, in its own place, what will
  appear there and how it gets there ("This set has no songs." under Next
  take does not say how, `NextTakeSongs.tsx:121`).
- **B8. Wording.** Names in a title are always in quotes (three titles
  have none: `MarksSettings.tsx:283`, "Delete {set}?" at
  `SetsSettings.tsx:146`, "Merge {song} into {song}?" at
  `lib/songs.ts:165`). A sentence said in two places comes from one place
  (the two port sentences are written in `Setup.tsx:79-81` and again in
  `Recording.tsx:334-335`). Each kind of figure is written one way,
  through `lib/format.ts`, and a screen shows a figure once; today the
  evening's figures are written six ways, twice on the rehearsal screen.
- **B9. Single-key shortcuts can be turned off** in Settings, on by
  default. Space starts a take on the rehearsal screen
  (`Rehearsal.tsx:240`), and WCAG 2.1.4 asks for a way to turn off
  shortcuts that are one plain key. ↑ and ↓, which pick the next take's
  song (`Rehearsal.tsx:218-219`), are such keys too.

## The rules: document, showcase, checks

- **K1. The document,** `docs/design-system.md`: each rule in a line or two,
  with its reason and the component that carries it.
- **K2. The showcase is Storybook,** run on the computer with
  `npm run storybook` in `ui/` (R22). It shows every shared component in
  every state, light and dark, as on the Mac and on Windows. It is not
  published: not in PR previews and not on reha.stream. CI builds it, and a
  story that does not build fails the PR.
- **K3. CI refuses**, in the interface job of `tests.yml`:
  - a text size off the five, or a font size in px;
  - a colour that bypasses the theme;
  - a radius off 4, 8, 12 or full;
  - `uppercase`;
  - a hand-made `<button>` where a shared one fits;
  - a dialog that bypasses the shared Dialog;
  - Radix imported outside `components/ui/` (U4);
  - a shared component without a story (U5).

  Screens not yet redone are on an allow-list that each screen's PR
  shortens; the list is empty before the release. The spacing scale is not
  checked, since alignment needs its small odd offsets; the document and
  the showcase carry it.

## How it rolls out

1. **Take the audit again** on the main of the day, once the thread
   "Задачи из обсуждения #12" is finished, and check every rule here
   against it (D2). Anything that changed comes back to Alex before code.
   Done on main f0096a1 on 2026-10-10, once #12 and MIDI recording were
   both merged (Alex, 2026-10-08 22:58Z: «ок. ждем 12 и миди»); this
   document carries what it found.
2. **The foundation, in one PR:** the theme values (F1-F11), the shared
   components (C1-C7), `lib/platform.ts` (P1), the Undo behind B1, the
   showcase and the CI checks with every screen on the allow-list. The
   theme values change the look of every screen at once; the screens are
   regrouped after it.
3. **Alex checks the foundation on a Mac and on Windows** before the
   first screen's PR: the font, the even-width figures and the motion in
   each system's web view, and the recording clock read from 3-5 m.
4. **One PR per screen,** each starting with a mockup of that screen for
   its amount of air and how it is grouped, in this order: the start
   screen with its left part (Last time, Not played last time), the
   rehearsal screen, recording, Review, History (Rehearsals, Songs, Marks
   and the song page), Drafts, and Settings with Sets and Under the hood.
   Each takes its files off the allow-list. The start screen's PR also
   fixes Check signal: renaming a track during a check blanks its audio
   meter and "✓ signal" until the next check, because the readings are
   kept by the track's name (`Setup.tsx:122,124`, read at `:1033,1045`);
   they are kept by its place in the lineup, as the MIDI readings already
   are (Alex, 2026-10-10 21:55Z: «Это надо пофиксить с дизайн
   системой»).
5. **reha.stream** moves onto the shared foundation in the same release. Its
   pieces of the app are the real components, so they change with the app;
   the page's own colours and sizes take the shared values (D4), and "What's
   new" says what changed.
6. **The release** goes out when every screen is done and the allow-list
   is empty. Work merged in the meantime ships with it.

If a fix has to ship before then, it is released from a branch off the last
release's tag and merged into main as well (R23). This already works:
`release.yml:48-50` checks out the release's tag and `site.yml:84-86`
builds the site from it.

## Claude's own calls

Told here for Alex to object to; none of them was asked.

- **Spacing steps 2, 4, 8, 12, 16, 24, 32, 48, 64 px** instead of fifteen;
  the site adds bigger ones for its own sections. From the research.
- **Two weights, 400 and 600.** `Button` uses 500 today (`button.tsx:7`);
  two weights are enough to tell a heading from text at five sizes.
- **Figures in the system font with even widths** (`tabular-nums`), so
  times and counts line up in columns; mono stays for file paths and
  technical values.
- **One screen header** for the six kinds today, applied with each screen.
- **One look for a mark in a list or a pill;** ticks on bars and waveforms
  are graphics and stay as they are.
- **Master's sticky edge follows the screen's padding.** It is tied to
  Shell's `py-6` by hand today (`Timeline.tsx:582` `-bottom-6`,
  `Shell.tsx:119,125`), so more air (F8) would break it.
- **A red button at full colour in the dark theme** (C1), **one key chip**
  (C5), **one group panel** (C7), and **one ▶ for a take not on disk** (C2).
- **What each repeated piece in C8 becomes.**
- **The rules for writing components (U1-U5).** Alex asked at 15:27Z
  whether there would be one; the order in U1 follows his preference for
  the vendor's documented way over a leaner one of our own.
- **B4 to B9** above, from the research and from Alex's rules for this
  project (layout jumps are bugs; long names and narrow windows are
  checked; a Settings option over a fixed behaviour).
- **The order of the screens** (step 4 of the rollout): the start screen
  first, since its left part waits for this work and it is the first
  screen anyone sees.
- **Where song sets and MIDI recording fit the rules** (the re-audit of
  2026-10-10): the set's current song as a selected row with *next* and ✓
  in the text's colours (F2); the notes lane and a Both track as one group
  (C6); one set list for both screens, the MIDI tile and the notes plate
  as variants (C8); the set picker on shadcn DropdownMenu (U4); Undo for
  every removal done at once (B1); deleting a set and merging songs still
  ask (B2); meters and the clock are readings, not motion (F11); a figure
  that does not fit hides rather than being cut (B6).

## Left to the plan

- Whether notices (C4) move onto shadcn's toast, Sonner, which has an
  action button, or stay our own with an action added (U1).
- Whether the stored label key "blue" is renamed to "orange" (a migration)
  or kept with the new colour (F3).
- How a take's record is kept until its Undo runs out (B1), and what
  happens if the app closes in those 10 s.
- The exact fills of a group in each theme (F4), checked on screen.
- How Alex gets the foundation's build for that check (step 3).
- How the shared Dialog holds the New set dialog, which hangs from near
  the top and grows down as songs are added (`SetPicker.tsx:173-176`).

## Not part of this

- 3D or volume like Lusion (D6).
- Title Case on buttons (F7).
- The big player's controls; it is restyled with the rehearsal screen, not
  merged into the small one.
- The showcase in PR previews or on reha.stream (K2).
- A switch between the old and new look (R23).
