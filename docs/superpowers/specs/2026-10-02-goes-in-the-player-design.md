# Goes in the player: a tab per song, and from go to go at the same spot

Comparing two goes at a song is the most common thing done with them after
a rehearsal: *was the chorus tighter in the second or the fourth?* The
player makes it slow.

- **Switching takes starts from zero.** Opening a take resets its position,
  its loop region and its zoom: the effect at "Opening a take" in
  `ui/src/hooks/useMultitrackPlayer.ts` sets the position to 0, the region
  to none and the view to none.
- **Comparing the chorus of Pałyn 2 and Pałyn 4 is therefore manual.** Find
  the chorus, drag the loop over it, click the other pill, then find the
  chorus and drag the loop again.
- **There is no "next go at this song".** The take strip
  (`TakeStrip.tsx`) lists the rehearsal's takes in the order played, a pill
  each. The goes at one song may be far apart in it, between goes at other
  songs.

This turns the strip into a tab per song, lets a song's goes be gone
through with the place kept, and puts what is known about the evening in
the window's header. It stands on
[songs in the store](2026-10-02-songs-in-the-store-design.md) and
[a song's page](2026-10-02-song-page-design.md).

Everything below was settled with Alex on 2026-10-06, on the mockup at
https://claude.ai/artifact/9bKQrsbKWb9gjUy53WqC8e (version 11). Where a
point was Claude's own call, it says so.

## Decisions

- **D1. "The goes" of a song are the ones the player was opened among.**
  - Opened from a rehearsal (the rehearsal screen, or History's Rehearsals
    view), they are that rehearsal's goes at the song, in the order played.
  - Opened from a song's page, the goes at that song are every go at it,
    **by time**: the oldest rehearsal first, the order played within one
    (Alex, 21:44Z). Goes from a rehearsal whose folder is not on disk are
    left out: they cannot be opened.
  - Another song picked on the strip, from there, has that evening's goes,
    as from a rehearsal (Claude's call).
- **D2. The place is kept as seconds from the start.**
  - What is kept: the position, the loop region, Repeat on or off, and the
    zoom; and the go plays on if the last one was playing.
  - Values past the end of a shorter go are clamped to its length. A region
    that is left shorter than half a second is dropped, and Repeat with it.
    The zoom keeps its span, and moves back inside a shorter go.
  - Goes do not line up exactly: a slower count-in shifts everything. But
    "about a minute in" is close enough to find the chorus by ear, and lining
    them up by the audio is not worth what it would cost.
- **D3. Only another go at the same song keeps the place.**
  - A go picked in the open song's column, and ↑ or ↓, keep it.
  - A click on another song's tab opens that song's **last go played that
    evening**, from the start (Alex, 22:31Z). A go picked in another song's
    column opens from the start too: it is another song.

## The strip

- **S1. One tab per song, in the order the songs were first played that
  evening** (Alex, 22:27Z). Each take with no song is a tab of its own,
  "Take 11" (Alex, 22:32Z).
- **S2. The tabs are large, in two lines, and the names easy to read**
  (Alex, 22:19Z and 22:26Z): the name at 16 px in the text colour, and
  under it, small:
  - on the open tab, the open go's number, then its length, ★ and the
    colours of its marks, and its cloud status if it has one ("Copying to
    the cloud", "Not in the cloud"). A take with no song has no number;
  - on another tab, how many goes it has ("3 goes"), and ★ when one of them
    is starred. A take with no song shows its length instead.
- **S3. The tabs open down into columns** (Alex, 22:39Z). "Songs ▾" at the
  start of the strip, or the open go's number, opens them; ▴ on either
  closes them. Each tab gets a column of its goes, a row each: the go's
  number, its length, ★ and its marks. The open go's row is picked out.
  When the open song's goes come from several rehearsals (D1, from a
  song's page), its column is grouped under each rehearsal's day ("Tue 22
  Sep"). A song with one go and a take with no song have a column of one
  row.
- **S4. The columns are closed each time a take is opened from outside the
  player** (Claude's call). They stay open while goes are gone through, and
  until closed: ▴, or Esc, which closes them before it closes the take.
- **S5. No ◀ ▶ buttons** (Alex, 22:39Z: «тогда и ◀ ▶ не нужны»).
- **S6. ↑ is the previous go at the open song, ↓ the next,** in D1's order,
  keeping the place (Claude's call, told to Alex at 22:45Z). They do
  nothing at either end, and nothing on a take with no song. In History, ↑
  and ↓ move the list only while no take is open, so they are free. The
  player's keys list (`PlayerKeys.tsx`) gains the row.
- **S7. The tools stay where they are,** right of the strip: ★, rename, the
  cloud and delete, acting on the open go (Alex asked, 22:50Z).
- **S8. The strip does not wrap.** Tabs that do not fit scroll sideways, and
  the open tab is scrolled into view, as the pills were.

## The header

- **H1. The line with the folder's path above the strip goes** (Alex,
  22:21Z).
- **H2. The window's header says what there is to know about the evening**
  (Alex, 22:42Z): the date and time above the rehearsal's name, as now, and
  on the right, each as a small label over its value:
  - **Length**, "45 min";
  - **Takes**, "11, 4 songs";
  - **In the cloud**, "2 of 11";
  - **On disk**, "1.6 GB";
  - and a button that opens the rehearsal's folder: "Show in Finder" on a
    Mac, "Show in Explorer" on Windows, "Open folder" elsewhere. The path
    itself is not shown (Alex, 22:47Z).
- **H3. The rehearsal screen gets the same header,** in place of its "11
  takes" badge and its folder line (Claude's call, 22:55Z, when Alex said
  not to wait for him). The numbers follow each take kept or deleted.
- **H4. In a narrow window** (the app opens down to 960 px wide), In the
  cloud and On disk are left out below 1280 px; Length, Takes and the
  button stay (Claude's call).

## On reha.stream

- **W1. A sixth step in the scrolling story, "Compare goes"** (Alex,
  22:54Z), after "Find a song". The app beside it opens a go at Pałyn from
  its page, opens the tabs into columns, and goes to another go at Pałyn
  with the loop over the same bars.
- **W2. The hero changes by itself:** it is the rehearsal screen, so the tabs
  and the header are there with the release. `site/src/stage/Hero.tsx`
  opens Pałyn 2 from the overview, which stays as it is.
- "What's new" follows `CHANGELOG.md`, as always.

## Implementation notes

- **Python, `show_rehearsal_folder(folder)`:** opens the folder of a
  rehearsal the library knows, and only that, with the system's own opener.
  The command is a list of arguments, never a shell line: a rehearsal's
  name is typed by a person. `open_in_file_manager` in `platform_support.py`
  is made to work that way and used.
- **Python, `session_state`** gains `disk_bytes`, measured as History
  measures a rehearsal (`_folder_bytes`). It is read when the screen asks,
  not polled.
- **`useMultitrackPlayer` gains `restore(spot)`**, applying a kept place to
  the take just opened, clamped to its length (D2).
- **`useTakeStripPlayer` gains `move(take)`**, which opens another go with
  the place kept, and holds whether the columns are open.
- **The tabs are worked out in `ui/src/lib/songTabs.ts`**, from the
  evening's takes: pure functions, unit tested.
- **History hands the strip the song's goes from its page** (D1), and opens
  a go of another rehearsal the way a go is opened from the page today,
  with the place kept.

## Testing

Tests come before the code, and each is seen failing first.

- **Unit (Vitest):** the tabs (order of first play, one per song, a tab per
  take with no song, the last go played); a song's goes by time across
  rehearsals, without those not on disk; the previous and next go.
- **Python (pytest):** `show_rehearsal_folder` opens a known rehearsal's
  folder and refuses any other; the opener is called with a list;
  `session_state` has `disk_bytes`.
- **Playwright, with the fake bridge:**
  - the tabs and their two lines; a click on another song's tab opens its
    last go from the start;
  - the columns open and close from "Songs" and from the number, close on
    Esc before the take does, and are closed again when a take is opened
    from the overview;
  - a go picked in the open song's column, and ↑ and ↓, keep the position,
    the region, Repeat, the zoom and playing, clamped to a shorter go;
    `player_seek` comes before `player_play`;
  - a go in another song's column starts from zero;
  - from a song's page, the column has every go by time with their days,
    and ↓ goes on into another rehearsal, whose tabs the strip then shows;
  - the header's facts and the button, in History and on the rehearsal
    screen;
  - reha.stream: the story's sixth step.

## Docs

- `docs/using-it.md`: the rehearsal screen, Listening back, Keyboard.
- `docs/screenshots/rehearsal.png`, `player.png` and `zoom.png` taken again.
- `CHANGELOG.md`.

## Not part of this

- Lining goes up by their audio, or by a marker set on each.
- Keeping mutes and solos from one go to the next.
- The evening's takes in the order played: the tabs group them by song, and
  Alex accepted that the order is no longer on the strip (22:27Z). The
  rehearsal overview and History's list still show it.
- Notes about an evening: there is nowhere to keep them yet.
