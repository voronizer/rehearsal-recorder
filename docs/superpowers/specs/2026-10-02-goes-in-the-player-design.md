# Goes in the player: from one go at a song to the next, at the same spot

Comparing two goes at a song is the most common thing done with them after
a rehearsal: *was the chorus tighter in the second or the fourth?* The
player makes it slow.

- **Switching takes starts from zero.** Opening a take resets its position,
  its loop region and its zoom: the effect at "Opening a take" in
  `ui/src/hooks/useMultitrackPlayer.ts` sets the position to 0, the region
  to none and the view to none.
- **Comparing the chorus of Polyn 2 and Polyn 4 is therefore manual.** Find
  the chorus, drag the loop over it, click the other pill, then find the
  chorus and drag the loop again.
- **There is no "next go at this song".** The take strip
  (`TakeStrip.tsx`) lists the rehearsal's takes in the order played. The
  goes at one song may be far apart in it, between goes at other songs.

This adds previous/next go at the same song to the player, and keeps the
place when moving between them. It stands on
[songs in the store](2026-10-02-songs-in-the-store-design.md).

## Decisions

- **D1. "The goes" are the ones the player was opened among.**
  - Opened from a rehearsal (the rehearsal screen, or History's Rehearsals
    view), they are that rehearsal's goes at the song, in the order played.
  - Opened from a song's page, they are every go at the song, in the page's
    order.

  The player moves through what the person was just looking at.
- **D2. The place is kept as seconds from the start.**
  - What is kept: the position, the loop region and the zoom; and the go
    plays on if the last one was playing.
  - Values past the end of a shorter go are clamped to its length.
  - Goes do not line up exactly: a slower count-in shifts everything. But
    "about a minute in" is close enough to find the chorus by ear, and lining
    them up by the audio is not worth what it would cost.
- **D3. Only these buttons and keys keep the place.** A pill clicked in
  the strip opens its take from the start, as now: it may be another song
  entirely.

## The player

- **G1. Beside the take's name in the player,** for a take with a song and
  more than one go among D1's goes:
  - "◀ Polyn 2" and "Polyn 4 ▶", naming the go each one opens;
  - a button is disabled at either end;
  - nothing is shown for a take with no song, or a song with one go.

  Opened from a song's page, each label adds the go's date: "◀ Polyn 2 ·
  23 Sep".
- **G2. Keys: ↑ is the previous go, ↓ the next.**
  - They work while the player is open; in History, ↑ and ↓ today move the
    list only while no take is open, so they are free.
  - The player's keys list (`PlayerKeys.tsx`) gains the row.
- **G3. Moving to another go keeps D2's place.**
  - If the go was playing, it plays on from the same second.
  - The loop region and the zoom are the same seconds, clamped.
  - A loop on keeps looping over the same span of the new go.
- **G4. The take strip stays in the order played.** The pill of the go
  moved to is selected and scrolled into view, as a click on it would do.

## Implementation notes

- **`useMultitrackPlayer` takes an optional carry** — `{position, region,
  view, playing}` — applied once the new take has opened, instead of the
  reset. Without one it resets as now. `useTakeStripPlayer` passes it for
  G1 and G2 and nowhere else.
- **D1's list is passed in by the screen** as an ordered list of takes; the
  player does not work it out. The rehearsal screen and History's
  Rehearsals view build it from `songs[].take_numbers` (spelled from
  `song_id` since songs in the store). A song's page has it already.

## Testing

Tests come before the code, and each is seen failing first.

- **Playwright, with the fake bridge:**
  - ◀ and ▶ and their labels;
  - disabled at the ends;
  - absent on a take with no song and on a song with one go;
  - ↑ and ↓;
  - the position, region and zoom carried, and clamped to a shorter go;
  - playing carried: `player_seek` is called with the kept second before
    `player_play`;
  - a pill clicked still starting from zero;
  - from a song's page, moving across rehearsals.

## Docs

- `docs/using-it.md`, the player section.
- `CHANGELOG.md`.

## Not part of this

- Lining goes up by their audio, or by a marker set on each.
- Grouping the take strip by song.
