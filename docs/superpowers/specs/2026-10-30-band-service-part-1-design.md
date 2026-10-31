# The band's service, part 1: takes, stars and marks

A web page where Alex's band listens to its takes after a rehearsal, track by
track, stars the good ones and talks about them at the moment they happen.
РЭХА sends the takes there. It opens at band.reha.stream, made for a
computer first and working on a phone too.

## Alex's picks

From the concept of 24 October (/mnt/project-files/band-service/concept.md),
unchanged: in the browser, on a phone and on a computer, only online; takes
filed by song across rehearsals; each member stars a take, and everyone sees
who starred what; a mark and a comment at a moment of a take are one thing,
with replies, and can be closed; marks go one way, from РЭХА to the service;
РЭХА and the service match songs by name; РЭХА has one set of send buttons,
and Settings sends them either to the cloud folder or to the service, never
both, the same three ways; files in Cloudflare R2, text in D1, code on
Workers; the service's code is open under FSL, РЭХА stays MIT.

On 30 October, in this thread:

- For his band only (17:04, a card): no sign-up, payments, limits or
  marketing.
- In parts, each with its own spec and plan (17:08, a card). This is part 1.
  Part 2 is songs with notes, files and Guitar Pro; part 3 is sets; the rest
  of the concept comes after.
- РЭХА sends MP3 and the original tracks in FLAC (17:09, a card). Asked why
  both, Claude answered (17:10-17:12): MP3 is what the browser plays; FLAC
  is for mixing, for when the laptop dies, and for the comping step later.
- Sending survives РЭХА being closed and the laptop's lid being shut (17:13,
  17:14): it carries on from where it stopped.
- In English, like РЭХА (17:15, a card).
- The code lives in the РЭХА repository, in `service/`, under FSL (17:16, a
  card).
- At its own address on reha.stream, with the domain's DNS moved to
  Cloudflare (17:19, a card).
- A bot tells the band's Telegram chat about new takes and comments (17:20,
  a card).
- The first screen: what is new since you were last here, then the songs
  (17:27, a card; option В of
  https://claude.ai/artifact/VXBUe9Cxzi58pGYVjStDnw).
- A song's page: the take the band likes best on top, then every take by
  date (17:30, a card; option Б of
  https://claude.ai/artifact/9PfGnKg9pjtq9s37Cex5js).
- A take's page: a lane for each track, each with M and S, like РЭХА's player
  (17:33, a card; option Б of
  https://claude.ai/artifact/XTHyYnrgN6hjBVVLnSxtuK).
- Other people who use РЭХА do not see the service: sending there appears
  only after a key is pasted in (17:34, a card).
- Made for a computer first, with the phone supported (17:44, in words).
- РЭХА usually runs as one copy at the rehearsal room, so a star in the
  service is each member's own (17:47, in words).
- On a computer the songs stay down the left, and the song or the take
  opens on the right (17:52, a card; option Б of
  https://claude.ai/artifact/SZKv2ssjChEjWWsrnKWkqK). On a phone the same
  pages come one at a time.
- A ★ set in РЭХА shows apart from the members' stars, and the best take is
  picked by the members' stars (17:53, a card).
- At band.reha.stream (17:57, a card).
- No email code that runs out every month (18:04, in words): each member
  gets a personal link from Alex, and opening it signs them in for a year
  (18:09, a card). This replaces sign-in by email through Cloudflare
  Access, which was in the concept.
- Each member types their own name (18:16, in words).
- A link works once and runs out (18:18, in words); a link from Alex lasts
  a day (18:19, a card).
- The bot writes the moment a take or comment is ready, adding to the same
  message rather than posting a new one each time; no timer (18:22, a card).

On 31 October:

- Each feature on its own, so the code does not turn into spaghetti
  (15:51, in words). One switch for where takes go, and under it the
  chosen one's own panel, as part of its own module (15:53, in words).
- A take removed in РЭХА goes to the service's trash, with its comments
  and stars; the trash is in part 1 (15:57, a card).

Everything else below is Claude's call, listed again in
[Calls to review](#calls-to-review).

## What the band sees

### Signing in

Alex sends each member their own link, in Telegram or however suits him.
There is no email, code or password. A link lasts a day: one not used by
then stops working, and Alex makes a new one. A link also works once: it
opens a page with **Sign in**, and pressing it signs that browser in and
uses the link up. The sign-in lasts a year, and every visit moves the year on, so in
practice nobody signs in again. The button is there because Telegram opens
every link itself to draw its preview, and without it the preview would
use the link up before the member got to it.

To sign in on a second device, the member presses **Sign in on another
device** at the bottom of the left column. It makes a new one-time link
for them, to send to themselves or to scan as a QR code, so Alex is not
needed for it. That link lasts 15 minutes.

The first time a link is opened, the service asks “What should the band
call you?”. The member types their name, and it and its first letter are
what the others see on stars and comments. They can change it later with
their name at the bottom of the left column.

If a phone is lost, Alex presses **Sign out everywhere** for that member
and sends them a new link. A member is also signed out if they stay away a
whole year or clear their browser's data; then they ask Alex for a new
link too.

Alex himself gets in with the setup secret, a password he sets once in
Cloudflare. band.reha.stream/setup asks for it and signs that browser in
as Alex. It works whenever he needs it: the first time, after a lost phone,
or after a year away. Cloudflare does not show a secret again once it is
set, so if Alex forgets it, he sets a new one there.

### Members

A page only Alex sees, at the bottom of the left column (on a phone, at
the bottom of the first screen). It lists the members, each with **New
link** and **Sign out everywhere**, and has **Add member**. **Add member**
and **New link** both make a one-time link to copy and send. A link nobody
has used yet shows as “Not opened yet”, and as “Ran out” after a day.
Below them are РЭХА's keys:
**Make a key for РЭХА**, and each key with its name (“Rehearsal room”) and
**Remove**.

### The first screen

At the top, **New since you were here**: the takes and comments that arrived
since you last looked, from the newest rehearsal down. A take stays new for
you until you open it; a comment, until you open its take. With nothing new
the card is not there.

Below it, **Songs**: every song with takes, the most recently played first,
each with how many takes it has, the day of its last one, its best take and
that take's stars. A take whose name is not a song (“Take 7”) is under **Not
named**, last.

### A song's page

On top, the take the band likes best: the one with the most stars, the newest
of those if it is a tie, with a ▶ that plays it there and then. With no
stars yet, the newest take. Then **All takes**, newest first: name, day,
length, how many marks, and who starred it.

### A take's page

The take's name, day, length and number of tracks; a ★ that is yours to put
on or take off, the first letters of everyone who starred it, and
**★ at rehearsal** if the take was starred in РЭХА.

Then a lane for each track, as РЭХА's player draws it: the track's name, M
(mute) and S (solo, only this one), and its waveform with the marks across
it. One ▶ and the time below them. All lanes play together, in time, with
the balance set in РЭХА's player. Tapping a lane moves the playhead there.
M and S are yours alone and are forgotten when you leave the take.

Under the player, **Marks and comments**, in time order. A mark from РЭХА
shows its label and colour and its note. A comment shows its text and who
wrote it. **Comment at 1:42** writes one at the playhead. A comment can be
answered, and closed when the place is fixed; a closed one is greyed and
stays in the list. Tapping one moves the playhead to it.

At the bottom, **Download tracks**: a link per track to its original in
FLAC, and to its notes as `.mid` where the track recorded MIDI.

### On a computer and on a phone

On a computer, a column down the left holds **New** at the top, with how
many things are new, and then **Songs**: every song with how many takes it
has and a dot when one of them is new. The rest of the window shows what
was picked there: the new card, a song's page, or a take, with a path above
it (Viasna › Viasna 12) to step back to the song. The service opens on
**New**; with nothing new, on the song played last. On a take, the marks
and comments sit under the lanes.

On a phone the column is gone and the pages come one at a time: the first
screen (the new card, then the songs), a song's page, a take, each with a
back arrow.

### Trash

A take removed in РЭХА, by deleting it there or with **Remove from the band
service**, is not deleted in the service. It goes to **Trash**, at the
bottom of the left column (on a phone, at the bottom of the first screen),
with its files, comments and stars. Anyone in the band can open it there,
listen, and press **Restore**, which puts it back in its song as it was.
After 30 days in the trash a take is deleted for good, files and all.

If РЭХА sends a take again while it is in the trash, it comes out of the
trash with its comments.

### In the band's chat

The bot writes to the band's Telegram group the moment something is ready,
with no timer. The first take of a rehearsal to be ready (its MP3s up)
starts a message, and each next take of that rehearsal is added to the same
message:

> New takes from Thursday, 30 October: Viasna 11, Viasna 12, Pałyn 9

Comments go the same way: a member's first comment on a take starts a
message, and their next ones on that take are added to it:

> Alex on Viasna 12: 1:42 “The bridge drags here”, 2:58 “Fill too long?”

Telegram does not notify anyone when a message is edited, so the chat pings
once per rehearsal, and once per person and take. A message takes additions
for three hours; after that the next take or comment starts a new one, so
nothing is added to a message that has long scrolled away.

Each take and each comment is a link to its place in the service. Marks that
come from РЭХА are not posted on their own: they arrive with their take.

## What РЭХА does

### Settings: one switch, a panel for each

Until a key is pasted, **Settings › Folders** has its **Cloud folder** group
exactly as today, with one quiet line at the bottom: **I have a band
service key**. Pressing it opens a field for the key. A key is one line of
text holding the service's address and a secret, such as
`band.reha.stream:9fT2kQ…`. Alex makes it on the service's **Members**
page. It is not a link to open in a browser.

With a key in, the group is called **Sending takes** and starts with the
switch **Send takes to**: **Cloud folder** or **Band service**. Under the
switch is the panel of the one chosen, and only that panel:

- **Cloud folder**: today's rows, unchanged: the folder, **Copies are
  written as**, **Send saved takes automatically** and **What gets sent**.
- **Band service**: the service's address with **Disconnect**, which
  removes the key and puts the group back as it was; one sentence on what
  goes up (every track as MP3 and FLAC, its MIDI, the take's marks), since
  there is nothing to choose; and its own **Send saved takes
  automatically**.

Each panel keeps its own settings, so switching back finds the other as it
was left.

### A take's cloud button

The button sends to the one chosen. For the cloud folder it opens today's
dialog. For the band service it sends at once, with no dialog, since there
is nothing to choose. On a take that has gone up to the service it opens a
small dialog, “Viasna 12 in the band service”, which says which files are
up and which are still on their way, and has **Remove from the band
service**, which moves the take to the service's **Trash** (see
[Trash](#trash)).

### Two modules, one way in

The cloud folder and the band service are separate modules, and neither
knows about the other. Both answer the same few calls: send a take, send
what changed in it, remove it, and say how far it got. A take's cloud
button, **Send starred** and automatic sending only ever make those calls,
on whichever module the switch picked.

In РЭХА's Python, the two live side by side in a new `sending/` package,
one file each, with the calls they share in its `__init__.py`. The cloud
folder's code moves there from `cloud.py` and from `api.py`
(`share_take`, `send_starred`, `unshare_take`, `_enqueue_publish`), with
no change to what it does. In the UI, each module has its own panel
component; the **Sending takes** group draws the switch and the chosen
panel, and nothing else.

### What goes up

The same three ways as for the cloud folder: a take's cloud button, **Send
starred**, and the service panel's **Send saved takes automatically**. For the service there is
no choice of what or in which format: each track goes as MP3 for listening
and FLAC as recorded, plus its `.mid` if it recorded MIDI, plus the take's
name, rehearsal, length, balance, ★ and marks. РЭХА makes the MP3 and FLAC
files the way it already makes them for the cloud folder
(`audio/encode.py`). Every MP3 of a take goes first, so the band can listen
before the originals are up.

The ★ set in РЭХА is not anyone's star. In the service the take shows it
as **★ at rehearsal**, apart from the members' stars, and it does not count
when the best take is picked.

Old rehearsals go up the same way: their takes' cloud buttons, or **Send
starred** in History.

### Keeping the service up to date

What changes a take in РЭХА after it went up follows it there, as with the
cloud folder: a rename, a song renamed, a crop (its files go again), a ★, a
mark added, changed or removed. A take deleted in РЭХА goes to the
service's **Trash**, with its comments and stars.

A crop that cuts the start moves the take's comments back by the same
amount, so each stays at its moment in the music. A comment that was in the
part cut off stays, at 0:00, marked “In the part cut off”.

### When the sending is cut short

Each file goes up in parts of 10 MB. РЭХА writes down which parts arrived,
so when it is opened again, or the laptop wakes, it sends only what is
missing. Nothing has to be pressed.

Closing РЭХА while it is sending asks first: “Still sending 3 takes to the
band service, 1.2 GB left. The rest goes the next time РЭХА is open.” with
**Close anyway** and **Keep sending**. A shut lid cannot be asked; РЭХА
carries on when the laptop wakes.

A take whose MP3s are not all up yet is not shown in the service. One whose
FLAC is still on its way is shown, and its **Download tracks** says which
originals are still coming.

## How it is built

### Cloudflare

| Piece | What it does | Cost for one band |
|---|---|---|
| Worker | the pages and the API, at band.reha.stream | free: 100,000 requests a day |
| D1 | songs, takes, stars, comments, members, what each member has seen | free |
| R2 | MP3, FLAC, MIDI, waveforms | first 10 GB free, then $0.015 per GB a month. A two-hour rehearsal on 6 tracks is about 1 GB of MP3 and 3 GB of FLAC, so after a year of weekly rehearsals about $3 a month |

Workers' free plan allows 10 ms of CPU and 100 MB of body per request. A
10 MB part is well inside the body limit, and passing a file between R2
and the browser costs little CPU, since time spent waiting on R2 does not
count.

### The address

band.reha.stream needs reha.stream's DNS on Cloudflare: a Workers Custom
Domain needs an active Cloudflare zone, and the other way (a CNAME setup)
is only on the Business plan. The site stays on Vercel: its records move to
Cloudflare as they are, unproxied, and so does the TXT record for Google
Search Console.

### Sign-in and the key

The Worker checks every request itself. A link carries a long random
token, and D1 keeps only its hash. Opening the link (a GET) only shows the
**Sign in** page; pressing the button (a POST) checks the token and its
expiry, deletes it, and starts a session in a cookie (HttpOnly, Secure, SameSite=Lax) that
lasts a year from the last visit. **Sign out everywhere** deletes all of a
member's sessions. Links from the band's chat open signed in, since Lax
cookies go with a link followed from another app.

РЭХА's key is a long random secret too, sent in a header and kept as a
hash. It stands for a copy of РЭХА, usually the one at the rehearsal room,
never for a member, and works until Alex removes it.

Cloudflare Access is not used: it keeps a sign-in for a month at most
(Cloudflare's session management page, read on 30 October).

Alex signs in at band.reha.stream/setup with the setup secret, kept as a
Worker secret. The first time, that makes him the owner; after that it
only signs him in again.

### Uploads

Through the Worker, with R2's multipart API: РЭХА asks for an upload, sends
parts of 10 MB, then completes it. R2 has no call that lists the parts
already up, so РЭХА keeps that list in its own database. An upload left
unfinished for 7 days is dropped by R2, and РЭХА starts that file again.

### Playing

As tested on 24 October on Alex's Mac and iPhone: each track's MP3 is
streamed and decoded a few seconds ahead with WebCodecs, and every track is
started on the same audio clock. The waveforms come from РЭХА, which already
draws them for its player (`audio/waveform.py`), as a small file per track,
so the phone never decodes a whole take to draw it. There is no mix file:
the browser mixes the tracks with РЭХА's balance.

### Code

`service/` beside `site/`, with its own LICENSE (FSL-1.1-MIT). The pages are
React, built with the design system's styles and components from `ui/src`,
the way the site uses them. The Worker and the pages share one build. D1's
tables are in `service/migrations/`.

Tests: the Worker's logic on Cloudflare's own test runner; the pages in
Playwright on made-up data, as the site does; РЭХА's sending against a fake
service in pytest. They run in `checks.yml`.

It goes live with a release, as the site does, and can be sent by hand from
the workflow.

## Setting it up

Once, by Alex, with step-by-step notes from Claude:

1. A Cloudflare account, and reha.stream added to it; the nameservers changed
   at the registrar.
2. A Telegram bot from BotFather, added to the band's group.
3. Secrets in Cloudflare and in GitHub: the API token for deploying, the
   bot's token, the chat's id, and the setup secret.
4. band.reha.stream/setup with the setup secret; then the members, their
   links sent to them, and a key for РЭХА at the rehearsal room.

## Not in part 1

Songs' notes, files, Guitar Pro and status (part 2). Sets (part 3). Comparing
two takes, loop and slow-down, links for people outside the band, email,
deleting a take from the service by hand, uploading without РЭХА,
**Download all**, comping. Nothing on reha.stream, which is about РЭХА; and
nothing in the guide, since only the band can use it.

## Calls to review

1. A sign-in lasts a year from the last visit, so it runs out only for
   someone who stays away a year.
2. Alex makes the members' links and РЭХА's keys on a **Members** page only
   he sees; a link nobody has used shows as “Not opened yet”.
3. A link opens a page with **Sign in** and is used up by the press, so
   Telegram's preview cannot use it up.
4. A member signs in on another device with a one-time link or QR code they
   make themselves, which lasts 15 minutes.
5. A lost phone: **Sign out everywhere**, then a new link.
6. Alex signs in with the setup secret at band.reha.stream/setup, any
   time; a forgotten secret is replaced in Cloudflare.
7. A member can change their name later, at the bottom of the left column.
8. A take is new for you until you open it; there is no “mark all as seen”.
9. On a computer the service opens on **New**; with nothing new, on the song
   played last.
10. Songs are listed by their last take, not alphabetically.
11. A take nobody named goes under **Not named**.
12. Best take: most members' stars, newest on a tie; with none, the newest
    take.
13. M and S are per person and are not kept.
14. **Download tracks** is in part 1 (Claude offered it at 17:12, with no
    answer either way), as a link per file, not one zip.
15. A chat message takes additions for three hours, then a new one starts;
    marks from РЭХА are not posted on their own.
16. **I have a band service key** is the last line of the **Cloud folder**
    group; with a key, the group becomes **Sending takes**.
17. Each panel keeps its own settings, **Send saved takes automatically**
    included.
18. The cloud folder's code moves into a `sending/` package beside the
    service's, behind the same calls, before the service is added.
19. A take's cloud button sends to the service with no dialog; on a sent
    take, a dialog with what is up and **Remove from the band service**.
20. For the service, РЭХА sends a fixed set: MP3, FLAC and MIDI, no choice.
21. No mix file: the browser mixes the tracks. With six tracks this saves a
    seventh of the MP3 space.
22. MP3s first, FLAC after; a take shows once its MP3s are up.
23. A take stays in the trash for 30 days; any member can restore it.
24. A take sent again from РЭХА comes out of the trash with its comments.
25. A crop that cuts the start moves the comments back; one in the cut part
    stays at 0:00, marked “In the part cut off”.
26. Parts of 10 MB; an upload unfinished for 7 days starts again.
27. Closing РЭХА while sending asks first, with its wording above.
28. Waveforms are made by РЭХА and sent with the take.
29. The pages are React with the design system's components, as on the
    site; the service's tests run in `checks.yml` with the rest.
30. The service goes live with a release, like the site.
31. Nothing about the service on reha.stream or in the guide.
