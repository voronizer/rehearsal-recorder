# Listening apart from recording

**Stop** saves the take at once and opens it on the rehearsal screen,
paused, for listening. The screen after a take, with **Save take** and
**Discard**, goes. While a take is open the footer says what Esc and Space
do: **Close take** and **Play**.

- **Space and Esc were invisible.** With a take open, Space plays it and Esc
  closes it, but Record and Finish hide their key chips and keep the room
  (Alex, 8 Nov 23:02).
- **The last take of an evening stayed unsaved.** It is saved only by
  **Save take** (`Review.tsx:204`). Space there is Save take, so takes
  seemed to go to the band service at the next Record. After the last take
  nobody pressed anything, and it never went (Alex, 8 Nov 23:41).
- **Listening and recording were mixed.** Alex's idea (8 Nov 23:28):
  record, listen, Esc closes, record the next.

Decided with Alex on 8 and 9 Nov 2026 in the thread «Сделать понятными
пробел и Esc». Variant 3 of the mockup
(https://claude.ai/artifact/8rEScExe6nWVHcXdoFKjLw), his ok 9 Nov 00:16; a
new take goes when it is closed or after 10 minutes (same ok); the four
gaps below, his «согласен» 00:15; «и сразу делай и мержи пр» 00:16. The
spec as a doc: https://claude.ai/artifact/X8vXNrSV4MeUf9DL6jUE7D.

## The flow

1. **Record** (Space): the recording screen, as now.
2. **Stop** (Space), on the screen or the controller: the take is saved,
   and the rehearsal screen opens with it open in the player, paused at
   0:00.
3. **Play** (Space) and **Pause** play it. Marks, ★, name, crop and the
   trash work as on any open take.
4. **Close take** (Esc) stops it and closes it. The footer shows **Finish**
   and **Record** again.
5. **Record** (Space) starts the next take.

To record again at once after Stop: Esc, then Space. Two Spaces after Stop
used to mean "save it and record the next"; now the first Space plays the
take.

## The rehearsal screen

| Moment | Footer left | Footer right | Right panel | Esc | Space |
| --- | --- | --- | --- | --- | --- |
| No take open | Metronome and backing | **Finish**, **Record** | Next take, set, songs | Finish | Record |
| A take open | **Send to the band service** box (or **Send to the cloud**) | **Close take**, **Play** / **Pause** | The take's marks | Close take, stops it | Play / Pause |
| A take playing in the overview, not open | Metronome and backing | **Stop**, **Pause** | Next take, set, songs | Stop | Pause |

- **D1. Keys on the buttons.** Every footer button shows its key chip when
  keys are on (Settings › Keys); nothing hides a chip and keeps its room.
- **D2. Esc stops.** Closing an open take stops it too; it no longer plays
  on in the overview (8 Nov 23:32).
- **D3. Marks on the right.** While a take is open the right panel lists
  its marks in time order: a click moves the take there, a pencil and a
  cross on hover edit and remove (8 Nov 23:35). The chips under the lanes
  go.
- **D4. No metronome or backing while listening.** They are set for the
  next take, and a take's own click is the player's **Click with the take**
  (8 Nov 23:36). The row keeps its height, so nothing jumps.
- **D5. The send box.** Ticked means the take goes. It starts as the
  setting leaves the take: a false start (shorter than the setting, no ★,
  no marks) unticked. Ticking sends a false start anyway; unticking takes a
  good take out (the band service's Remove from the band service, a cloud
  copy's removal) (9 Nov 00:06).
- **D6. No "Waiting for the band service" line on the open take.** The box
  and **1 waiting** at the top say it (9 Nov 00:10). Refusals still show
  ("Not in the band service").
- **D7. Opening another take closes this one**, from the list, ↑ ↓ or the
  controller.

## Sending

A take saved by Stop is held: neither the band service nor the cloud folder
sends it while it is held. Everything else about sending stays as it is (it
still waits while anything plays, `api.py:2575`).

The hold ends, and the take goes as the setting or its box says, when:

- it is closed (**Close take**, Esc), or another take is opened;
- the next take starts (**Record**, on the screen or the controller);
- the rehearsal ends (**Finish**), or the rehearsal screen is left;
- 10 minutes have passed since Stop;
- the app starts again (the hold lives in memory only).

A held take thrown away never leaves the computer. Closing the window ends
the hold too. A take for the band service then counts among the takes still
to send, so the closing question asks as it does now (`api.py:7109`);
**Close anyway** sends it next time. A copy for the cloud folder still to be
made is written down (`cloud-waiting.json` beside the settings) and made
when the app opens again.

Unticking a take's box for the cloud folder is kept on the take, as "not
this one": a mark, a ★ or a rename later does not send it after all.
Ticking it again sends it.

## Numbers

The trash on a held take gives its number back, as **Discard** did: after a
bad "Viasna #2" the next take is "Viasna #2" again. Numbers are otherwise
never given twice (`library.py:500`), and that stays for every take that
has left the hold.

- Only when it is still the song's newest number (or the newest number of
  the takes with no song).
- Its **Undo** brings it back with its number. If another take has taken
  the number meanwhile, Undo says the number is taken, as Undo already does
  for a taken place (`api.py:6348`).

## Controller, failures, the control API

- **Controller Stop** already saves at once (`transport.py:427`). It now
  also opens the take, paused, as the screen's Stop does; before, the
  screen came back with nothing open (`App.tsx:180`). Controller Record
  from a held take ends the hold and starts the next take.
- **A save that fails** says why and opens **Unsaved takes**, where
  **Recover** saves it, as a controller Stop that fails does now
  (`App.tsx:186`). Before, it opened the screen after a take to try again
  (`App.tsx:402`).
- **After a crash** nothing changes: the draft waits in **Unsaved takes**
  when the app opens.
- **`stop_review`** in the control API means the same as `stop_keep` from
  now on, so a controller or script that sends it still works
  (`docs/control-api.md:28`).

## What goes: the screen after a take

| Its part | Where it is now |
| --- | --- |
| **Save take** | Stop saves |
| **Discard** (Esc) | The trash on the open take, with Undo; the number comes back |
| The name field | The pencil on the open take |
| Marks | The player's **Mark**, the marks in the right panel |
| Crop | Crop on the open take (`crop_take`) |
| **Send to the band service** box | The same box, footer left |
| The song's takes tonight as columns | The take strip above the player: the song's takes with their lengths and ★ |

`Review.tsx` and its `"review"` screen in `App.tsx` go, with what only they
use (the discard offer; `crop_draft` and `discard_take` leave the
interface, and Python keeps them with their tests for now). **Unsaved takes** stays: a crash or
a failed save still leaves a draft.

## Words and tests

- **Guide** (`docs/using-it.md`): the section on the screen after a take
  becomes "Listening to a take"; Keys, Unsaved takes and the band service's
  sending say the new order. Its picture is retaken by
  `tests/docs_screenshots.py`.
- **Site:** the story "Record a rehearsal"
  (`site/content/stories/record-rehearsal.md:42`) and its frame
  (`site/src/stage/Story.tsx`) go from Stop to the open take, not to the
  screen after a take. No pictures before merge (Alex, 9 Nov 00:17).
- **Other docs:** `docs/control-api.md`, `docs/controller-contribution.md`,
  `docs/design-system.md` (footer buttons).
- **CHANGELOG:** one item under Unreleased, starting bold.
- **Tests:** Python for the hold, its ends, the number coming back and its
  Undo, `stop_review`; browser tests for the flow, the keys, the box, the
  marks panel, the failed save. Only the tests a change touches run while
  it is built; the full suites run once, on CI.

## Calls to review

Claude decided these alone:

- **10 minutes is fixed**, not a Settings row. A row can follow if a band
  needs another number.
- **Leaving the rehearsal screen** (History, Settings) ends the hold, like
  closing the take.
- **The hold lives in memory**: after a restart a held take simply goes.
- **`stop_review` stays** in the control API as another name for
  `stop_keep`, so old controllers keep working.
- **The marks panel is empty** for a take with no marks: a heading and
  nothing under it, no hint text.
- **An Undo during the next recording** brings the take back; the take
  being recorded then gets the next number when it is saved, not the one
  its screen showed.
- **The trash on the held take gives its name back too**: the title picked
  for the next take before it was recorded is picked again, so a false
  start of a new song is followed by that song.
- **Unticking takes out any copy still waiting** for the cloud folder, not
  only the held take's; a copy being made is still refused.
- **The click between takes and the backing track's ▶ stop** when a take
  opens, since their row is hidden while it is open.
