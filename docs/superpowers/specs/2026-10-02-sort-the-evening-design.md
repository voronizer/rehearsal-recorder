# Sort the evening: the finished screen as the place to star the good goes

The moment a rehearsal finishes is the moment the band best remembers which
goes were the good ones. The app lets that moment pass.

- **The finished screen is a take count and a folder path**
  (`ui/src/screens/Finished.tsx`), with New rehearsal and History under it.
- **Nothing prompts anything there:**
  - no picking the good goes;
  - no naming the "Take 4"s nobody named;
  - no sending the good ones to the band.

  All of that is left for later, in History, one rehearsal at a time, and
  mostly it never happens.
- **The goes nobody will want stay on disk forever,** at the size of a
  multitrack recording.

This makes the finished screen the place to sort the evening, while it is
fresh. Nothing on it is required: New rehearsal and History stay where they
are. It stands on
[songs in the store](2026-10-02-songs-in-the-store-design.md) and
[stars](2026-10-02-stars-design.md).

## Decisions

- **D1. It is the rehearsal overview, plus what only makes sense right
  after.** The rows, ▶, ★ and the notes are the overview's own
  (`RehearsalOverview.tsx`), so nothing new has to be learned. What is added
  here is naming the unnamed takes, and two actions over the whole evening.
- **D2. Optional, always.** Space still starts a new rehearsal, and leaving
  the screen loses nothing: everything done on it is saved as it is done.
- **D3. Clearing out goes to the Trash, and says how much.** The goes nobody
  will want are deleted together, as delete does today: to the Trash, with
  their cloud copies, and with the question before it saying so
  (`ui/src/lib/deletion.ts`).

## The screen

- **S1. The head:** "Rehearsal finished", and under it the overview's
  figures: time played, takes, songs.
- **S2. The evening, as the overview draws it,** with ★ on every row
  (stars, P1). ▶ plays a go in place. A click on a row opens it in
  History, at this rehearsal, with the take open in the player.
- **S3. *Not named*, with the song pills under each take.**
  - The row is the overview's, and under it the pills that the name field
    offers: tonight's songs, then the rest, then All songs…, each with the
    go it would be.
  - A click names the take after that song: the take becomes its next go
    (songs in the store, N4), and moves into that song's group.
  - Typing is not offered here. A title nobody has played yet is given in
    the Rename dialog, as anywhere else.
- **S4. Two actions over the evening, under it:**
  - **Send starred.** Sends tonight's ★ takes the way the app sends takes:
    the cloud folder today, the band's chat once that step lands. Disabled,
    with the reason in a tooltip, when nothing tonight has ★ or there is
    nowhere to send. A take already sent is not sent again.
  - **Clear out the rest…** Asks first: "Move 9 other goes of Polyn, Vesna
    and Ogon to the Trash? 3.2 GB." That covers tonight's goes without ★ of
    every song with a ★ go tonight. Songs with no ★ tonight, and takes with
    no song, are left alone, starred or not. Disabled when there is nothing
    to clear.
- **S5. The footer is as it is now:** History, and New rehearsal with Space.

## Python

- **A1.** `delete_takes(folder, take_numbers)` deletes several takes as one
  piece of background work, with the cloud copies, as `delete_take` does
  for one. It returns the ones it could not delete, and why.
- **A2.** `send_takes(folder, take_numbers)` sends several takes by the same
  route as sending one by hand, and skips the ones already sent.
- **A3.** `get_rehearsal` already returns what the overview needs. The
  pills come from `song_choices(folder, take_number)`, as in the Rename
  dialog.

## Testing

Tests come before the code, and each is seen failing first.

- **Playwright:**
  - the finished screen draws the evening;
  - ★ on a row;
  - a pill under an unnamed take names it and moves it into its song;
  - *Send starred* sends only ★ takes, and is disabled with none;
  - *Clear out the rest* asks first, with the count and size, deletes only
    tonight's goes without ★ of songs with a ★ tonight, and leaves unnamed
    takes;
  - Space still starts a new rehearsal;
  - a row opening History at this take.
- **Python:**
  - A1 with one take that cannot be deleted;
  - A2 skipping a take already sent.

## Docs

- `docs/using-it.md`: finishing a rehearsal.
- `CHANGELOG.md`.

## Not part of this

- Doing the same from History later: History's overview has ★ and delete
  per row already. The two evening-wide actions can move there if they are
  missed.
