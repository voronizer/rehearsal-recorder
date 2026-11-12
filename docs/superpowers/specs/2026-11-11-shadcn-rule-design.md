# The interface on shadcn, and a check that keeps it there

The interface's rule says: take a piece from `ui/src/components/ui/` first,
then from shadcn's registry, and make one of our own only when neither has
it (`docs/design-system.md` U1–U5). The audit of 11 November found it kept
in РЭХА and broken in the band service, for one reason: `npm run
design-check`, the step that refuses a hand-made button on a pull request,
walks only `ui/src`. CLAUDE.md never names shadcn, and `/check-plan` asks
nothing about components.

This change fixes every piece the audit found in РЭХА, the service and the
site, makes the check cover all three and catch more, and puts the rule in
CLAUDE.md and in `/check-plan`.

The audit, with every row this spec refers to by number (R1–R15 for РЭХА,
S1–S18 for the service, W1–W3 for the site, C1–C4 for the copies of our own
pieces): https://claude.ai/artifact/4pxLtR5eZhGjVfVg5w86vL. It was made on
main a57de94.

## Alex's picks

All on 11 November 2026 (UTC), in the thread «Проверить интерфейс на
shadcn».

- 21:23:45 «мне кажется ты забываешь при построении интерфейса, что должен
  использоваться shadcn. первое - проверить все … второе - нужно как-то
  усилить правило про shadcn».
- 21:39:04 «CI + план + CLAUDE.md» (options Б, В and А of the audit): the
  check grows and runs on the service; `/check-plan` gets a step on
  components; CLAUDE.md gets the rule. Option Г, a hook that runs the check
  on every file Claude writes, was not picked.
- 21:41:04 «Починить всё сразу»: every line the wider check finds is fixed in
  the same pull request, so the check comes in with nothing to excuse. (Claude
  had recommended a list of exceptions that only shrinks; not picked.)
- 21:42:15 «И сайт тоже»: the check covers `site/src` as well as `ui/src` and
  `service/src`.
- 21:44:11 «так мне в файле что-то отмечать или делаем все?», then 21:49:03
  «делаем все что нашлось»: every row of the audit, R1–R15, S1–S18, W1–W3 and
  C1–C4, not only what the check catches. The three things the audit lists
  under «Решено раньше» (notices of our own rather than Sonner, Settings'
  sections on Item rather than Tabs, the song list under **Next take** of our
  own rather than Combobox) are earlier decisions, not findings, and stay.
- 21:50:52, on the question whether the right panel becomes a Sheet: «по моему
  у него должен быть режим с иконками». A Sheet has no such mode; shadcn's
  Sidebar has (`collapsible="icon"`), and it can stand on the right. So the
  right panel is built on Sidebar.
- 21:52:04 «Сдвигает страницу»: the right panel, open, narrows the page by
  its width, as shadcn's Sidebar does, instead of lying over it as it has
  since 8 November. (Claude had recommended keeping it over the page; not
  picked.)
- 22:14:13 «и хочу увидеть что мы поменяем и как это будет выглядеть и
  работать»: the mockup https://claude.ai/artifact/8EmLqkwzaFGYasCHKRXLjK
  (sources in /mnt/project-files/band-service/shadcn/mock/), every visible
  change before and after. It showed that at 960 px wide, with both columns
  open, a take's page kept 286 px.
- 22:23:17 «Б. Левая в значки»: in a window narrower than 1100 px (the
  service's `narrow`, `shell/size.ts`), while the right panel is open, the
  left column folds to its icons, 48 px wide; the page kept 462 px at 960
  in the mockup. (Claude's recommendation; the others were narrowing at
  every width, or the panel over the page below 1100 px.)
- 22:24:16 «А. Только картинки»: on reha.stream only the band service
  story's pictures are retaken where the frame shows; no words change.
- 22:27:57 «ок» on the spec and the plan.
- 23:17:30 «А. Как в окне 960 px», asked once the code showed it: with a
  panel open in a window 1100 px or wider the page has 508 px at 1180 but
  kept its wide layout (Marks lost the mark's words, Home's columns were
  crushed). Now the page takes the layout it has in a 960 px window while a
  panel is open; the frame, the columns and the panel keep the window's
  size. (Claude's recommendation; the others were the left column in icons
  whenever a panel is open, the panel over the page except on a take's
  page, or new wide layouts for each page.)
- 23:19:52 «А. Поверх, как сейчас»: in windows from 500 to 819 px (an iPad
  held upright is 768 to 834) the panel lies over the page as it does now,
  and the left column stays open; from 820 px it narrows the page, which
  keeps at least 324 px. (Claude's recommendation; the others were the
  panel over the whole page as on a phone, or narrowing at every width,
  which left the page 272 px at 768 and 104 px at 600.)
- 23:23:41 «Как доделаешь - нарезаем релиз в этом же пр»: this pull request
  also closes "Unreleased" in CHANGELOG as 0.27.0, with PR #166's stereo
  and PR #161's MIDI fold.
- 2026-11-12 08:06:53 «Б. Только при ошибке»: under a row of **Labels**
  or **Statuses** the error line shows only when there is an error, so the
  rows keep their height; the rows below move down on an error. (Not picked:
  А, a line kept free under every row, 24 px more per row.)

## What the band sees

Most rows swap a hand-made piece for the shared one and keep the look. These
are the ones the band will notice.

### РЭХА and the service, both

- **A question before what cannot be undone** (R1, `ConfirmDialog`, used in
  both) no longer closes on a click outside it. Esc still closes it, and
  Enter still presses **Cancel** (B2).
- **A spinner** (R7, S10) shows only after the first second, as B5 says: on
  РЭХА's start (“Connecting to the audio engine…” shows at once, the spinner
  after a second) and in the service where a panel's take or song is still
  on its way. There the words “Opening…” after
  0.3 s go: nothing shows for the first second, then the shared Spinner, and
  from 10 s “Opening…” beside it, as History does (B5). On a job in РЭХА's
  activity list the spinner waits a second too.

### РЭХА

- **A folder's path and its Browse** (R10: Settings › Folders, the share
  dialog) sit in one frame, as one control.
- **A number between − and +** (R15: the metronome's tempo, the backing
  track's first bar) sits in one frame.
- **The bar at the top of the window when something went wrong** (R8) takes
  the shared Alert's look, in red, in the same place.

### The service

- **The left column** (S3) is shadcn's Sidebar. On a computer it looks as it
  does now. On a phone the menu (S2) slides out as a Sidebar does there, 256
  px wide as now, named “Menu” as the ☰ button is: Esc closes it, the focus
  stays in it until it closes, and the page behind dims in the shared
  colour. Neither column has a key of its own (shadcn's Ctrl/⌘+B is off).
- **The right panel** (S18) is a Sidebar on the right. On a take's page,
  folded, it is the strip of icons it is now, 48 px; open, it takes 448 px
  beside the page, 400 more than the strip, and the page narrows by as much
  (Alex, 21:52:04). On a page with no strip (Songs with Statuses or Labels
  open) it is gone when closed and narrows the page by 448 px when open. On
  a phone a take still opens its own page, as before, and the panel (a
  mark's, Statuses, Labels) keeps today's place: between the header and the
  player bar, at full width, with no veil, the bar still usable.
- **A narrow window** (Alex, 22:23:17): below 1100 px wide, while the right
  panel is open, the left column folds to its icons (48 px, each with its
  section's name as a tip) and opens again when the panel closes. At 960 px
  the page keeps about 462 px; at 1180 px, where nothing folds, about 506 px
  (the left column is 224 px, `shell/Side.tsx:67`). While a panel is open
  the page takes the layout it has in a 960 px window (Alex, 23:17:30).
  From 500 to 819 px the panel lies over the page as now and the left
  column stays open (Alex, 23:19:52).
- **Tips** (S4) are the shared Tooltip, and a name cut short shows in full in
  WholeTip, as in РЭХА. On a phone neither shows, as the browser's never did.
- **The bar of the take playing** at the bottom (S5) moves with ← and → once
  it has the focus, and a screen reader names it.
- **Errors** (S11) are 14 px everywhere (FieldError's size), in three kinds:
  - under a field (a song's notes, New song, a mark's note, a comment, a
    label's or status's name, the sign-in pages, your name, a set's length,
    and a name edited in place): the field keeps an empty 20 px line under
    it, and the error fills it, so nothing below moves (B4). These fields
    grow by that line; nothing else does. A set's length said its error only
    as a browser tip on the field (`sets/SetPage.tsx:207`); it moves to that
    line.
  - in a row, after a button or a menu (removing a song's file, a take's
    menu, a song's tempo, deleting a set or a song, a take's levels): in
    place as now, one size.
  - under a list or a page's button (removing from a list, New set, a set's
    songs, Members, Trash): in place as now, one size.
  - A page that could not be read (`Trouble`) is the shared Alert, with
    **Try again** as now.
- **An empty section** (S9) is the shared Empty, as in РЭХА: centred, its
  title and a line of text. The words are today's: the first sentence of each
  (Songs, Marks, Rehearsals, Sets) becomes the title, the rest the line.
- **A label's or status's colour** (S15) opens as a grid of colours in a
  pop-up by its swatch, as the icons do in РЭХА, instead of a row under it.
- **Move to song** (S16) has a search field at the top of its list, focused
  when the list opens. **Not named** and **New song…** stay where they are
  and outside the search, so a search that finds nothing still shows them.
- **The code from the email** (S17) is six boxes, a digit in each. It still
  fills itself from the email where the phone offers it, and pasting the
  whole code fills all six. **Sign in** is still pressed, as now.
- **A name edited in place** (S7: a song's, a set's, a new song's) has ✓ and
  ✕ inside its field's frame instead of beside it.
- **The dotted line under a word that opens** (C1) is 1 px, as in РЭХА.
- **Headings** that were 18 px become 16 px (a mark's panel, Statuses,
  Labels, a set's name and song, the two sign-in pages), as F5 sends 18 to
  16. The letters in the star circles and “GP”/“PDF” on a file become 12 px
  from 10 px, as F5 sends 10 to 12.
- **The stage view's song title** (`sets/Stage.tsx`) is sized from the
  window's width instead of a fixed 36 px: 8.5 % of the width, from 28 px
  (reached at 330 px wide) to 56 px (reached at 660 px), so a long title
  fits a phone held upright and stays big on a tablet. A title too long for
  a line wraps, balanced, as now.

### The site

- **Questions and answers** (W1) open and close with the shared Accordion:
  the same look, opening in 250 ms (F10), at once under Reduce motion (F11),
  and ↑/↓ between the questions. A closed answer stays in the page, hidden,
  so search engines still read it; the browser's Find no longer opens a
  closed question, as `<details>` did.
- The pieces under a story's window and the steps (W2), and the app's icon in
  the menu (W3), look as they do now.

## How it is built

### The check

- `ui/scripts/design-check.mjs` walks `ui/src`, `service/src` and
  `site/src`, and reports paths from the repository's root
  (`service/src/shell/Shell.tsx:46`). Given a part's name, `ui`, `service` or
  `site`, it walks only that part; with none, all three.
- Each part's workflow runs it on its own part, before its build:
  `interface.yml` for `ui` (as now), `service.yml` for `service`, and the
  site's action `.github/actions/site/action.yml` for `site`. All three
  workflows already run on a change to `ui/**`, so a change to the rules is
  checked against every part.
- `components/ui/` is still `ui/src/components/ui/`, the one place where the
  `outsideUi` rules do not apply. The allow-list keeps its file and stays
  `{}`; its keys become paths from the root.
- New rules, each outside `components/ui/` only:

| Rule | Refuses | Use instead |
|---|---|---|
| `raw-field` | `<input>` (but `type="file"`, which shadcn has nothing for), `<textarea>`, `<select>` | Input, Textarea, InputGroup, Slider, Select |
| `raw-label` | `<label>` | Label |
| `spinner` | `animate-spin` | Spinner |
| `native-tip` | `title=` on an HTML element or on a router `Link` (not on `<iframe>`, where it names the frame) | Tooltip, WholeTip |
| `pressed-button` | `aria-pressed` on `Button` | Toggle, ToggleGroup |
| `card` | `rounded-xl` with `bg-card` in one class string | Card |

- An attribute may sit on a later line than its tag (`<span` on one line,
  `title={…}` two lines down): the rules that read attributes find the tag
  they belong to across lines.
- `design-ok` keeps its two kinds (a small graphic that keeps its own corner,
  text sized from the window) and gets a third: a sheet made for paper, which
  is black on white whatever the theme and sized for A4 (`sets/Print.tsx`,
  Alex's set list for the stage of 9 November).
- `docs/design-system.md` (K1: a PR that adds a shared component or changes
  a rule changes it too): K3 and "The check" list the new rules, the three
  parts and the third kind of `design-ok`; C3 says a question is
  AlertDialog; B2 says a click outside does not close it; B5 says the
  service waits the same second; C8 drops InputGroup and the side panel from
  "added by the first screen's pull request that needs them" and lists the
  new components; "Where things stand" says the service and the site are
  checked too.

### New shadcn components

Added with `npx shadcn add`, by "Adding a shadcn component"
(`docs/design-system.md`): put on the theme, `button.tsx` and `input.tsx`
never overwritten, a story and a line in C8 each.

AlertDialog, Textarea, InputGroup, ButtonGroup, Field, Avatar, Sidebar (with
the Skeleton it needs), Accordion, InputOTP (the `input-otp` package) and
Command (the `cmdk` package). shadcn's own Combobox is built on Base UI, not
Radix (its registry entry needs `@base-ui/react`), so Move to song's search
is shadcn's older Radix pattern: Command, here inside the Move to song
submenu that is there now.

AlertDialog takes Dialog's frame (12 px corners, the 16 px title, the veil,
C3), and ConfirmDialog keeps `DialogButtons` in the system's order (P3), so a
question looks as it does now. Its role is `alertdialog`, so РЭХА's key
guards that look for an open dialog (`LAYERS` and the dialog's own arrow
keys in `hooks/useSpacebar.ts`, `hooks/useUndoKey.ts`) look for it too:
with a question open, Space, Esc and ⌘Z do not reach the screen behind.

Two Sidebars on one page need two of its providers, each with its own state.
shadcn's copy toggles on Ctrl/⌘+B anywhere in the window and keeps its state
in a cookie; ours has neither, so the left column stays as it is now and the
right one's open state is the panel's, from the address as now. Its colours
(`--sidebar-*`) are our tokens in both themes: the left on `--panel`, the
right on the service's `--side`, as the panel is now. shadcn's Sidebar turns into a Sheet
under 768 px; ours takes that width as a prop too, and the service passes its
phone's, under 500 px (`shell/size.ts`), so the columns keep the widths at
which they change now.

### Each row

| Row | Where | Becomes |
|---|---|---|
| R1 | `components/ConfirmDialog.tsx`, `ConfirmDialog` only (`PromptDialog` and `RenameTakeDialog` stay on Dialog) | AlertDialog, Cancel focused first |
| R2 | `components/TakeNameField.tsx` | InputGroup (its input or text box, ✕ as an addon) and Label |
| R3 | `components/LaneControls.tsx`, the fader | Slider, a variant whose track is clear so the meter shows through |
| R4 | `components/NameField.tsx` | Textarea, a variant with a line under it |
| R5 | `components/IconPicker.tsx` | ToggleGroup, its own ↑/↓ by rows kept |
| R6 | `StarButton.tsx`, `RegionTag.tsx` | Toggle |
| R7 | `ActivityButton.tsx`, `App.tsx` | Spinner |
| R8 | `ErrorBar.tsx` | Alert, `destructive` |
| R9 | the six `rounded-xl bg-card` groups (`RehearsalOverview`, `MarksPage`, `SongPage`, `TakePlayer`, `Recording`, `Setup`) | Card |
| R10 | `FoldersSettings.tsx`, `ShareDialog.tsx` | ButtonGroup |
| R11 | `DevicePicker.tsx`, `Rehearsal.tsx` | Label |
| R12 | `FooterRow.tsx`, `Shell.tsx` | Separator, vertical |
| R13 | `NextTakeSongs.tsx`, `TakeStrip.tsx`, `SongTab.tsx`, `midi/NotesFold.tsx` | Collapsible |
| R14 | `backing/FileStart.tsx`, bar one's mark | Slider, a variant drawn as the mark |
| R15 | `metronome/TempoField.tsx`, `backing/BarOneField.tsx` | ButtonGroup |
| S1 | the 14 hand-made buttons | Button or Toggle |
| S1b | **Statuses** and **Labels** on Songs and Marks (`songs/Songs.tsx`, `marks/Marks.tsx`), the service's star (`takes/parts.tsx`), all `Button` with `aria-pressed` | Toggle (`outline`, `row` for the two), pressed while their panel is open; pressing again closes it, as now |
| S2, S3 | `shell/Side.tsx`, `shell/Shell.tsx` (the phone menu) | Sidebar, left; the lit section through SidebarMenuButton's `isActive`, in `ITEM_CHOSEN` (C4) |
| S4 | the 8 `title=` tips, and the take link's | Tooltip, WholeTip |
| S5 | `shell/PlayerBar.tsx` | Slider, a variant drawn as the bar |
| S6 | the `TEXTAREA` class | Textarea |
| S6b | the track rows' `<label>` in `takes/Download.tsx` | Label |
| S7 | song, set and new-song names edited in place | one shared piece in `service/src/shell/` on InputGroup |
| S8 | `Avatar`, `Logo`, `Initials` | Avatar |
| S9 | `Empty` in `shell/parts.tsx` | the shared Empty |
| S10 | `Waiting` | Spinner |
| S11 | the 21 `role="alert"` lines | Field with FieldError; Alert for a whole page (`Trouble`) |
| S12 | the list rows on `<div>` | Item, ItemGroup |
| S13 | `Pill`, the mark's and file's pills | Badge |
| S14 | `Groups`, `signin/Frame.tsx` | Card |
| S15 | the colour row in `shell/EditList.tsx` | ToggleGroup in a Popover |
| S16 | `takes/move.tsx` | Command inside the Move to song submenu |
| S17 | `signin/SignIn.tsx`, the code | InputOTP |
| S18 | `shell/Shell.tsx` panel, `shell/drawer.tsx` strip | Sidebar, right, `collapsible="icon"` on a take's page |
| W1 | `site/src/page/Faq.tsx` | Accordion, in the site's look |
| W2 | `site/src/page/Story.tsx` | Toggle for the pieces (they are pressed), Button for the steps; `page.css` keeps their look |
| W3 | `site/src/page/Nav.tsx` | the icon file `ui/public/logo.svg` as an image, instead of its colours drawn in the code |
| C1 | `OPENS` copied in `service/src/shell/parts.tsx` | the one in `button.tsx` |
| C2 | the service's three mark lines | `MarkLine` from `mark.tsx` |
| C3 | `Choice` in `service/src/takes/Download.tsx` | `ShareOption`, made shared |
| C4 | the seven hand-written "chosen" greys (six in РЭХА, `LIT` in `service/src/shell/Side.tsx`) | `ITEM_CHOSEN` from `item.tsx` |

The rest the check finds in the service goes as follows: the colours
`text-white` (`home/FirstDay.tsx`, the check on a colour) become a theme
colour; `bg-black/30` goes with the phone menu (S2); a mark's diamond
(`takes/parts.tsx`) keeps its 2 px corner under `design-ok(radius)`, as the
same diamond does in `Timeline.tsx`.

## Rules for Claude

- CLAUDE.md, under "Features": "Build every piece of the interface, mockups
  included, from `ui/src/components/ui/`, then from shadcn's registry (`npx
  shadcn add`); make one of our own only when neither has it.
  `npm run design-check` covers `ui/src`, `service/src` and `site/src`."
- `/check-plan`, section D: "Each new or changed piece of the interface
  names the component it is built from, in `ui/src/components/ui/` or in
  shadcn's registry, or why neither has it. A piece with none is a finding."

## Where it shows

- **reha.stream** (Alex, 22:24:16): W1–W3 change nothing in the look and no
  words change. The band service story's pictures
  (`site/src/stories/band-service/`) are retaken where the frame shows, and
  Alex sees them and the site before merge.
- **Guide pictures** (`tests/docs_screenshots.py`): retaken where R8, R10 or
  R15 show.
- **The service's pictures** (`service/pictures/`): retaken.
- **CHANGELOG**, under "Unreleased": one item for РЭХА and one for the
  service, each naming what the band sees from the list above.
- **`docs/using-it.md`** and **`service/README.md`**: lines that describe
  a changed piece (the code from the email, a question that closes on a
  click outside) are brought into line.

## Tests

- `ui/scripts/design-rules.test.mjs`: each new rule refuses what it should
  and lets pass what it should (a file picker, an iframe's title, a `title`
  prop of our own component, a tag whose attribute is two lines down), the
  paths from the root, and a part given by name.
- The e2e tests that read a changed piece by its old shape: the fader's
  value (`ui/e2e/volume.spec.ts` reads it as an input's value), the service's
  menu, panel and strip, the code boxes, Move to song, and every lookup of a
  question as `getByRole("dialog")` in `ui/e2e` and `service/e2e`, which
  becomes `alertdialog`.
- New: a question does not close on a click outside it, and Space with a
  question open does not start a take; the phone menu closes on Esc; on a
  take's page the panel, opened, narrows the page by 400 px and, closed,
  folds to the 48 px strip; Move to song finds a song by typing; an error
  under a field moves nothing below it.

## Calls Claude made

1. The right panel, closed on a page with no strip, is gone, as a Sidebar
   that folds `offcanvas` is.
2. ConfirmDialog keeps Enter on Cancel (B2) and Esc closing it.
3. The spinner waits a second everywhere, the service's panels included (B5
   was settled for РЭХА only).
4. The Sidebar becomes a Sheet below the service's phone width (500 px),
   not shadcn's 768 px; on a phone the right panel keeps today's place
   rather than a Sheet's.
5. The stage title sized from the window, with `design-ok(text-size)`.
6. A third kind of `design-ok`, for a sheet made for paper.
7. `text-white` on FirstDay's done step and on a colour's check mark becomes
   a new theme colour, `signal-foreground` and `mark-foreground`, each white
   in both themes as now.
8. The mark's diamond in the service keeps `rounded-[2px]` under
   `design-ok(radius)`.
9. The site's pieces keep `page.css`'s look over the shared Toggle and Button.
10. Move to song's search is Command in a Popover, not shadcn's Combobox on
    Base UI.
11. R5's icons and S15's colours keep their own ↑/↓ by rows; ToggleGroup's
    own arrow keys are off there.
12. R10 and R15 on ButtonGroup rather than InputGroup.
13. S7's shared piece lives in the service, as only the service edits in
    place this way.
14. C4 on the existing `ITEM_CHOSEN`, not a new variant.
15. Neither Sidebar has shadcn's Ctrl/⌘+B or its cookie.
16. One pull request for all of it; the check's commit after the last fix,
    words and pictures after it.
17. NameField's text box keeps its own way of growing with the text: the
    CSS that shadcn's Textarea grows with, `field-sizing`, came to WebKit only
    in Safari 26.2 (https://webkit.org/?p=17640), and РЭХА on an older Mac
    draws with that system's WebKit.
18. W3: the icon as an image of `ui/public/logo.svg` (the same three
    colours), not a `design-ok` mark as the audit offered.
19. Errors are 14 px, FieldError's size; the line is reserved only under a
    field; the stage title's 8.5 % and its 28–56 px range.
20. When a panel opens or closes and the page changes its layout, the row
    that opened the panel is scrolled back into view.
21. R8, the error bar, takes the shared red Alert as it is, without today's
    light red wash behind it.
22. The service's mark lines (C2) are a `service` kind of MarkLine that keeps
    their words and look: the note alone, or the label's name, with the time
    to hours.
23. Sign-in's two errors that run to two lines keep a room two lines high,
    so nothing below them moves.
24. Trouble, the page that could not be read, is the red Alert, as a failure.
25. A set's length row no longer grows 4 px when it opens.
26. The song page's status, key and menu leave the title's heading; “No key”
    loses the title's weight and matches the status beside it.
27. A set's rename error takes the place of the line under the set's name,
    as a song's does, so the page does not move.
28. While a panel stands beside the page, **Sets** puts its list above the
    set, so the set's songs keep room for their names.

## Not in this

- Option Г, the hook that checks each file as Claude writes it.
- The three earlier decisions under «Решено раньше» in the audit.
- The thread «Показывать стерео и Backing в сервисе» (PR #166) changes
  ten of the files this one does: `ui/src/components/LaneControls.tsx`,
  `ui/src/components/Timeline.tsx`, `ui/e2e/lanes.spec.ts`,
  `service/src/takes/Take.tsx` (S11 touches it), `service/e2e/takes.spec.ts`,
  `service/pictures/seed.ts`, the band service story's pictures,
  `docs/design-system.md` (C6 only), `docs/using-it.md` and CHANGELOG.
  Whichever of the two merges second rebases, settles the conflicts and
  retakes the pictures; if this merges first, the stereo branch's new code
  must pass the six new rules too (checked on b273ef6: it adds no hit).
