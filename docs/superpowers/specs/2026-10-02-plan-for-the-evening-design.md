# A plan for the evening: songs picked on the setup screen, ticked off as they are played

A rehearsal usually starts with "what are we doing tonight?", answered from
memory.

- **The setup screen already shows what to answer it with.** *Last time* is
  the last rehearsal song by song, and *Not played last time* the songs that
  were left out (`LastTime.tsx`).
- **None of it can be picked.** A song's name does nothing when clicked.
- **Once the rehearsal starts, the song pills say only what has been
  played** (tonight's songs first, then the rest, `song_choices` in
  `src/rehearsal_recorder/api.py`), not what was meant to be.

This lets the band pick tonight's songs on the setup screen, with clicks.
The plan then leads the pills under the name field during the rehearsal,
the next song lit, each ticked off once played. It stands on
[songs in the store](2026-10-02-songs-in-the-store-design.md).

## Decisions

- **D1. A plan is a list of songs in an order, nothing more.** No times, no
  setlist durations, no notes. It answers "what next" with one click on the
  rehearsal screen.
- **D2. Picked by clicking, never typed.** A song is added from Last time's
  rows, from the not-played rows, and from an *All songs…* list on the
  setup screen, the same panel the name field has.
- **D3. Nothing under the pointer moves.** As with the pills today (#10), a
  song ticked off stays where it is. The next one is lit; the order does not
  change under a click.
- **D4. Optional.** No plan, and everything works as today.

## On the setup screen

- **P1. A *Tonight* card over *Last time*,** with the songs picked so far, in
  the order picked.
  - Each song has ✕ to take it out.
  - A song can be dragged to another place in the list; this is the one
    drag in the feature, and the order is right without it for most
    evenings.
  - Empty, the card says "Click songs below to plan tonight", with *All
    songs…* to pick from the whole repertoire.
- **P2. Last time's and the not-played rows each get a + button,** "Add
  Polyn to tonight". It becomes a ✓ once the song is in the plan. A click
  on the ✓ takes the song out.
- **P3. The plan is kept until the rehearsal starts, or until it is
  cleared,** across restarts of the app (in `config.json`, as `next_plan`).
  Starting the rehearsal moves it into the rehearsal.

## During the rehearsal

- **R1. The plan's songs lead the pills under the name field**
  (`SongPills.tsx`), in plan order:
  - each as its next go tonight ("Polyn 2" once Polyn has been played);
  - the first one not yet played is lit as *next*;
  - played ones carry a small ✓.

  After them come tonight's other songs, then the rest, as now.
- **R2. The next take's default name stays as today:** the previous take's
  song, its next go. The band plays a song several times in a row, and a
  default that jumped to the plan's next song after every go would be wrong
  more often than right. The plan's next song is one click away, lit, under
  the field. Only the evening's first take defaults to the plan's first
  song.
- **R3. A song played that was not in the plan** is not added to it. It
  shows among tonight's other songs, as today.

## After the rehearsal

- **H1. History's overview of a rehearsal with a plan** says what was
  planned and not played, under the songs: "Planned, not played: Zima,
  Ogon". Each opens its song's page.

## Schema (migration 0004)

| Table | Change |
|---|---|
| `rehearsal` | `plan` JSON, nullable: song ids in order. |

## Python

- **Y1.** `start_rehearsal(…, plan=None)` stores the plan with the
  rehearsal.
- **Y2.** `song_choices` returns `planned`:
  - `[{song, name, played: bool}]` in plan order, ahead of `here`;
  - a song is in `planned` or in `here`, not both;
  - `next` is the first planned song not played.
- **Y3.** `get_rehearsal` returns `planned_not_played` for the overview's
  line (H1).
- **Y4.** `save_next_plan(song_ids)` and `get_settings()["next_plan"]` for
  P3.

## Testing

Tests come before the code, and each is seen failing first.

- **Playwright:**
  - + on a Last time row adds to *Tonight* and turns into ✓;
  - ✕ and ✓ take a song out;
  - drag to reorder;
  - the plan survives a reload before the rehearsal starts;
  - on the rehearsal screen, the plan's songs lead the pills with the next
    lit;
  - after recording a planned song, it carries ✓ and stays in place, and
    the next one is lit;
  - a song outside the plan does not join it;
  - History saying what was planned and not played.
- **Python:**
  - Y1;
  - Y2's order and the `next` song;
  - Y3;
  - migration 0004.

## Docs

- `docs/using-it.md`: the setup screen and the rehearsal screen.
- `CHANGELOG.md`.

## Not part of this

- Setlists for gigs, with lengths and order to play: the "best of" list was
  turned down, and a gig setlist is the same thing.
- Statuses per song (learning, ready).
