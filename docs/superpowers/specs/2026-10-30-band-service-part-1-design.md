# The band's service, part 1: takes, stars and marks

A web page where Alex's band listens to its takes after a rehearsal, track by
track, stars the good ones and talks about them at the moment they happen.
РЭХА sends the takes there. It opens at band.reha.stream, made for a
computer first and working on a phone too.

Alex approved this spec on 31 October at 16:33 («пиши», after «ок»). At
18:01 he reopened how the service is built; the answers of 18:08-18:33
changed sign-in to email and are folded in below; he approved this
version at 18:43 («ок»).

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
  Access, which was in the concept. (Replaced on 31 October by sign-in by
  email with a code, below.)
- Each member types their own name (18:16, in words).
- A link works once and runs out (18:18, in words); a link from Alex lasts
  a day (18:19, a card). (Replaced on 31 October, with the links.)
- The bot writes the moment a take or comment is ready, adding to the same
  message rather than posting a new one each time; no timer (18:22, a card).

On 31 October:

- Each feature on its own, so the code does not turn into spaghetti
  (15:51, in words). One switch for where takes go, and under it the
  chosen one's own panel, as part of its own module (15:53, in words).
- A take removed in РЭХА goes to the service's trash, with its comments
  and stars; the trash is in part 1 (15:57, a card).
- A take nobody named simply has no song: its song is empty in the data,
  as in РЭХА (16:12-16:14, in words).
- Asked again whether the choice of cloud folder or service should show to
  everyone: no, only after a key (16:17, a card).
- The key's line explains what a key is, says a band can run a service of
  its own, and links to a page about it on the site (16:19, in words). The
  page has no live service pages in it (16:22, in words).
- Each module keeps its own **Send saved takes automatically** (16:25, in
  words).
- The guide gets a section on sending to the band service (16:32, in
  words, after asking why the spec had left it out).

On 31 October, how it is built, in rounds of questions (18:01-18:33; the
record with each question is in
/mnt/project-files/band-service/part-1/architecture.md):

- The server part in TypeScript: Hono for the routes, Drizzle ORM for D1
  (18:08, «1 - ок»).
- Only the band's own copy; checks run locally on made-up data (18:08).
- РЭХА sends its version with each request; the service only ever adds,
  and a РЭХА too old for it is told “Update РЭХА to send takes here”
  (18:08).
- The bot's messages go through Cloudflare Queues and are tried again when
  Telegram fails (18:08).
- РЭХА's files go through the Worker (18:16, «остальное -ок», after asking
  whether the Worker's limits hold).
- The code in `service/` is laid out by feature (18:16).
- The pages get their data through Hono RPC, and zod checks what comes in
  (18:16).
- The service describes its API in OpenAPI made from the same zod schemas,
  and РЭХА's tests check each of its requests against it (18:16).
- Page tests run against the real Worker on the computer, with a made-up
  band (18:16).
- Sign-in by email, through better-auth, a ready-made library (18:16-18:18,
  in words: «почта мне кажется это нормально», «если уже есть готовое -
  нахрена изобретать велосипед?»). This replaces the personal links of 30
  October. Asked about his «без кода который через месяц дохнет» of 30
  October, Claude answered that it was about Cloudflare Access, and a
  sign-in here still lasts a year from the last visit.
- The letter holds a code of 6 digits; it lasts 10 minutes and stops
  working after 5 wrong tries (18:26).
- Alex signs in by email too: his address in the Worker's settings makes
  him the owner. There is no setup secret (18:26).
- No links from Alex and no **Sign in on another device**: a member signs
  in on any device with their address. **Sign out everywhere** stays
  (18:26).
- РЭХА's key comes from better-auth's API Key plugin (18:26).
- Cloudflare's Workers Logs are on, and the bot writes to Alex alone when
  the server fails (18:26).
- Letters go through Cloudflare's free sending, which sends only to
  confirmed addresses (18:29, «а», after asking whether everyone gets a
  mailbox on Cloudflare: no). reha.stream gets no mail today, so turning
  on Cloudflare's mail for it touches nothing (18:31).
- The service puts a member's address on Cloudflare's list itself, and
  **Members** shows whether the member has confirmed it (18:33).
- The pages use TanStack Router and TanStack Query (18:33).
- The player gets its files through the Worker, which checks the sign-in
  (18:33).
- Copies: D1's own history of 7 days and the 30-day trash, nothing more
  (18:33).
- Sending on its own leaves false starts out, for the band service and the
  cloud folder alike (19:11, in words; 19:13, a card). A false start ticked
  on the review screen still goes (19:15, «ок», after Claude explained it).

Everything else below is Claude's call, listed again in
[Calls to review](#calls-to-review).

## What the band sees

### Signing in

A member signs in with their email address. On band.reha.stream they type
it and press **Send code**. A letter brings a code of six digits, and they
type it on the same page. A code lasts 10 minutes and stops working after
5 wrong tries; **Send code** again sends a new one. There is no password.

The sign-in lasts a year, and every visit moves the year on, so in
practice nobody signs in again. On a second device, a new phone, or a
browser whose data was cleared, the member signs in the same way, without
Alex.

The letter holds a code, not a link, for two reasons. A phone's mail app
often opens a link in its own built-in browser, and the sign-in would stay
there, unknown to Safari or Chrome. And a mail filter at work may open a
link before the member does. A code is typed wherever the member is, so
reading the letter on the phone and signing in on the computer works too.

Only addresses in the band get a code. The page answers the same for any
address (“If this address is in the band, a code is on its way”), so it
tells a stranger nothing about who is in the band.

Cloudflare sends letters only to addresses that have confirmed they want
them (see [Letters](#letters)). When a member is added, Cloudflare sends
them a letter of its own with **Verify email address**, and they press it
once. If they press **Send code** before that, the page says “First
confirm your address: look for a letter from Cloudflare, then press Send
code again”, and Cloudflare's letter is sent again.

The first time a member signs in, the service asks “What should the band
call you?”. The member types their name, and it and its first letter are
what the others see on stars and comments. They can change it later with
their name at the bottom of the left column.

If a phone is lost, Alex presses **Sign out everywhere** for that member,
and they sign in again on the new phone.

Alex signs in the same way. His address is in the Worker's settings, and
whoever signs in with it is the owner: they see **Members**. The first
time, his address goes through Cloudflare's confirmation like anyone's.

### Members

A page only Alex sees, at the bottom of the left column (on a phone, at
the bottom of the first screen). It lists the members by name and address,
each with **Sign out everywhere** and **Remove**, and has **Add member**,
which asks only for the address: the member types their own name the
first time they sign in. Until then a member shows as their address, with
“Has not confirmed the address yet” or “Has not signed in yet”. **Remove**
takes a member out of the band: their address gets no more codes, their
sign-ins end, and their stars and comments stay under their name.

Below them are РЭХА's keys: **Make a key for РЭХА**, and each key with its
name (“Rehearsal room”) and **Remove**.

### The first screen

At the top, **New since you were here**: the takes and comments that arrived
since you last looked, from the newest rehearsal down. A take stays new for
you until you open it; a comment, until you open its take. With nothing new
the card is not there.

Below it, **Songs**: every song with takes, the most recently played first,
each with how many takes it has, the day of its last one, its best take and
that take's stars. Takes nobody named as a song (“Take 7”) are under **Not
named**, last. Once one is named in РЭХА, it moves into that song.

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

When something fails on the server, the bot writes to Alex alone, never to
the band: what failed and when. The same failure is told once an hour at
most, so a broken piece does not flood his chat.

## What РЭХА does

### Settings: one switch, a panel for each

Until a key is pasted, **Settings › Folders** has its **Cloud folder** group
exactly as today, with one quiet line at the bottom: **I have a band
service key**. Pressing it opens a field for the key, and above the field a
few words on what it is, for anyone who has not heard of a band service:

> A band service is a private web page where your band listens to its
> takes track by track, stars the good ones and talks about them. Whoever
> runs it gives you a key to paste here. You can run one for your own band
> too: **How it works**.

**How it works** opens the service's page on reha.stream (see
[On reha.stream](#on-rehastream)).

A key is one line of text holding the service's address and a secret, such
as `band.reha.stream:9fT2kQ…`. Alex makes it on the service's **Members**
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

A false start does not go on its own, to the band service or to the cloud
folder. It is the take the rehearsal screen already greys: shorter than
the length in Settings (30 seconds unless changed), with no ★ and no
marks. On the review screen its **Send to the cloud** box (**Send to the
band service** with the service chosen) starts unticked; ticked by hand,
the take goes. A false start given a ★ or a mark later, in the rehearsal
in progress, is no longer one and goes on its own. The cloud button sends
one whenever it is pressed.

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

### Seeing what is on its way

The service's sending shows where the cloud folder's shows today. The
background work button in the header counts it (“2 working · 64%”), and
its list has a line for each take, such as “Viasna 12” → band service,
with a bar and what is left: “MP3s: 4 of 6”, then “FLAC: 2 of 6”. Takes
waiting their turn are listed as **Waiting**. The take's own button says
“Sending to the band service” or “Waiting for the band service”.

When РЭХА is opened again, the takes it still has to send are back in the
list at once, as waiting. With no internet a line does not fail, since
there is nothing to press: it says “No internet: carries on when it is
back”. A take the service turns down fails in red with the reason, as a
cloud copy does today.

### In the guide

The guide (`docs/using-it.md`) describes every row in Settings and what
each button does, so it gets a section, “Sending takes to a band
service”, after “Sending takes to the cloud”. It says what a key is and
where it goes, the **Send takes to** switch, what goes up, the take's
cloud button and its dialog, following the sending, closing РЭХА while it
sends, and **Disconnect**. What the service is and how to run your own
stay on reha.stream/band-service, and the section links there. Where the
guide says what a rename, a crop or a delete does to the copy in the
cloud, one line adds that the same goes for the band service.

## On reha.stream

A page at reha.stream/band-service tells what a band service is and how a
band runs its own. It is linked from the key's few words in РЭХА and from
the site's footer, not from the top menu, since most people who use РЭХА
will never need it.

What the page holds, in order:

1. What it is, in a few lines of text.
2. A story from Alex's band of how they use it, in the manner of the
   site's stories. Alex checks it before it goes live, as with every story.
3. **Run your own**: what it needs (a Cloudflare account; a domain of the
   band's own on Cloudflare, since the sign-in letters can only come from
   one; a Telegram bot, only for the chat messages), what it costs (files
   up to 10 GB free, then $0.015 per GB a month; the domain is paid to
   whoever sells it), and the steps one by one: put the service's code on
   Cloudflare, turn on Cloudflare's mail for the domain, set the settings
   and secrets, sign in with your own address, add the members, make a key
   for РЭХА.
4. That the code is open, under FSL, with a link to it.

The steps are written so a musician can follow them. They are the same
steps Alex follows to set up his band's copy (see
[Setting it up](#setting-it-up)), so they are tried for real before the
page goes live.

## How it is built

### Cloudflare

| Piece | What it does | Cost for one band |
|---|---|---|
| Worker | the pages and the API, at band.reha.stream | free: 100,000 requests a day |
| D1 | songs, takes, stars, comments, members, what each member has seen | free |
| R2 | MP3, FLAC, MIDI, waveforms | first 10 GB free, then $0.015 per GB a month. A two-hour rehearsal on 6 tracks is about 1 GB of MP3 and 3 GB of FLAC, so after a year of weekly rehearsals about $3 a month |
| Queues | the bot's messages, tried again when Telegram fails | free: 10,000 operations a day |
| Email | the sign-in codes | free to confirmed addresses, up to 200 of them |
| Workers Logs | what the Worker did, for finding a fault | free: 200,000 lines a day, kept 3 days |

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

better-auth does the sign-in, with its email code plugin (`emailOTP`) and
its Drizzle adapter on D1. Sign-up is off: a code goes only to an address
in the members' table or to the owner's address from the Worker's
settings. A session lives in a cookie (HttpOnly, Secure, SameSite=Lax) and
in D1, and lasts a year from the last visit: better-auth moves its end on
once a day of use. **Sign out everywhere** and **Remove** end all of a
member's sessions. Links from the band's chat open signed in, since Lax
cookies go with a link followed from another app. better-auth counts
sign-in tries in D1, since a Worker keeps nothing in memory between
requests.

РЭХА's key comes from better-auth's API Key plugin: a long random secret,
sent in a header and kept only as a hash. It stands for a copy of РЭХА,
usually the one at the rehearsal room, never for a member, and works until
Alex removes it.

Cloudflare Access is not used: it keeps a sign-in for a month at most
(Cloudflare's session management page, read on 30 October).

### Letters

Cloudflare's Email Service sends them through the Worker's `send_email`
binding. On the free plan it sends only to confirmed addresses, free and
uncounted, up to 200 in an account; any address at all needs the paid
plan, $5 a month (Cloudflare's pricing and limits pages, read on 31
October). Sending is still in beta there.

Letters come from an address on the band's domain, set in the Worker's
settings (band@reha.stream for Alex's copy). For that, Cloudflare's mail
(Email Routing) is turned on for reha.stream, which puts its MX records in
reha.stream's DNS. reha.stream gets no mail today, so nothing else is
touched.

The service keeps Cloudflare's list of confirmed addresses itself, through
Cloudflare's API, with a token allowed only that list: **Add member** adds
the address, which makes Cloudflare send its letter, **Remove** takes it
off, and **Members** reads from the list whether each address is
confirmed. Sending Cloudflare's letter again is a remove and an add.

In tests, letters go to a stand-in that keeps them, and the tests read the
code from there.

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

The files reach the player through the Worker, which checks the sign-in
for each file and hands it from R2 in pieces (`Range`). So a file is never
open to someone who has only its address.

### Copies

D1 keeps its own history: the database can be put back to any minute of
the last 7 days, at no cost (Cloudflare's Time Travel page). The files in
R2 have no copy; a take removed in РЭХА waits 30 days in the trash. Nothing
more is kept.

### When something fails

Workers Logs are on, so Cloudflare keeps 3 days of what the Worker did. A
failure on the server also goes to Alex through the bot (see
[In the band's chat](#in-the-bands-chat)). The bot can write to him only
after he has written to it once, so the setup has him send it /start, and
his Telegram id goes in the Worker's settings.

### Code

`service/` beside `site/`, with its own LICENSE (FSL-1.1-MIT), in
TypeScript. Inside, a folder for each feature (sign-in, members, takes,
comments, uploads, files, chat), each with its own routes, logic and
queries; the tables' Drizzle schema is one file. The Worker's routes are
Hono, and zod checks everything that comes in.

The pages are React, built with the design system's styles and components
from `ui/src`, the way the site uses them, with TanStack Router for the
pages' addresses and TanStack Query for their data. They call the Worker
through Hono RPC, whose types come from the routes themselves, so a page
that no longer matches its route does not build. The Worker and the pages
share one build.

From the same zod schemas the Worker serves a description of its API in
OpenAPI, and РЭХА's tests check every request РЭХА makes against it. РЭХА
sends its version with each request; the service only ever adds fields,
and answers a РЭХА too old for it with “Update РЭХА to send takes here”.

D1's tables are made by Drizzle's migrations in `service/migrations/`,
which only ever add. A take's song may be empty, as in РЭХА's own
`take.song_id`: that is a take nobody named, and **Not named** is only how
the list shows such takes.

Nothing in the code names band.reha.stream or Alex's band. The address,
the letters' sender, the owner, the bot and the chat come from each copy's
own settings, so another band can run its own copy unchanged.

Tests: the Worker's logic on Cloudflare's own test runner; the pages in
Playwright against the real Worker run on the computer, with a made-up
band in its database; РЭХА's sending in pytest, against a fake service
checked by the OpenAPI description. There is no test copy of the service
on Cloudflare. They run in `checks.yml`.

It goes live with a release, as the site does, and can be sent by hand from
the workflow.

## Setting it up

Once, by Alex, following the **Run your own** steps of the site's page,
plus the move of reha.stream's DNS for the band.reha.stream address:

1. A Cloudflare account, and reha.stream added to it; the nameservers changed
   at the registrar.
2. Cloudflare's mail (Email Routing) turned on for reha.stream.
3. A Telegram bot from BotFather, added to the band's group; Alex sends it
   /start once.
4. Settings and secrets in Cloudflare and in GitHub: the API token for
   deploying, the token for the list of addresses, the bot's token, the
   chat's id, Alex's Telegram id, his address, and the letters' sender.
5. Alex signs in at band.reha.stream with his address (confirming it to
   Cloudflare the first time); then he adds the members and makes a key for
   РЭХА at the rehearsal room.

## Not in part 1

Songs' notes, files, Guitar Pro and status (part 2). Sets (part 3). Comparing
two takes, loop and slow-down, links for people outside the band, letters
about new takes or comments (the chat has those), deleting a take from the
service by hand, uploading without РЭХА,
**Download all**, comping.

## Calls to review

1. A sign-in lasts a year from the last visit, so it runs out only for
   someone who stays away a year.
2. Alex adds members by address and makes РЭХА's keys on a **Members**
   page only he sees; a member shows “Has not confirmed the address yet” or
   “Has not signed in yet” until they have.
3. The sign-in page answers the same for any address, so it tells a
   stranger nothing about who is in the band.
4. **Send code** for an address in the band that Cloudflare has not had
   confirmed yet sends Cloudflare's letter again, with a line saying so;
   this covers Alex's own address the first time too. The letter goes again
   by taking the address off the list and adding it back: to be checked on
   the first real setup.
5. **Remove** on **Members** takes a member out of the band: no more codes,
   their sign-ins end, their stars and comments stay under their name.
6. The bot tells Alex of a failure on the server once an hour at most for
   the same failure.
7. A member can change their name later, at the bottom of the left column.
8. A take is new for you until you open it; there is no “mark all as seen”.
9. On a computer the service opens on **New**; with nothing new, on the song
   played last.
10. Songs are listed by their last take, not alphabetically.
11. Best take: most members' stars, newest on a tie; with none, the newest
    take.
12. M and S are per person and are not kept.
13. **Download tracks** is in part 1 (Claude offered it at 17:12, with no
    answer either way), as a link per file, not one zip.
14. A chat message takes additions for three hours, then a new one starts;
    marks from РЭХА are not posted on their own.
15. **I have a band service key** is the last line of the **Cloud folder**
    group; with a key, the group becomes **Sending takes**.
16. Each panel keeps its own settings.
17. The cloud folder's code moves into a `sending/` package beside the
    service's, behind the same calls, before the service is added.
18. A take's cloud button sends to the service with no dialog; on a sent
    take, a dialog with what is up and **Remove from the band service**.
19. For the service, РЭХА sends a fixed set: MP3, FLAC and MIDI, no choice.
20. No mix file: the browser mixes the tracks. With six tracks this saves a
    seventh of the MP3 space.
21. MP3s first, FLAC after; a take shows once its MP3s are up.
22. A take stays in the trash for 30 days; any member can restore it.
23. A take sent again from РЭХА comes out of the trash with its comments.
24. A crop that cuts the start moves the comments back; one in the cut part
    stays at 0:00, marked “In the part cut off”.
25. Parts of 10 MB; an upload unfinished for 7 days starts again.
26. Closing РЭХА while sending asks first, with its wording above.
27. Waveforms are made by РЭХА and sent with the take.
28. The pages are React with the design system's components, as on the
    site; the service's tests run in `checks.yml` with the rest.
29. The service goes live with a release, like the site.
30. The page is reha.stream/band-service, linked from РЭХА's key line and
    the footer, not the top menu.
31. The page has a story from Alex's band; its **Run your own** steps are
    the ones Alex follows for his own copy, so they are tried first.
32. What the service is and how to run your own stay on the site's page,
    not in the guide's new section.
33. The service's sending shows in the header's background work list and on
    the take's button, as the cloud folder's does; takes still to send are
    back in the list when РЭХА opens; with no internet a line waits rather
    than fails.
34. Letters come from an address set in the Worker's settings
    (band@reha.stream for Alex's copy).
35. Alex's Telegram id goes in the Worker's settings, and he sends the bot
    /start once, since a bot can write only to someone who wrote to it
    first.
36. In tests, letters go to a stand-in the tests read the code from.
37. better-auth keeps its count of sign-in tries in D1.
38. The site's **Run your own** says a band needs a domain of its own on
    Cloudflare, since the letters can only come from one; the workers.dev
    address alone is no longer enough.
39. A false start given a ★ or a mark goes on its own only in the
    rehearsal in progress. In an older rehearsal nothing goes on its own,
    as a change to the balance or the format already leaves them as they
    are.
40. A false start that is already in the cloud folder, sent before this
    rule, stays there and is kept up to date like any other copy.
