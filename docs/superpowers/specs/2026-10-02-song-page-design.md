# A song's page, and songs in History

History is organised by evening (`ui/src/screens/HistoryScreen.tsx`):
rehearsals down the left, the chosen one's overview beside it. That answers
"what did we do on Tuesday". It does not answer what people come looking for
most, which is a song: the good Vesna, the last Polyn before the arrangement
changed. To find one today you have to remember which evening it was, or
step through the evenings one by one — the case the comment at the top of
`HistoryScreen.tsx` names: *looking for the evening that had the good Vesna*.

This gives every song a page of its own — every go at it, from every
rehearsal — and makes it reachable from anywhere a song's name is shown. It
is #12, widened from "a Songs view in History" to "a song is something you
can open". It stands on
[songs in the store](2026-10-02-songs-in-the-store-design.md) and
[stars](2026-10-02-stars-design.md).

## What the app has

- **The rehearsal overview** (`RehearsalOverview.tsx`) draws a rehearsal
  song by song:
  - each go is a `TakeRow`: a bar to scale, its marks where they fell, its
    notes under it, ▶ to play it in place, a click to open it in the player;
  - Rename, the cloud and Delete show on the row under the mouse.
- **History's list** (`RehearsalList.tsx`) once spelled out each
  rehearsal's songs ("Polyn ×4 · Vesna ×3 · and 2 more"). They were
  replaced by the evening strip, which says the same at a glance.
- **A song's name is shown, and does nothing when clicked,** in four places:
  - the overview (`h3`);
  - Last time's rows;
  - its not-played rows;
  - the evening strip's tooltips.

## Decisions

- **D1. A song's page is one thing, reached many ways.** It is not a
  separate History mode with its own copy of the rows. History has a
  *Songs* view whose right side is the song's page, and every song name the
  app shows opens that view at that song.
- **D2. The songs are in alphabetical order**, compared case-blind in any
  script (the `Intl.Collator` the All songs panel uses). A known title is
  then always in the same place, and the list does not reshuffle after every
  rehearsal.
- **D3. A song's goes are grouped by rehearsal, the newest rehearsal
  first.** The newest goes are the ones most often wanted, and a rehearsal
  is how the band remembers them ("Tuesday's"). Within a rehearsal they are
  in the order played, as its overview has them.
- **D4. History's rehearsal list stays as it is.** The Songs view is what
  answers "which evenings had Vesna": its goes are grouped by rehearsal.
  Song chips back on the rehearsal list would only say it again.
- **D5. A rehearsal not on disk is shown, greyed** (decided 2026-10-06).
  Its folder may be on a drive that is not plugged in. Its goes are listed
  and counted, marked *Not found on disk*, with no ▶, and they do not open.
  Finding the folder again is done in the Rehearsals view, as now. A song
  with no goes left at all, every one deleted, is not listed: there is
  nothing to open.
- **D6. The song's goes are a ladder** (decided 2026-10-06, variant B of
  [the mockup](https://claude.ai/artifact/NnE5oTiWEPqMcX3L72HPYq)). Each
  rehearsal is one line until it is opened, so a song played for years
  stays one screen long, and how it changed in length shows down the
  ladder.

## History: Rehearsals | Songs

- **H1. A switch at the top of History's list:** *Rehearsals* | *Songs*.
  History opens on the view used last, after a restart too (decided
  2026-10-06). It is kept in the settings, `config.json`, as the theme is;
  missing, it is *Rehearsals*. Not in `localStorage`: the window forgets it
  when the app closes (pywebview runs in private mode unless told not to),
  and the interface's address has a new port on every launch.
- **H2. Songs view, left:** every song, D2's order, one row each:
  - the title, big;
  - small, under it: "7 goes · 4 rehearsals · last 28 Sep";
  - ★ and how many, when the song has ★ goes ("★ 2").

  ↑ and ↓ go through them, as they go through rehearsals.
- **H3. The last row is *Not named*,** as the rehearsal overview and Last
  time call those takes (decided 2026-10-06). Its page lists them by
  rehearsal, newest first, so they can still be found and given a song.
- **H4. Songs view, right:** the chosen song's page (below). The song chosen
  is kept when switching views and back, as the rehearsal chosen is.

## The song's page

- **P1. The head:**
  - the title;
  - "12 goes in 5 rehearsals · first 2 Aug · last 30 Sep";
  - a big ▶ that plays the newest ★ go, or the last go with none (as
    everywhere, per stars' D4).
- **P2. The ★ goes, first, on their own:** newest first, each row with ★,
  its rehearsal and date. Shown only when the song has any.
- **P3. Every go, as a ladder (D6):** a rung per rehearsal, D3's order.
  - A rung is one line: the rehearsal's day and name, its goes at this
    song as bars side by side in the order played, and how many.
    - The bars are drawn to one scale: the song's longest go. A go that ran
      long or stopped short across a month of rehearsals shows without
      reading a number.
    - A ★ go's bar is green, and each mark is a tick in its label's colour
      where it fell.
  - A click on a rung opens it, and a second click closes it. The newest
    rehearsal on disk is open when the page opens; the rungs opened stay
    open while History is.
  - An open rung lists its goes as the overview's `TakeRow`:
    - ▶ plays it in place;
    - a click opens it in the player;
    - a note opens it at its spot;
    - ★, Rename, the cloud and Delete work as they do in the overview.

    Under them, "Open Tuesday jam, Tue 22 Sep in Rehearsals" opens that
    rehearsal in the Rehearsals view.
  - A rung of a rehearsal not on disk is greyed and says so (D5). Opened,
    its rows have no ▶ and do not open.
- **P4. *From last time*,** under the head when there are any: every mark
  on the song's goes at its latest rehearsal on disk, in order, each in its
  label's colour with its comment, or its label's name when it has none. No
  label is picked out over another ([labels](2026-10-04-labels-design.md),
  D1). Each opens its take at the spot.
- **P5. Opening a go** opens it in the full-window player, with its
  rehearsal's take strip, as opening it from a rehearsal does. Escape comes
  back to this song's page, scrolled where it was. A rename, a crop or a
  delete done there shows on the page when it comes back.

## Opening a song from anywhere

- **O1. A song's title opens its page:**
  - the overview's song headings;
  - Last time's song rows;
  - the not-played rows.

  The song pills and the All songs panel under the name field do not: a
  click there names a take, and must keep doing only that.
- **O2.** Opened from the setup screen, History opens in its Songs view at
  that song, and Escape goes back to the setup screen. Opened from History's
  own Rehearsals view, it switches view and keeps the place in the other.
- **O3.** The rehearsal screen does not open History (a rehearsal in progress
  stays where it is); what it gets instead is
  [last time while rehearsing](2026-10-02-last-time-while-rehearsing-design.md).

## Python

- **A1.** `list_songs()`:
  - `{songs, not_named}`;
  - `songs` is every song with a go as `{id, title, goes, rehearsals,
    first_played, last_played, starred}`, rehearsals not on disk counted
    (D5);
  - `starred` is how many of its goes have ★;
  - `not_named` is `{takes, rehearsals, last_played}` for H3's row, or null
    when every take has a song;
  - one query, no files read.
- **A2.** `get_song(song_id)`:
  - `{ok, id, title, plays, goes: [{folder, rehearsal, created_at, missing,
    take}]}` in D3's order;
  - `take` is the same take dict the rehearsal overview gets, `starred`
    included; `missing` is the rehearsal's folder not being on disk (D5);
  - `plays` is what the head's ▶ plays (stars, D4), in the shape Last
    time's `plays` has: `{folder, rehearsal, created_at, take}`. Only
    rehearsals on disk count, and with none it is null.
- **A3.** `get_song(None)` is H3's takes with no song, in the same shape.
- **A5.** `get_settings()["history_view"]` and `save_history_view(view)`
  keep H1's view.
- **A4. Measure before deciding on paging.** Build a library of 300
  rehearsals × 20 takes and time A1 and A2. Paging is added only if A2 for
  the biggest song takes more than 100 ms.

## Testing

Tests come before the code, and each is seen failing first.

- **Python:**
  - A1 and A2 on a small library: counts, dates, order, the ★ count and
    what ▶ plays;
  - A3;
  - a rehearsal not on disk: counted, its goes `missing`, and passed over
    by ▶;
  - a song respelled shows under its new title;
  - A5, kept across a restart.
- **Playwright:**
  - the switch, and History opening on the view used last;
  - the songs alphabetical, Cyrillic and Latin mixed, case-blind;
  - ↑ and ↓ through the songs;
  - a song's ladder with goes from three rehearsals, newest first, the
    newest open;
  - a rung opened and closed;
  - ▶ on the head plays the newest ★ go;
  - a go opened in the player, and Escape back to the same song;
  - a rehearsal not on disk greyed, with no ▶;
  - a song title on the setup screen opening its page;
  - *Not named*.

## Docs

- `docs/using-it.md`: History's two views, and a song's page.
- `CHANGELOG.md`.
- The History screenshot in `tests/docs_screenshots.py` gains the Songs
  view.

## Not part of this

- Moving between a song's goes without leaving the player:
  [goes in the player](2026-10-02-goes-in-the-player-design.md).
- Renaming and merging songs from their page:
  [rename and merge songs](2026-10-02-rename-and-merge-songs-design.md).
- Search by typing. The Songs view is browsed, not searched.
