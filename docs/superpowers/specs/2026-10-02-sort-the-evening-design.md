# Sort the evening: on the rehearsal screen, while it is fresh

The moment a rehearsal ends is the moment the band best remembers which
goes were the good ones. The app lets that moment pass.

- **Sorting waited for a screen nobody sees.** The first version of this
  spec (2 Oct) put it on the screen after **Finish**. Bands do not press
  Finish at the end of an evening: they close the app (Alex, 7 Oct). That
  loses nothing, since every kept take is already in the library, but a
  screen after Finish would never be seen.
- **Nothing prompts anything:**
  - the "Take 4"s nobody named stay unnamed;
  - the ★ goes are not sent to the band unless sending is on for every
    take;
  - the false starts (a count-in, a stop after eight bars) stay on disk
    forever at the size of a multitrack recording.

So the evening is sorted where the band already is: on the rehearsal
screen, as it goes, and the same later in History. Nothing on it is
required. It stands on
[songs in the store](2026-10-02-songs-in-the-store-design.md) and
[stars](2026-10-02-stars-design.md).

Decided with Alex on 7 Oct 2026 in the issue #12 thread; the mockup is
https://claude.ai/artifact/858GuWkrAFhBk7EJkhs1mz.

## Decisions

- **D1. On the rehearsal screen, and the same in History.** Both draw the
  evening with `RehearsalOverview`; what is added here is added there, so a
  rehearsal sorted later in History looks and works the same.
- **D2. Three things, no more:** a name for each unnamed take (S2), Send
  starred (S3), and false starts (S4). Not part of it: clearing out the
  goes without ★, a "do again" list, a note on the evening, its size on
  disk, a softer cleanup.
- **D3. Nothing goes anywhere by ★ alone.** Send starred is a button.
- **D4. Finish goes straight to the start screen.** The *Rehearsal
  finished* screen goes; the start screen's Last time already shows the
  evening just finished.

## The overview

- **S1. Two buttons over the takes,** in the overview's row of figures
  (time played, takes, songs, in the cloud), on its right: **Send
  starred** and **Clear false starts**, each with its count. The legend of
  marks moves to a line of its own under them. In a window too narrow for
  the figures and the buttons on one line, the buttons go to their own
  line under the figures.
- **S2. A take with no song has the song pills under it, always.**
  - The pills are the Next take field's: tonight's songs, then the others
    by when they were last played, then All songs…, each with the go the
    take would be ("Pałyn 12"). One row of them.
  - A click names the take after that song: it becomes the song's next go
    (songs in the store, N4) and moves into the song's group.
  - A title nobody has played yet is given with ✎, as today.
- **S3. Send starred** queues every ★ take of the evening that has no copy
  in the cloud folder and is not waiting for one, as what Settings' *What
  gets published* says: the mix, the tracks, or both.
  - Its count is those takes. With none it is disabled, and its tooltip
    says why: nothing has ★, or every ★ take is in the cloud folder.
  - With no cloud folder chosen it is disabled, and its tooltip says to
    choose one in Settings.
  - The copies go the way a copy by hand goes: the row says "Waiting…",
    then shows the cloud.
- **S4. False starts.** A take is a false start when it is shorter than
  the limit in Settings (30 s unless changed) and has no ★ and no marks.
  - Its row stays where it is in its song, or in *Not named*: the bar is
    drawn dashed, its name and length grey, and a "false start" tag
    follows its length.
  - **Clear false starts** asks first: "Move 3 false starts to the Trash?",
    the takes listed with their lengths, and that they can be put back from
    there. Their cloud copies go too, as a delete with 🗑 takes them. With
    no false starts the button is disabled.
- **S5. The row's own buttons stay as they are:** ★ on a starred take, and
  ☆ ☁ ✎ 🗑 under the mouse at the row's right edge.
- **S6. Finish** asks as it does now when there are takes, then goes to
  the start screen.

## Settings

- **G1. False starts:** "Shorter than [30] seconds", a number from 5 to
  120, on the Folders page under the recordings folder. Saved in the
  config as `false_start_sec`.
- **G2. What gets published** is live whenever a cloud folder is chosen,
  not only while *Send saved takes automatically* is on, since it now also
  says what Send starred sends. Choosing it no longer switches automatic
  sending on.

## Python

- **A1. `delete_takes(folder, take_numbers)`** deletes each take as
  `delete_take` does, cloud copies included, and returns
  `{"ok", "deleted": [n…], "failed": [{"take_number", "error"}…]}`.
- **A2. `send_starred(folder)`** queues the rehearsal's ★ takes with no
  cloud copy and none waiting, as `share_take` does with the configured
  *What gets published*, and returns `{"ok", "queued": [n…]}`; with no
  cloud folder, `{"ok": False, "needs_dir": True}` as `share_take` does.
- **A3. `set_false_start(seconds)`** saves G1, clamped to 5–120;
  `get_settings` returns `false_start_sec`.
- **A4.** Naming from a pill is `rename_take(folder, take_number, title)`,
  which already makes the take the song's next go.

## reha.stream

The story had seven steps, and Alex found that too many. It becomes five,
and sorting the evening goes into the step about keeping a take:

1. **Set up the tracks.** (as now)
2. **Hear last week, then record.** The Next take field and last week's ★
   go beside it, then Record.
3. **Keep the good ones.** Stop, save the take, and back on the rehearsal
   screen the unnamed take gets its song with one click; the false start
   is grey, and the evening's two buttons are over the takes.
4. **Find it later.** History, song by song, and a song's page with every
   go at it.
5. **Compare goes.** (as now)

The demo evening gets a false start and an unnamed take for step 3.

## Testing

Tests come before the code, and each is seen failing first.

- **Python:** A1 with one take that cannot be deleted; A2 skipping a take
  in the cloud and one waiting, and refusing with no cloud folder; A3's
  clamp and default.
- **Playwright:**
  - a false start is drawn as one, and a short take with ★ or a mark is
    not; the limit from Settings is used;
  - a pill under an unnamed take names it and moves it into its song;
  - Send starred queues only ★ takes not in the cloud, says why when
    disabled, and is disabled with no cloud folder;
  - Clear false starts asks first, lists the takes, and removes only them;
  - the same three in History;
  - Finish lands on the start screen;
  - Settings: the limit is saved; What gets published is live with
    sending off and does not switch it on.
- **Site:** the story has five steps, and step 3 names the take.

## Docs

- `docs/using-it.md`: the rehearsal screen, Finish, false starts, Send
  starred, the settings.
- `CHANGELOG.md`.
- The pictures of the rehearsal screen taken again.
