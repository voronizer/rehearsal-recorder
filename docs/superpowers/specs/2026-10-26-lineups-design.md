# Named lineups of the band (#13)

Today the setup screen keeps one band. Removing the drummer for one evening
removes them for good, because **Start rehearsal** writes whatever is on
screen over the one saved band (`src/rehearsal_recorder/api.py:2237`), and
so does **Save as template** (`api.py:1987`).

This keeps several lineups, each with a name: Full band, Trio, With keys. The
title of the tracks' group on the setup screen becomes a menu that picks
one, and its tracks, icons and inputs replace the ones on screen. A lineup
changes only when someone presses **Update** or saves a new one. Start still
remembers what was on screen, but only as *last time*, what the screen opens
with next.

Issue #13 and its comment are the brief. Where this spec differs from them,
it says so.

Every piece on screen is drawn with the design system's components and tokens
(`docs/design-system.md`).

## Decisions

Alex decided these on 26 Oct 2026, on mockups built from the app and the
site. Sources are in `/mnt/project-files/lineups/q1` and `q2`.

- **L1. #13 as written** (07:57Z, «делаем»): several named lineups; a
  lineup is a snapshot of the screen, the people and their inputs on each
  card; Save as template goes; Start no longer writes into any lineup; the
  band saved today becomes the first lineup, *Band*; Rename and Delete,
  Delete asks first. History does not show which lineup a rehearsal used.
- **L2. Take icons, from the issue's comment**: a take keeps each track's
  icon, so switching lineups or changing an icon never redraws old takes.
- **L3. The lineup is the group's title, a menu** (Q1, «B. Меню-заголовок»,
  mockup https://claude.ai/artifact/9HSj7LEe4unodWQxpAPdoV): `Full band ▾`
  where *Tracks* is now. The issue's row of pills is not built. Switching
  takes two clicks.
- **L4. A tile on reha.stream** (Q2, «C. Плитка», mockup
  https://claude.ai/artifact/5vTugWz928RLHJnk3vZ3YF): a fourth tile in
  *Before you play*, after the backing track's.

Calls Claude made on its own are marked *(new)* where they appear, and listed
together in [Claude's calls](#claudes-calls).

## 1. On the setup screen

### The title

The tracks' group (`ui/src/screens/Setup.tsx:920`) is headed by the picked
lineup's name, as a menu button: `Full band ▾`, in the heading's size and
weight. While the tracks on screen are not the lineup's, the button says so
in the muted colour after the name: `Full band · changed`. With no lineup
picked (the picked one was deleted), the button says `Tracks ▾`.

A long name is cut and shown whole in the shared tip (B6). The group keeps a
heading: the button sits in the `h2`, so a screen reader still reads the
group by its lineup *(new)*.

### The menu

Opened, the menu lists:

- every lineup, a radio item each, the picked one checked, with how many
  tracks it has (`4 tracks`), as the set picker shows a set's songs;
- a line, then **Save as new lineup…**;
- with a lineup picked, **Rename “Full band”…** and **Delete “Full band”…**
  (destructive red, as a menu item that deletes).

### Changed, Update and Save as new

*Changed* compares the tracks on screen with the picked lineup as it is laid
out on the card in force: the same tracks in the same order, each with the
same name (trimmed), stereo, icon, input, what it records (Audio, Both or
MIDI) and MIDI port. The issue lists names, stereo, icons and inputs; what a
track records and its port came with MIDI, after the issue, and belong to
the band in the same way *(new)*.

While the screen is changed, two buttons stand in the head, where Save as
template was:

- **Update** writes what is on screen over the picked lineup. It says
  *Update* alone, without the name, which is right beside it in the title
  (the mockup's B).
- **Save as new…** asks for a name and adds a lineup made of what is on
  screen, and picks it.

With no lineup picked, **Save as new…** alone stands there. When the screen
is the lineup's, neither does. They stand before Check signal, so that Check
signal keeps its place at the end of the row as they come and go (B4). In
the mockup they stood after it and pushed it left *(new)*.

### Picking a lineup

A click on a lineup in the menu puts its tracks on screen at once, laid out
on the card in force. When the tracks on screen were changed, those changes
would be lost, so a notice says *Your changes to Full band were not kept.*
with **Undo** for 10 seconds, as a track taken off does (B1, R20). Undo puts
back the tracks and the pick as they were *(new)*. With nothing changed
there is nothing to lose and no notice.

Picking also:

- stops a signal check that is running: the inputs it listens to are not the
  new lineup's *(new)*;
- drops the notices of tracks taken off, whose Undo would put a track of the
  old lineup into the new one *(new)*.

### Save as new and Rename

Both are small dialogs with one field (`PromptDialog`, C3):

- **Save as a new lineup**, the line *The tracks on screen, their icons and
  their inputs.*, a **Name** field, and **Save lineup**.
- **Rename “Trio”**, the field filled with the name, and **Rename**.

A name is trimmed and cut as a set's is. One that is empty, or that another
lineup has (compared regardless of case), is refused, and the dialog says so
beside the field until the name changes: *There is already a lineup called
Trio.* This is the rule sets keep (`store/library.py:1816`) *(new)*.

### Delete

**Delete “Trio”…** asks first (B2: a lineup deleted cannot be brought back):
*Delete “Trio”?*, with *The tracks on screen stay as they are. Rehearsals
recorded with it keep their tracks.* and a red **Delete lineup**. Deleted,
it leaves the menu; the tracks on screen stay, and if it was the picked one,
none is picked. The last lineup can be deleted too; the menu then holds
Save as new lineup… alone.

### Start, and what the screen opens with

**Start rehearsal** remembers the tracks on screen as *last time*, on this
card, as it does today, and which lineup was picked. It writes into no
lineup. Next time the screen opens with last time's tracks and that lineup
picked, so a rehearsal started from Full band without the drums opens as
`Full band · changed`.

**Update** and **Save as new…** also make what they saved last time *(new)*.
Today Save as template makes the screen open with what was saved; without
this, a band set up at home and saved on Sunday would open on Tuesday with
last Tuesday's tracks instead.

Picking a lineup without starting is not remembered: closing the app opens
last time again, as an edit not started is lost today.

A card found by **Look again** lays out the tracks on screen, edits and all,
as today (`Setup.tsx:205`), and the lineups along with them.

## 2. What is saved

The band stays in `config.json`. `tracks` and `layouts` keep their shape and
their meaning for last time, so everything that reads them now keeps working:
the setup screen's first answer, the controller's Start without a setup
(`transport.py:250`), Tap from pads (`api.py:5327`) and the probe
(`audio/probe.py:231`).

Two keys are added:

- `lineups`: a list of `{"name", "tracks", "layouts"}`, each `tracks` a band
  as `layouts.band_member` writes it and each `layouts` an input map per card
  as `layouts.remember` writes it. So `band_member`, `remember` and
  `for_device` work on a lineup unchanged, as the issue says.
- `lineup`: the name of the lineup last time was picked from, or null.

`layouts.migrate` (`layouts.py:73`) adds them on a config that has no
`lineups`: one lineup named *Band*, a copy of `tracks` and `layouts`, and
`lineup` set to *Band*. A config that has `lineups` is left alone, so the
step is safe on every read. A fresh install gets *Band* with no tracks, which
`for_device` lays out as the first-run pair, so its menu is not empty *(new)*.

### Python's side

- `load_default_tracks(band)` also answers `lineups`, each laid out on the card
  in force with `for_device`, and `lineup`. The screen works out *changed*
  itself, as the tracks are edited.
- `update_lineup(name, device_index, tracks)`, `add_lineup(name,
  device_index, tracks)`, `rename_lineup(name, new_name)`, `delete_lineup(name)`
  each answer the lineups laid out again, and `lineup`, or `{"ok": false,
  "error"}` in the words above. Rename and delete also rename or clear
  `lineup` when it names that lineup.
- `start_rehearsal` takes `lineup`, the picked name, and keeps it with last
  time. The controller's Start with a setup accepts it too, and without a
  setup keeps last time's.
- `save_default_tracks` is no longer called by the screen. The Python tests
  use it to set up a band; it stays as the way to write last time without
  starting *(new)*.

## 3. A take keeps its icons

From the issue's comment, with today's numbers.

The player draws each lane's icon from the band as it is **now**, by the
track's name (`api.py:1641`), and so do the notes lane's drum grid
(`api.py:1703`), the tempo counted from a take and the drift line, which
listen to the drums (`api.py:5044`, `api.py:5084`). With lineups, switching to
Trio would take the keys icon from every old take with keys.

- `take_file` gets a nullable `icon` column, in migration **0010** (the
  comment's "0002" was the next free number then).
- It is written when the take is saved, from the tracks the rehearsal started
  with, by name, for a WAV and for a .mid alike. A Backing track keeps none:
  its kind already says what it is.
- Every place that moves a take's files or makes its list again carries the
  icon over: Keep moving a draft's files into the take (`api.py:3200`),
  renaming a take's folder (`api.py:3726`), and crop.
- A draft writes each track's icon into its record (`audio/capture.py:642`),
  so a take recovered after a crash keeps it. A draft written before this
  has none there, and its recovered take gets the icons of last time's band
  by name, once, when it is recovered *(new)*.
- The take's tracks and notes, as the interface gets them
  (`store/library.py:240`), carry the icon. `take_media`, `take_notes`, the
  counted tempo and the drift line read it from there, and nothing reads the
  band to draw an old take. A track with no icon gets the neutral one.
- **Takes recorded before this**: migration 0010 fills the column once, from
  the band as it is at that moment, matched by name. The band is handed to the
  migration by the app (`store/db.py:103`), because the migration cannot read
  `config.json` itself. A database upgraded later, after a change of
  recordings folder, gets the band as it is then. After that those takes keep
  what they were given.

A take's icon could also have gone on the rehearsal's own tracks (the
`track` table, `store/models.py:116`), one row per member. It goes on
`take_file`, as the comment says, because a take moved to another rehearsal
keeps its icons that way.

## 4. reha.stream

A tile in *Before you play* (`site/content/story.md`), after *A song brings
its backing track.*:

> **A lineup for each evening.**
>
> Full band, Trio, With keys: pick one in the title over the tracks, and
> everyone is back on their own input.

Picked, the window comes near to `Full band ▾` over the tracks (a moment of
the live app, `site/src/page/evening.ts`), and under the window:

> Take the drums off for one evening, and Full band stays as it was. Update
> keeps a change for good, and Save as new makes another lineup.

The site's band (`ui/e2e/band.js`) gets the three lineups named there, Full
band being its four musicians, so the window shows `Full band ▾` *(new)*. The
step's opening line, *The tracks are filled in from last time*, stays true.

## 5. The guide, the CHANGELOG and pictures

- `docs/using-it.md`, *Set up the tracks*: the paragraph on Save as template
  (`:65-67`) gives way to a new section, *Lineups*, after it: what a lineup
  is, the menu, changed, Update, Save as new, Rename and Delete, and the
  example of the drummer away, in the issue's words.
- *Changing the interface* (`:754`): "Removing a track removes that musician
  on every interface" is no longer true; it becomes: a track taken off is off
  the screen, and a lineup changes only with Update.
- `CHANGELOG.md`, Unreleased: a first item, **Lineups.**, so the site's news
  line reads it.
- The guide's `setup.png` is taken again (`tests/docs_screenshots.py`).

## 6. Tests

- Python: `layouts.migrate` from today's config, twice; lineups laid out on
  another card; update, add, rename, delete and their refusals; Start writing
  last time and the name and no lineup; migration 0010 with the backfill;
  icons written at save, carried by crop and move, read by `take_media`,
  `take_notes`, the counted tempo and drift; a draft recovered with and
  without icons in its record.
- Browser (`ui/e2e/setup.spec.ts`): the title menu; changed appearing and
  going; Update; Save as new and a taken name; Rename; Delete asking; picking
  with Undo; picking stopping the check; the title cut with its tip; nothing
  in the head moving. The three Save as template tests go
  (`setup.spec.ts:250`, `:519`, `:966`, `midi.spec.ts:272`), each replaced by
  the same check through Update.
- Site: the content test for the new item, and the tile in the page tests.

While building, only the tests a change touches run, once each; the full
suites run on CI.

## Not in this

- Which lineup a rehearsal was recorded with, in History (the issue leaves it
  for a separate issue).
- Ordering lineups by hand: they stand in the order they were made *(new)*.
- Picking a lineup from the controller or a key.

## Claude's calls

1. *Changed* also compares what a track records and its MIDI port.
2. Picking a lineup over a changed screen replaces it at once, with Undo for
   10 s, rather than asking.
3. Picking stops a running signal check and drops the Undo notices of tracks
   taken off.
4. Update and Save as new stand before Check signal, not after it as in the
   mockup, so Check signal does not move.
5. The group's heading is the menu button itself, so the group is still read
   by its lineup.
6. Lineup names follow the sets' rule: trimmed, cut, refused empty or taken
   regardless of case.
7. Update and Save as new also become last time, so the screen opens with
   what was saved, as Save as template does today. Picking without starting
   is not remembered.
8. A fresh install starts with *Band* holding no tracks, shown as the
   first-run pair.
9. `save_default_tracks` stays, unused by the screen, for the tests.
10. A draft from before this gets last time's icons by name when recovered.
11. The take's icon goes on `take_file`, as the comment says, not on the
    rehearsal's tracks.
12. The site's demo band gets Full band, Trio and With keys.
13. Lineups stand in the order they were made, with no reordering.
