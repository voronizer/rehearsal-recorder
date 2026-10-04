# Last time while rehearsing: earlier goes at the next song, on the rehearsal screen

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

This puts the song's earlier goes on the rehearsal screen, for the song the
next take is named for, and lets the recording screen's bar use them. It
stands on [songs in the store](2026-10-02-songs-in-the-store-design.md) and
[stars](2026-10-02-stars-design.md).

## Decisions

- **D1. It follows the Next take field.** The panel is about the song the
  next take is named for, the one the band is about to play. Pick another
  song under the field and the panel changes with it. A take named "Take N"
  has no panel.
- **D2. A few goes, not the song's whole history.** Its newest ★ go, and
  the last go at each of the song's last three rehearsals before tonight,
  deduplicated when the ★ go is among them. The panel is a glance before
  playing, and the full list is on the song's page.
- **D3. It plays in place, without leaving the rehearsal.** ▶ plays a go
  right in the panel, as Last time does on the setup screen; nothing opens.
  Recording puts it away.

## The panel

- **L1. Over tonight's overview, a card titled with the song:** "Polyn —
  before tonight".
  - It is shown while the Next take field names a song with goes in earlier
    rehearsals, and not while a take is open in the player.
  - Each go is a row:
    - ▶;
    - the go's name, and ★ when it has one;
    - the rehearsal's date ("28 Sep");
    - its length;
    - a bar to scale.
- **L2. Its notes under each row**, as the overview draws them. A click
  plays the go from 3 seconds before the note's spot.
- **L3. Playing.**
  - ▶ plays the go in place, with no player on screen
    (`useTakeStripPlayer` with `byFiles`, as `LastTime` does).
  - Space pauses it while it is in hand, and Escape puts it away, as with a
    take playing in the overview.
  - Record stops it before the take starts.
- **L4. Nothing when there is nothing.**
  - A song with no earlier goes shows no card, and its first take at
    tonight's rehearsal simply has none.
  - A song played only tonight shows none either: tonight's goes are in the
    overview under it already.

## The recording screen

- **R1. "Took X last time" falls back to earlier rehearsals.** When
  tonight has no go at the song yet, `last_attempt` is the song's newest ★
  go, or the last go of the song's latest earlier rehearsal. The line then names the day:
  "Took 3:05 on 28 Sep". With a go tonight it stays tonight's, "Took 2:21
  last time", as now.

## Python

- **A1.** `earlier_goes(song_id, limit_rehearsals=3)`:
  - D2's takes as `[{folder, rehearsal, created_at, take}]`, newest first,
    each `take` with its `starred`;
  - the rehearsal in progress is left out.
- **A2.** `session_state`'s `last_attempt` gains `created_at`, set when the
  go came from an earlier rehearsal (R1).
- **A3.** `session_state` gains `next_song_id`, the song the Next take field
  resolves to, or null. The panel asks A1 for it whenever it changes.

## Testing

Tests come before the code, and each is seen failing first.

- **Python:**
  - A1's choice of goes: the newest ★ go, the last go of each of three
    rehearsals, the duplicate dropped;
  - tonight left out;
  - R1's fallback, and tonight's go taking over once there is one.
- **Playwright:**
  - the card follows the field when a pill is clicked;
  - no card for "Take N", for a new song, or for a song played only tonight;
  - ▶ plays in place, and Record stops it first;
  - a note plays from 3 s before its spot;
  - the recording screen saying "Took 3:05 on 28 Sep" for the first go of
    the evening.

## Docs

- `docs/using-it.md`, the rehearsal screen and the recording screen.
- `CHANGELOG.md`.

## Not part of this

- Opening History or a song's page during a rehearsal.
- Playing an earlier go while recording. Monitoring and playback through
  the same interface while a take records is a different problem.
