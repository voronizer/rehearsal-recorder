# A lighter right panel in the band service

The band service opens a take, a mark, a song and three editors in one
panel from the right. On 8 November 2026 Alex asked whether that panel
is needed at all. Measured on the pictures' band, it covers 47 % of the
page in a 1180 px window and 61 % in a 960 px one: on **Home** the right
column (**Latest marks**, **The band's favourites**) disappears, on
**Songs** the columns from **Takes** to **Best take** do, and on a take's
page the panel of a mark hides the second half of the lanes, often the
very place the mark is about. A song's panel holds what its page holds
but **All takes**, and on a phone the panel fills the screen, so it is a
second page with fewer things on it.

This change keeps the panel for a take opened from a list, and gives a take's page a drawer for its marks that folds into a
strip instead of going away.

Mockups Alex picked from (the service's own pages on answers recorded
from a local Worker; source in
/mnt/project-files/band-service/right-panel/q1-mock/):

- the panel as now and variant A: https://claude.ai/artifact/B2Ricv3FdpiQ3V1NiQJPkw
- the drawer on a take's page: https://claude.ai/artifact/3dTf1YEMUtzybiT4UFycS8

## Alex's picks

All on 8 November 2026 (UTC).

- 13:40 He asked whether the sliding panel is justified or too much.
  Claude's answer (13:47) gave the measurements and three ways: A, the
  panel only for a take and a mark; Б, the panel pushes the page aside;
  В, no panel.
- 13:58 «делаем вариант А»: a song opens its own page; **New song**,
  **Statuses** and **Labels** open on their own pages; on a phone a take
  opens its page.
- 14:05 Asked whether a mark's panel on a take's page should push the
  lanes aside in a wide window, he answered instead: «давай сделаем чтобы
  она не полностью убиралась, а чтобы можно было шторку развернуть. мы
  тогда кроме меток еще для чего нибудь сможем ее использовать потом».
  The push question was withdrawn.
- 14:11 The drawer lives on a take's page (card «На странице дубля»).
  In lists a take still opens in the panel and closes, as in A.
- 14:14 Folded, the drawer is a strip with icons (card «Полоска со
  значками»), so later sections get an icon each.
- 14:15 reha.stream: only the picture of a take's page is taken again
  (card «Только картинку»). No text changes.

## What the band sees

### On a computer, in lists and on Home

- A take's name opens the take's panel, as now: its player, **Tracks**,
  **Marks**, and its name opens the take's page. ✕, Esc and Back close it.
- A song's name opens the song's page: on **Home**, in a **Songs** row,
  in a take's panel, and **Notes and files** on a rehearsal's page. The
  song's panel is gone.
- **Songs**: **Statuses** and **New song** open their editor at the top
  of the page, above the table, in a card. The button pressed again, the
  card's ✕ or **Cancel** closes it. After **Add song** the new song's page
  opens.
- **Marks**: **Labels** opens the labels' editor the same way, at the
  top of the page.
- **Edit statuses** at the bottom of a song's status menu goes to
  **Songs** with **Statuses** open.
- An open editor is in the page's address, as the panel is: Back closes
  it, and a reload keeps it open.

### On a computer, on a take's page

- Along the right edge runs a strip 48 px wide, the whole height, in the
  grey of the column of sections on the left. At its top is the sign that
  opens the drawer. Under it is a diamond, the sign **Marks** has in the
  left column, with how many marks the take has.
- Either sign opens the drawer: 28 rem wide, over the lanes, as the panel
  opens now. At its top is the sign that folds it back into the strip.
  Inside are the take's marks as the take's panel lists them: **Marks**,
  **Add a mark at …**, and each mark with its talk.
- A mark's chip in the player, **Open mark**, or a new mark set in the
  player opens the drawer on that mark. A mark opened from the drawer's
  list has **Back** to the list.
- The page opens with the drawer folded. A link from the band's chat to a
  mark opens it on that mark, as the panel does now.
- The fold sign, Esc and Back fold the drawer. The strip stays.
- The drawer is in the page's address, as the panel is.

### On a phone

- A take's name opens the take's page; there is no take's panel on a
  phone. The page already has the take's wave, its tracks and its marks.
- **Mark** in the bottom bar opens a new mark at the player's moment, in
  the full-screen panel a mark has now.
- No strip: a take's page keeps its marks under the player.
- Songs, **New song**, **Statuses** and **Labels** work as on a computer.

## How it is built

Service only; РЭХА does not change.

- `shell/panel.tsx`: the panel's kinds are `take`, `mark` and a new
  `marks` (a take's list, `?panel=marks:<uid>`). `song`, `labels`,
  `statuses` and `new-song` go; an old address with one of them opens the
  page with no panel. On a phone `open` sends a take to its page, and a
  take with a moment (**Mark** in the bar) to a new mark at that moment.
- `shell/Shell.tsx`: on a computer, a take's page (`/takes/$uid`) shows
  the new drawer in place of the panel. Folded, the strip stands in the
  row beside the page; open, the drawer lies over the page, the strip
  under it. Everywhere else the panel stays as it is.
- The drawer (a new file in `shell/`) shows the take's list for `marks`,
  and for `mark` the mark, as the panel does now. A take's panel asked for
  on that take's own page (its name on a mark) shows the list instead, so
  the page is not drawn twice. Inside the drawer a panel's ✕ is the fold
  sign, so there is one way to fold it.
- `songs/`: `SongPanel` goes, with the panel's size of `InPlaceTitle`.
  **Home**, **Songs**, a rehearsal's page and a take's panel link to
  `/songs/$id`. The **Songs** route takes `?edit=statuses` or
  `?edit=new-song` and shows `StatusesPanel` or `NewSongPanel` in a card
  at the top; the status menu's **Edit statuses** goes to
  `/songs?edit=statuses`.
- `marks/`: the **Marks** route takes `?edit=labels` and shows
  `LabelsPanel` the same way.
- `PanelHead` and the editors' **Cancel** close the editor where it is,
  as they close the panel now.
- `takes/move.tsx`: **New song…** from a take's line on a phone opens the
  take's page, where the song's name is typed, as it does in the panel on
  a computer.
- `docs/design-system.md`: the strip on a take's page joins the band
  service's one exception (white panel in the light theme) as a second.

## Words

- No new words on screen. The strip's signs have tips and names for
  screen readers: “Open the panel”, “Fold the panel”, and “Marks: 3” on
  the diamond.
- CHANGELOG under Unreleased, an item for the band service: a song opens
  its page; **New song**, **Statuses** and **Labels** open where they are;
  on a take's page the marks sit in a strip on the right that opens and
  folds; on a phone a take opens its page.
- reha.stream: the picture with **Download** on a take's page
  (`downloads`, taken on a computer) is taken again, since the strip now
  shows on it. The other pictures are taken on a phone and do not change.
  Alex sees the picture before the merge.

## Tests

Playwright (service/e2e), changed where they open a song's panel or an
editor:

- `songs.spec.ts`: a song's row opens its page; status, key, notes and a
  file are set there; **Statuses** and **New song** open at the top of
  **Songs**, and **Add song** opens the new song's page.
- `marks.spec.ts`: **Labels** opens at the top of **Marks**, and a reload
  keeps it.
- `home.spec.ts`, `rehearsals.spec.ts`: a song's name and **Notes and
  files** open the song's page.
- `frame.spec.ts`: the panel's ✕, Esc and another section still close a
  take's panel; the Esc-in-a-list test moves to a take's panel.
- `takes.spec.ts`: on a take's page the strip shows the count, opens and
  folds the drawer; a chip opens the drawer on its mark; a chat link with
  a mark opens it there; Back folds it.
- A phone test: a take's name opens its page, and **Mark** in the bar
  opens a new mark.

While developing, only the tests a change touches run, once each; the full
suites run once, on CI.

## Calls Claude made

1. An editor in place is the panel's own editor in a card at the top of
   its page, as in the A mockup.
2. An open editor is kept in the address, so Back closes it.
3. **Edit statuses** on a song's page goes to **Songs** with **Statuses**
   open.
4. On a phone **Mark** in the bar opens a new mark in the full-screen
   panel, and **New song…** from a line opens the take's page.
5. The open drawer lies over the lanes, 28 rem, as the panel does now.
6. A take's page opens with the drawer folded.
7. The diamond counts all the take's marks, done ones too, as **Marks**
   in the take's panel does.
8. Inside the drawer a panel's ✕ is the fold sign.
9. A take's panel asked for on its own page shows the list of marks.
10. An old address with a song's, labels', statuses' or new song's panel
    opens the page without it.
11. The strip shows in a small window too (500 to 1099 px wide), not on
    a phone.

## Not in this

- Other sections in the strip: each will be its own question.
- Pushing the lanes aside.
- How a take's number looks after its name (its own thread).
