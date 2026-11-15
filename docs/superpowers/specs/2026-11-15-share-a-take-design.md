# A link to a take for someone outside the band

On 15 November 2026, 22:16 UTC, Alex asked: «давай сделаем чтобы можно было
шарить дубли внешним пользователям». Issue #106 holds the idea since
24 October: a link to one take that opens without signing in.

A band member makes a link to one take in the band service and sends it to
someone outside the band: a sound engineer, a player who might join, a
friend. The person opens it in a browser and listens without signing in.
The member chooses, for each link, what it shows, what it lets them download
and how long it lasts. Every member sees all the band's links on **Members
and links** and can close any of them.

РЭХА does not change.

What Claude found (main at 411eadd):

1. A take's files reach only a signed-in member: `/files/{uid}/{gen}/{name}`
   is behind `needMember` (`service/worker/files/routes.ts:22`). The only
   routes open without signing in are the band's name and picture
   (`service/worker/band/routes.ts:37`, `:136`), the sign-in routes
   (`service/worker/index.ts`, `AUTH_PATHS`) and the API's description
   (`/api/openapi.json`, `index.ts:112`). The security review of
   6 November found no other open route.
2. There is no mix file in the service. The take's mix exists only in the
   member's browser: **Download** › **The mix** fetches every track's MP3,
   mixes them as the member hears them and encodes an MP3 at LAME's best
   variable bit rate (`service/src/takes/Download.tsx:123`,
   `service/src/takes/player/mix.ts:129`, `:155`). For six 5-minute tracks
   that took about 14 seconds on 4 November and gives about 9 MB.
3. РЭХА sends each track as an MP3 of about 128 kbit/s mono, with FLAC and
   peaks, per generation. A crop makes a new generation and deletes the
   files of the older ones (`service/worker/takes/store.ts:199`).
4. A member's levels are kept per track name across all takes
   (`service/worker/levels/routes.ts:29`); a level is the member's own, else
   РЭХА's balance, else 1. The **Download** mix uses the levels, M and S the
   member hears, not Master (`mix.ts:4-13`), and the take's amount
   (`takes/gain.ts`).
5. The pages use plain paths (`/takes/…`, `/members`,
   `service/src/routes.tsx:68`). A path that is no file gets the page's
   `index.html` with the headers of `service/cloudflare/_headers`
   (`wrangler.jsonc:15`); only `/api/*` and `/files/*` reach the Worker
   first (`wrangler.jsonc:16`). `_headers` sets `Referrer-Policy:
   same-origin`, so the page's address never leaves the band's site. A
   signed-out answer sends a band page to sign-in (`routes.tsx:106`).
6. Workers Free: 10 ms of CPU a request, 100,000 requests a day, 100 MB a
   request body; R2: 10 GB free. The player fetches a track in 256 KB pieces
   (`service/src/takes/player/player.ts:47`): a 5-minute take of six tracks
   is about 115 requests a listen.
7. Messengers fetch a link themselves to draw its preview, so opening the
   page is not a listen.

The mockups Alex chose from:
- what the link page shows: https://claude.ai/artifact/VPSmxKNmEHqRUdonkhXGMn
- the link window: https://claude.ai/artifact/G34JLYxnfKjwWzbgE8nwgh
- where the list of all links is: https://claude.ai/artifact/LGie8M76uVxei6cDQH3RmM
- how to find it: https://claude.ai/artifact/UoLKTPuDfxDCP5trfrfkdn

Their sources are in /mnt/project-files/band-service/share-link/
(`q1-mock/`, `q6-mock/`, `q10-mock/`, `q11-mock/`).

## Alex's picks

All on 15 November 2026, UTC.

- 22:16:55, the ask: «давай сделаем чтобы можно было шарить дубли внешним
  пользователям».
- 22:28:27, in words: «я бы сделал настройку при создании ссылки с выбором
  что показывать». What the link shows is chosen for each link when it is
  made: the mix; the mix and the tracks; the mix, the tracks and the band's
  marks.
- 22:30:35, card: **Выбирать при создании**. What the person can download
  is chosen for each link: nothing, the mix, or the mix and the tracks (MP3
  and FLAC). Nothing to begin with. The band's **Download** window is used.
- 22:31:37, card: **Как слышишь ты**. The link keeps the maker's levels, M
  and S as they are when it is made, as **Download** does.
- 22:32:32, card: **Выбирать при создании**. How long the link lasts is
  chosen for each link: no end, a month, a week, a day. No end to begin
  with. Claude said any member can close a link early; he did not object.
- 22:34:10, card: **Без пароля**. No password. The link itself lets the
  person in; its end and closing guard against it spreading. (Claude had
  recommended a password the service makes.)
- 22:39:50, in words: «А.» The link button, with the chain icon, sits beside
  **Download** in the take's title row, on a computer and on a phone. He
  asked whether a link is seen only when made. Claude answered that the
  take's links stay listed in the window with **Copy**, and the whole
  address shows only on the new one; Claude offered to show it on every row,
  and he did not answer that.
- 22:40:41, card: **Только в сервисе**. No link from РЭХА, nothing to sync.
- 22:41:30, card: **В списке ссылок**. A link's row says how many times it
  was played and the last day. A press of ▶ counts, opening the page does
  not. No Telegram message.
- 22:42:28, card: **Фраза про Download**. reha.stream gets one or two
  sentences in “Take your track home”, no new picture.
- 22:43:55, card: **3. Смешанно**. A link that shows only the mix plays one
  MP3, made by the maker's page at **Make link** and kept with the link. A
  link that shows the tracks plays the track files, as the band's player
  does.
- 22:44:45, in words: «а списка ссылок нигде не будет? нужно ходить по всем
  дублям и смотреть где есть ссылки?»
- 22:51:20, in words: «мемберс - хорошо. только неочевидно что там под этим
  названием еще и ссылки». The band's list of all links is a group on the
  **Members** page.
- 22:56:44, card: **А. Members and links**. The section and its page are
  called **Members and links**.

## What a band member sees

### The link button and the window

- In a take's title row, a button with the chain icon (`Link2`) stands just
  before **Download**, on a computer and on a phone. Its tooltip and its
  name for a screen reader: “Link for someone outside the band”. On a phone
  it is a ghost button, as **Download** is there.
- It opens the window **Link to “Viasna #12”**, `tall`, with the line “For
  someone outside the band: they open it without signing in.”
- At the top, the take's open links, newest first, as rows. A row's title
  is who the link is for, or, when that is empty, what it shows (“The
  mix”). Under it two lines: what it shows and what it lets download
  (“Mix and tracks, download everything”), then who made it and when,
  until when, and the plays (“Vik, 12 November · until 19 November ·
  played 3 times, last 14 November”; “no end”; “not played yet”; “played
  once”). On the right: **Copy** (an icon button that copies the address
  and shows ✓ for a moment) and **Close link**.
- Below, **New link**: the field “Who it is for (only the band sees this)”,
  then three rows of choices:
  - **Shows**: **The mix** · **Mix and tracks** · **And marks**
  - **Download**: **Nothing** · **The mix** · **Mix and tracks**
  - **Lasts**: **No end** · **A month** · **A week** · **A day**
  and the line “The mix goes as you hear it now: your levels, M and S.”
  While **Shows** is **The mix**, **Download**'s **Mix and tracks** is greyed
  out; a choice of it falls back to **The mix**.
- Buttons: **Close** and **Make link**.
- **Make link** makes the link and puts its row at the top with the whole
  address in a field beside **Copy**; the member presses **Copy**. The field
  empties for the next link; the choices stay. The window stays open.
- A link that shows only the mix needs its MP3 first: **Make link** shows
  how far the mix has got, as **Download** does, and the link appears when
  the MP3 is up. Closing the window stops it and no link is made. If it
  fails, a line under the buttons says so and no link is made.
- **Close link** closes the link at once and takes its row away.

### Members and links

- The section in the menu and its page are called **Members and links**.
  The address stays `/members`. The member's page line becomes “Who is in
  the band, and the links for people outside it.”
- A group **Links for people outside the band**, with the count, comes
  right after **People**, on the owner's page and on a member's page. It
  lists every open link of the band, newest first. Each row is as in the
  window, its title starting with the take's name, which opens the take:
  “Viasna #12 · Mum”. With no links the group says “No links yet.”
- Every member sees the list and can **Copy** and **Close link** on any row.

## What the person with the link sees

- The address is `https://<the band's address>/l/<22 letters and digits>`.
- The page has a bar at the top with the band's picture and name, as the
  band's pages have on a phone, and no menu. Then the take's name (“Viasna #12”), and under it the
  song, the day and the length; with tracks, the number of tracks too. The
  browser tab says “Viasna #12 · Kapela”.
- **The mix**: ▶ and one wave, the mix's own, as a take's row has them, on
  a computer and on a phone.
- **Mix and tracks**: on a computer, РЭХА's player as the band's take page
  has it: a lane and a fader per track, M and S, the MIDI notes drawn,
  Master, **Repeat** and the speed. On a phone, ▶ and the wave, then the
  tracks with their faders, M and S, as the band's phone page has them;
  there is no bottom bar, so no speed. It starts at the maker's levels, M
  and S. What the person changes stays in that page only.
- **And marks**: the same, with the band's marks on the wave and the list of
  marks with their comments under the player, to read. No comment box, no
  **Done**, no **Mark**.
- No ★, no ⋯, no **Mark**, no comments of their own, nothing that changes the
  band's things.
- **Download**, when the link allows it: the band's **Download** window. With
  **The mix**, only **The mix**; with **Mix and tracks**, also **Tracks in
  MP3** and **Tracks in FLAC**, with MIDI where a track has notes. A link
  that shows only the mix gives its own MP3; a link with tracks makes the
  mix in the page from what the person hears, as the band's **Download**
  does. **The mix**'s line there says “The MP3 the band made for this
  link.” on a mix link.
- A link that is closed, past its end, or whose take is in the Trash or
  gone: the page says “This link no longer works.” under the band's name,
  and nothing else. The same answer for a link that never existed.
- The first ▶ after the page opens counts one play and sets the day of the
  last one. Further presses in that page do not count.
- The page does not tell search engines about itself (`noindex`).

## How it is built

### Data

- A migration adds a table `share_link`: its id (22 random characters from
  the 57 letters and digits that cannot be confused, kept whole so it can be
  copied again), the take's uid, who made it, when, who it is for (up to 60
  characters, may be empty), what it shows (`mix`, `tracks`, `marks`), what
  it lets download (`none`, `mix`, `all`), its end (a time, or empty for no
  end), the maker's levels, M and S (JSON in the form of `Heard`, for a link
  with tracks), the generation the mix was made from (for a mix link), the
  plays and the last play's time.
- A mix link's MP3 and its wave go to R2 under `links/<id>/`.
- An end is counted from the moment the link is made: **A day** 24 hours,
  **A week** 7 days, **A month** the same day and hour next month. The list
  shows its day in the member's browser.

### Routes for members (`needMember`)

- Make a link to a take: the choices and who it is for; the levels, M and
  S for a link with tracks; for a mix link, its MP3 and wave in the same
  request, streamed to R2. The take must exist and not be in the Trash.
- List the band's open links, newest first, with the take's name; the
  window takes the take's own from it.
- Close a link: any member, any link. Its row and its mix files go at once.
  A link already closed answers as done.

### Routes for the person with the link (no sign-in)

- `GET /api/l/<id>`: the link's page, built like the take's page
  (`service/worker/takes/band-routes.ts:116`) but only with what the link
  shows: the take's name, song, day, length, the amount; the tracks with
  their files at the link's own addresses, the notes, the levels, M and S
  (tracks links); the marks with their comments (marks links); what it lets
  download. No member's email or id, no stars, no other take.
- `/files/l/<id>/…`: the files the link allows, from the take's current
  generation (tracks links) or `links/<id>/` (mix links), with Range and
  ETag as `/files/…` has now. MP3, peaks and MIDI to play and draw; FLAC
  and `?download=1` on a track's files only when the link lets download
  everything; the mix MP3 with `?download=1` when it lets download the mix.
  A mix link reaches no track file.
- `POST /api/l/<id>/played`: one play.
- Each of these answers 404 with the same body for a link that is closed,
  past its end, unknown, or whose take is in the Trash. They are added to
  the Worker's routes without `needMember`, so `run_worker_first` stays as
  it is.

### The pages

- `/l/<id>` is served as `index.html` by the assets' single-page fallback.
  It is a route of its own beside `/signin` and `/stage`, outside the shell
  and its sign-in check; an answer for a signed-out visitor never sends it
  to sign-in. `_headers` gets a rule for `/l/*` adding
  `X-Robots-Tag: noindex`. The tab's title is set by the page once the link
  has loaded; a messenger's preview shows the page's own title, “РЭХА”.
- The link view reuses the take page's pieces: the player, the lanes, the
  marks list read-only, **Download**. It has its own way of loading the
  take and does not ask for the member's levels.
- **Make link** on a mix link runs `makeMix` with the maker's `Heard`, and
  the wave is counted from the same buffer.
- `service/openapi.json` describes the new routes.

### When things change

- **A crop**: a link with tracks plays the new generation, at the saved
  levels, which are kept by track name. A mix link keeps playing the mix it
  was made from.
- **The take goes to the Trash**: its links stop working and leave the
  lists. **Restore** brings back those not past their end.
- **The take is deleted for good** (30 days in the Trash, `purge.ts:34`):
  its links and their files go with it.
- **Past its end**: the link stops working at once and leaves the lists.
  The daily run (`wrangler.jsonc:30`) deletes it and its files.
- **A member is removed**: the links they made stay, with their name.
- **The song or the take is renamed**: the link page and the lists show the
  new name.

### Words elsewhere

- **reha.stream**, `site/content/band-service.md`, “Take your track home”,
  after the first paragraph: “To let someone outside the band hear a take,
  press the chain button beside **Download** and then **Make link**. You
  choose whether they hear only the mix or the tracks too, whether they can
  download, and how long the link works; they open it without signing in.”
- **Members** becomes **Members and links** in `service/README.md` (lines 5,
  86, 107, 110) and `docs/using-it.md` (lines 868, 892).
- **CHANGELOG**, under “Unreleased”: “**A link to a take for someone outside
  the band.** In the band service press the chain button beside **Download**
  on a take's page, choose what the link shows, what it lets download and
  how long it works, and press **Make link**. The person opens it without
  signing in. Every link of the band is on **Members and links**, the
  **Members** page's new name, where any member can close one.”
- `docs/design-system.md` C3 gets the link window's case: a window that
  lists things which act at once and also makes one says **Close**, not
  **Cancel**, because what it made stays.

### Pictures

- No new picture. `npm run pictures` in `service/` retakes them all. Those
  that change: `downloads` and `sets`, taken on a computer, whose menu says
  **Members and links**; and those with a take's title row, which gets the
  chain button: `downloads`, `lanes`, `three-weeks-ago`, and `mark` if its
  row is in view. Alex sees them before the merge.

## Stress cases

- A take of 15 minutes and eight tracks as a mix link: the mix takes about
  a minute and is about 27 MB, under the 100 MB a request may carry.
- A phone that sleeps while **Make link** mixes: the mix stops with the page;
  no link is made, and the line says so.
- Two members close the same link at once: both rows go; the second gets
  “done”.
- A link sent to a group chat and played by twenty people: twenty plays. A
  messenger's preview counts none.
- A link with **Download: Nothing** still plays MP3s and draws the notes,
  which a browser can be made to save; FLAC and the **Download** window are
  held back.
- Many links: the list is one group; a band of four makes a few a month.
  The page shows them all.
- The person opens the link on a phone in a messenger's own browser: the
  page is the same; Range requests work there as in Safari.
- Someone guesses addresses: 22 characters from 57 make about 128 bits, so
  no guess finds a link.
- A link whose take had no amount (an older РЭХА): it plays as the band
  hears it, at gain 1.

## Tests

- Worker tests: making each kind of link; the list; closing by any member;
  the routes without sign-in answering only what each link allows (a mix
  link refuses track files, a link without download refuses FLAC and
  `?download=1`, no link reaches another take's files); 404 for closed,
  ended, unknown and trashed; **Restore** brings a link back; the daily run
  deletes ended links and their files; purge deletes a take's links; a
  crop keeps a tracks link working on the new generation; a play counts.
- Page tests: make a link in the window, see it at the top with its address,
  see it on **Members and links** with the take's name; open it in a fresh
  browser without signing in, with each **Shows** and **Download**; ▶ adds a
  play; **Close link** makes the page say “This link no longer works.”; the
  menu and the heading say **Members and links** (`frame.spec.ts:17`,
  `members.spec.ts`, `pointer.spec.ts:27`).
- Only the tests a change touches run while building; the full suites run on
  CI.

## Before the pull request

- A fresh agent reviews the branch for security: the new open routes, what
  each answers, the files they reach, the upload's size.

## Claude's calls

1. The field **Who it is for** is Claude's addition (said on 15 November);
   only the band sees it.
2. The whole address shows only on a new link's row; every row has **Copy**.
   Claude's offer to show it on every row has no answer yet.
3. The window's way out is **Close**, not **Cancel**, against C3 as written;
   C3 gets this case.
4. **Close link** acts at once, with no question: a closed link costs only a
   new one.
5. A link that shows only the mix cannot let download the tracks: its MP3
   may be from an older cut than the tracks.
6. A play counts once for each opening of the page.
7. The person with the link may move faders, M, S, Master and the speed;
   nothing is kept.
8. Links of a take in the Trash leave the lists and come back on
   **Restore**; links past their end leave the lists and are deleted the
   next day.
9. A month is a calendar month, a week 7 days, a day 24 hours, from the
   moment the link is made.
10. A messenger's preview shows “РЭХА”, not the take's name: the take's name
    there would need the Worker to answer `/l/*` first and write the title
    into the page.
11. The mix link's wave is counted at **Make link** and kept beside its MP3.
12. The owner's page keeps its line “Only you see the addresses, the buttons
    and the keys.”; the links group is the same for every member.
13. The comments in РЭХА's code that name the **Members** page stay as they
    are, so РЭХА's checks do not run for this change.
14. No limit on the number of links.
15. **Make link** does not copy the address by itself: a mix link is made a
    minute later, when Safari no longer lets a page write to the clipboard.
16. On a mix link, **Download**'s line for **The mix** says “The MP3 the band
    made for this link.”; the member's **Members and links** line becomes
    “Who is in the band, and the links for people outside it.”
17. The link page's player follows the mockup Alex saw on 15 November: ▶
    and the wave for the mix; for tracks, the band's computer and phone
    take pages without the bottom bar, so a phone has no speed.
18. A link with tracks serves its MIDI files to draw the notes whatever it
    lets download.

## Left to the plan

- The exact routes' names and the order of the tasks.
- How the link view is wired into `main.tsx` and the router.
