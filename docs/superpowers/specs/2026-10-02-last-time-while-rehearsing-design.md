# Last time while rehearsing: earlier goes at the next song, on the rehearsal screen

> The *Before tonight* card was taken back before any release by [song sets](2026-10-08-song-sets-design.md) (D15). The panel, and the recording screen's "Took 3:20 on 22 Sep", stay.

"How did we play the bridge last week?" comes up in the middle of a
rehearsal, and the app cannot answer it there.

- **The rehearsal screen has no way into History** (`Rehearsal.tsx`; `App.tsx`
  routes to History only from the setup and finished screens).
- **Finishing to look is not an option.** Finish is final: "You cannot add
  to this rehearsal afterwards — a later one starts its own folder"
  (`Rehearsal.tsx`).
- **The first go of the evening at a song gets no "Took 2:21 last time"** on
  the recording screen (`Recording.tsx`). `_last_attempt` in
  `src/rehearsal_recorder/api.py` looks only at tonight's takes, though
  History knows how long the song ran last week.

This puts the song's earlier goes on the rehearsal screen, right beside the
Next take field that names the song, and lets the recording screen's bar
use them. It stands on [songs in the store](2026-10-02-songs-in-the-store-design.md),
[stars](2026-10-02-stars-design.md) and the [song page](2026-10-02-song-page-design.md).

Alex settled the design on 2026-10-07 in the thread "Задачи из обсуждения
#12", on the mockup https://claude.ai/artifact/PRTNcUPJUv1U6tNL6S85rg (its
screenshots are in the project's files, `issue12/step6/`).

## Decisions

- **D1. It follows the Next take field.** The card is about the song the
  next take is named for, the one the band is about to play. Pick another
  song under the field and the card changes with it. A take named "Take N"
  has none.
- **D2. One go, and a few more on request** (Alex, 10:52Z).
  - Shown: the song's newest ★ go before tonight, or with none, the last go
    of the latest rehearsal before tonight that has one.
  - "N more" adds under it the last go of each of the song's three latest
    rehearsals before tonight, newest first, less the one already shown. The
    first row stays where it was, and every bar is drawn to one scale.
  - The full list is on the song's page in History.
- **D3. It plays in place** (Alex, 10:19Z). ▶ plays a go right in the card,
  as Last time does on the setup screen; nothing opens.
- **D4. The field and the go sit together, in a panel of their own**
  (Alex, 11:04Z and 15:13Z): "мне не нравится что выбор названия песни и
  прошлый дубль разнесены". The Next take field, its songs and the card
  move out of the footer into a panel right of tonight's overview. The
  footer keeps only Finish and Record.
  - The save screen keeps its Take name field at the footer's left, so
    after Stop the name is in another place than it was before Record.
    Alex chose this knowing it.
- **D5. Set back like the setup screen's Last time** (Alex, 15:15Z: "я бы
  еще выделил как на стартовой странице - на темном фоне"). The panel runs
  the full height between header and footer on the app's panel colour
  (`bg-panel`), with a line on its left, as `Setup.tsx`'s Last time column
  does.

## The panel

- **P1. Where.**
  - Right of the overview, or of the player while a take is open, from the
    header down to the footer.
  - 26rem wide (416 px, the setup screen's column) in a window 1100 px or
    wider, 22.5rem (360 px) in a narrower one; the app's narrowest window
    is 960 px.
  - It scrolls on its own; the overview scrolls as it does now.
- **P2. What, top to bottom.**
  - The Next take field with its song pills, as in the footer now, the
    field on the card colour so it stands out on the panel.
  - The card (`rounded-xl border bg-card`, as Last time's): a heading,
    "Pałyn — before tonight", with the "N more" button at its right, then
    the goes.
- **P3. A go is a row as tonight's overview draws one:** ▶, a bar to scale
  with its notes ticked on it (a ★ go's in the star colour), the length,
  and the rehearsal's day ("22 Sep"). Its notes are listed under it.
- **P4. A card with nothing to play says why**, in one grey line:
  - no song in the field: "Name the next take after a song to see how it
    went before.";
  - a song played tonight and never before: "No goes at Ptuška before
    tonight. Tonight's are in the overview.";
  - any other song, a new one too: "No goes at Ptuška before tonight."
- **P5. While a take is open in the player the card is hidden**, and the
  field stays where it is. The app has one player, and a go from the card
  would put away the take open in it.
- **P6. A song picked anew** slides the card in, folds "N more" back, and
  stops a go of the old song that was playing. A refresh that leaves the
  song as it was does none of this.

## Playing

- **L1.** ▶, the row and its bar play the go in place, with no player on
  screen; a second press pauses it. Two rehearsals both have a take 2, and
  tonight has one too: only the one pressed lights up.
- **L2.** A note under a go plays it from 3 seconds before the note's spot,
  from its start for a note in the first 3 seconds.
- **L3.** Space pauses and plays it while it is in hand, and Escape puts it
  away, as with a take playing in the overview.
- **L4.** Record stops it before the take starts, and opening one of
  tonight's takes in the player puts it away.

## The recording screen

- **R1. "Took X last time" falls back to before tonight.** When tonight has
  no go at the song yet, `last_attempt` is the go the card shows first (D2),
  and the line names its day: "Took 3:05 on 28 Sep". With a go tonight it
  stays tonight's, "Took 2:21 last time", as now.

## Python

- **A1.** `Library.song_id(title)`: the id of the song with that title,
  compared casefolded as songs are, or None.
- **A2.** `session_state` gains `before_tonight`: `{"song", "first", "more"}`
  for the song the Next take field resolves to, or None when it has no go
  before tonight.
  - `song` is the song's title as the library has it; `first` is D2's go
    shown, `more` the goes "N more" adds, each in `_go_at`'s shape
    (`{folder, rehearsal, created_at, take}`).
  - The rehearsal in progress is left out, and so are rehearsals whose
    folder is not on disk: their goes cannot be played.
  - It comes with the rest of the state, so the card and the field never
    disagree, and an answer for an older song cannot land after a newer one.
- **A3.** `last_attempt` gains `created_at` when it comes from before
  tonight (R1).

## The site

- **S1.** reha.stream's story gets a step "Hear last week first.", second,
  after Set up (Alex, 15:17Z): "Name the next take after a song, and its
  best go from before sits right beside it." Its frame is the rehearsal
  screen with Pałyn picked under the field and its ★ go from last week
  playing in the card.
- **S2.** The hero shows the rehearsal screen as it is, so the panel shows
  there by itself.

## Testing

Tests come before the code, and each is seen failing first.

- **Python:**
  - the go shown: the newest ★ go, else the last go of the latest
    rehearsal;
  - "more": the last go of three rehearsals, less the one shown;
  - tonight left out, a rehearsal not on disk left out, a song played only
    tonight has none, "Take N" has none, a title typed in another case
    finds its song;
  - R1's fallback, and tonight's go taking over once there is one.
- **Playwright:**
  - the panel's place and width in the usual window and the narrowest, with
    the footer down to its buttons;
  - the card following a pill; P4's three lines;
  - "N more" keeping the first row where it was;
  - the card hidden while a take is open, with the field unmoved;
  - ▶ in place, a note from 3 s before, Space and Escape, Record stopping
    it first, a new song stopping it, and tonight's take 2 staying unlit;
  - the recording screen saying "Took 4:00 on 25 Aug" for the first go of
    the evening.
- **Site:** the story's seven steps, the new one second.

## Docs

- `docs/using-it.md`, the rehearsal screen and the recording screen, with
  its pictures of the rehearsal screen and the player taken again.
- `CHANGELOG.md`.

## Not part of this

- Opening History or a song's page during a rehearsal.
- Starring, renaming or opening an earlier go from the card: the song's page
  in History does that.
- Playing an earlier go while recording. Monitoring and playback through
  the same interface while a take records is a different problem.
