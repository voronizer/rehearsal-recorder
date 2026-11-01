# The band's service, part 2: a home for the band

Part 2 gives the service the look and the parts Alex asked for on
1 November: sections down the left, one player at the bottom, a panel from
the right for a take or a song, songs with a status, key, notes and files,
and marks with the band's comments under them. It is drawn the way РЭХА
draws its History.

The clickable prototype is https://claude.ai/artifact/6CmaPVRS6m8BqvanGjv3g5
(v34; source in `service/mock/`, copy in
/mnt/project-files/band-service/look/mock/). Every answer behind it, with its
time, is in /mnt/project-files/band-service/look/decisions-log.md. Where this
spec and the prototype differ, this spec wins; each such place is said
below.

This spec waits for Alex's «ок».

## Alex's picks

All on 1 November 2026, in the thread «Сделать сервис для своей группы».

- 14:51 The look of the whole service comes first, the player (#94) after.
- 14:56 Sections down the left: Home, Rehearsals, Songs, Marks, Members,
  Trash. Home is an overview.
- 15:06-15:09 Home: songs with their best take, new takes shown inside each
  song; the band's favourites on the right.
- 15:12, 15:15 Bold only for headings and the band's name.
- 15:18 What the concept gives a song is planned now: status, key, tempo
  from РЭХА, length, notes, files; a song can exist before its first take.
- 15:21 Rehearsals and Songs are each a list; an item opens its own page.
- 15:26 Songs is a table grouped by status.
- 15:29 A song's page: the best take on top; notes and files in a row; all
  takes by rehearsal below.
- 15:32 Rehearsals is a table (date, songs, takes as РЭХА's bars, starred,
  marks), by month.
- 15:43 Principle: a take's and a song's main actions happen where they
  appear. Their own page is only for close work.
- 15:47 A take opens in a panel at the right; the list stays.
- 15:51 The song panel shows it all at once: status, key, tempo, length,
  best take, notes, files.
- 15:59, 16:46 Marks sit on a moment. There are no comments on their own:
  a mark has a label, a colour and a note, and the band comments under it.
- 16:06 Marks look as РЭХА draws them.
- 16:26 The panel is a drawer the full height of the window.
- 16:31 The panel shows where the playhead is, and a mark goes there.
- 16:37 One player: ▶ in a list, in the panel and in the bar at the bottom
  start and stop the same playing.
- 16:39 The bar at the bottom has **Mark**.
- 17:00, 17:01 A panel's way to the full page is a button in its head,
  beside ✕ (**Song's page ›**, **Take's page ›**).
- 17:04 In lists a mark's label is told by its colour, not its name. The
  band's label editor is **Labels** on Marks, like РЭХА's Settings › Marks.
- 17:12 Home lists the latest marks: set or commented on most recently.
- 17:19 Marks are grouped by song.
- 17:21 Every member sees Members as names; addresses, buttons and keys are
  Alex's alone.
- 17:24 Alex sets the band's name and picture on Members; with no picture,
  the logo is the name's first letter.
- 17:31 On a phone, ☰ on the top line opens the sections.
- 17:34 A mark from РЭХА whose label name the band has not got adds that
  label, with РЭХА's colour. A label renamed here still catches marks РЭХА
  sends under its old name. РЭХА itself does not change.
- 17:36 reha.stream keeps the band-service page's chapters with new
  pictures; the chapter on comments becomes one on marks; a new chapter on
  label colours. He sees it before merge.
- 17:40 The take's page: player, tracks and downloads on the left, marks
  on the right.
- 17:45 Trash, “Not named” takes, sign-in and your name as part 1 has them,
  in the new frame.
- 17:58 A Guitar Pro file is downloaded, not played (playing it: #101).
- 18:03 **Sign out everywhere**, seeking on the bar, editing and deleting
  your own marks and comments.
- 18:43 The prototype is built from РЭХА's own components, so it is easy
  to make real.
- 19:01 Groups fold where a list grows long or is seldom needed.
- 19:14 The look is РЭХА's History: “there it came out light and pleasant”.
- 19:30 A take stops being new for you when you open it or play it.
- 19:31 Before anything arrives, the owner's Home lists four steps.
- 19:36 One PR for everything below.

## What the band sees

Text in the service is English, in РЭХА's words: take, rehearsal, song,
mark, label.

### The frame

A column down the left on РЭХА's panel ground: the band's logo and name,
how many members it has, then the sections **Home**, **Rehearsals**,
**Songs**, **Marks** (with how many marks are open), **Members**, **Trash**.
At its bottom, your name; pressing it gives **Change your name** and
**Sign out**.

Along the bottom, the player: ▶, the take that is in it and its day, the
time, a line of where it is (press to move there), the take's length,
**Mark** and your ★ with the count. **Mark** opens the playing take's panel
with a new mark at the moment the button was pressed. The bar shows once
the band has a take.

Pressing a take's bar in any list, or its name, opens the take's panel; a
song's name opens the song's panel. The panel comes from the right, the
full height above the player, 28 rem wide, with no veil, so the page under
it stays live. ✕ or Esc closes it, and so does moving to another section.

### Home

Under the title, a line: “6 takes you have not heard yet · 2 new marks”,
or “You have heard every take.”

On the left, **Songs**: every song with takes, the most recently played
first. A song is its title, a grey line (“12 takes · last Thu 29 Oct ·
3 not heard yet”), and its best take as a row. “3 not heard yet” opens the
first of them. On the right, **Latest marks**: five marks, the one set or
commented on most recently first, each with its take, who and when, and
its latest comment. Under them, **The band's favourites**: takes with stars
from at least two members.

Before the band has anything, Alex sees four steps, each with a tick once
done and a button that takes him there: name the band, make a key for
РЭХА, add the band, record a rehearsal. A member sees one line saying the
takes come here from РЭХА after a rehearsal. Rehearsals, Songs and Marks
say the same in their own words while empty.

### Rehearsals

A table by month, newest first, the month a fold: date, the songs played,
the takes as РЭХА's small bars (height by length, green when starred), how
many takes were starred, how many marks. A dot marks a rehearsal with a
take you have not heard. A row opens the rehearsal's page.

A rehearsal's page: back to Rehearsals, the day as its title, “9 takes ·
3 songs · 37:05 recorded”. Then its takes by song, each song a fold with
**The song** at its right (opens the song's panel). Takes nobody named a
song are under **Not named**, last. Each take is a row, with its marks
under it as lines.

### Songs

**Statuses** and **New song** at the top right. A table grouped by status,
in the statuses' order, each group a fold; the last status starts folded.
Columns: song, key, tempo, length, takes, last played, best take (▶, its
number, why it is the best). A dot marks a song with a take you have not
heard. Every song has a status. Takes nobody named are in **Not named** at
the end. A row opens the song's panel.

The song's panel: the title, **Song's page ›** and ✕. Then:

- the status, a menu of the band's statuses with **Edit statuses** at its
  bottom; the key, one of 24 or “Not set”; the tempo, “from РЭХА”; the
  length, the best take's;
- **Best take**, with why (“most stars”, or “latest, no stars yet”);
- **Notes**: the text, **Edit notes**, then a box with **Save notes** and
  **Cancel**;
- **Files**: each with its kind, name and what pressing it does, and ✕
  (asks first); **Add a file**.

A Guitar Pro file downloads to open in Guitar Pro. A PDF or a picture opens
in a new tab. Anything else downloads.

The song's page: back to Songs, the title with its status menu, a grey line
(“E minor · 120 bpm · 4:05 · 12 takes on 4 rehearsals”). Then **Best take**
with its marks under it, **Notes** and **Files** side by side, and
**All takes**, a fold per rehearsal, the newest open.

**New song** opens a panel with the title. A title the band already has, in
any case, is refused with “There is already a song called “Zorka”.” A new
song gets the first status and opens in its panel. A song with no takes has
⋯ › **Delete song**, which asks first. A song with takes cannot be deleted;
its title comes from РЭХА, so it has no **Rename** either.

**Statuses** opens a panel like the Labels one: rename (the songs follow),
drag to change the order, **New status**, delete. Deleting a status some
songs have asks which status they move to. The band starts with Learning,
Ready, Archive.

### A take

Every list draws a take as РЭХА's rehearsal overview does: ▶, a bar as
long as the take ran (the longest take of the band fills 88 % of the row),
its marks as ticks in their colours, the take's name with its number a
shade lighter (“Viasna 12”), a green edge when a member starred it, the
played part washed blue. Then its length, a dot if you have not heard it,
and your ★ with the count. Who starred shows on the take's panel and page,
and in a tooltip on the count.

The take's panel: the name, your ★ and the first letters of who starred,
**Take's page ›**, ✕. Then the take's wave with the marks on it and the
playhead (press to play from there), with ▶ and the time under it.
**Tracks**, folded: a lane per track with M and S. **Marks**, with
**Add a mark at 1:14** following the playhead.

The take's page: back to its song (or to Songs for one not named), the name,
**★ at rehearsal** when it was starred in РЭХА, who starred, “Thursday,
29 October · 4:05 · 4 tracks”. On the left the player, **Tracks** and
**Download tracks** (FLAC per track, `.mid` where the track recorded MIDI);
on the right **Marks**. A take in the Trash says so with **Restore**.

РЭХА's own player, with its timeline, a wave per track and zoom, comes to
this page with #94.

### Marks

A mark is a moment of a take with a label and a note. It comes from РЭХА
with the take, or a member sets it here. The band comments under it. Once
the place is fixed, anyone closes it; a closed mark is dimmed and can be
opened again.

A mark is drawn as РЭХА's mark line: the label's dot, the time, the note
(the label's name, grey, when there is no note). Under it, grey: the take
where the line is away from it, who set it (“Set in РЭХА” for one from
РЭХА) and when. Then its comments, “Ivan: Keep it.”, and **Comment** and
**Close**. Pressing the time plays from there.

**Add a mark at 1:14** opens a box: the label from a list with each
label's dot, the note on the same line, **Add mark** and **Cancel**. The
first label is chosen. Your own mark has **Edit** (label and note) and
**Delete**, which asks first and says how many comments go with it. Your
own comment has **Edit** and **Delete**. A mark from РЭХА has neither: it
follows РЭХА.

The Marks section: **Labels** at the top right, a switch **Open · Closed ·
All** with counts, and the marks grouped by song, each song a fold.

**Labels** opens a panel like РЭХА's Settings › Marks: each label with its
colour (РЭХА's eight), its name to edit in place, how many marks it has, a
grip to drag it, and delete. Deleting a label with marks asks which label
they get instead. **New label** adds one. The band starts with РЭХА's four:
Note, Keep this, Went wrong, Do again.

A mark that arrives from РЭХА carries its label's name and colour. If the
band has a label of that name, or had one by that name before a rename
here, the mark gets it, whatever colour РЭХА sent. Otherwise a new label
is added at the end with РЭХА's colour.

### Members

Everyone sees **People**: each member's letter and name, “· you” on their
own. Alex also sees addresses, “Has not confirmed the address yet”, and ⋯
with **Sign out everywhere** and **Remove** (asks first), as in part 1.

Alex alone sees **The band** at the top: the name field and **Add a
picture**, and below People **Add a member** and **Keys for РЭХА** (a fold,
closed once a key exists).

### Trash

As in part 1, in the new frame: a take removed in РЭХА waits 30 days, then
goes for good. Each row has ▶, the take, “Thu 29 Oct · removed in РЭХА
Fri 30 Oct · deleted for good in 28 days” and **Restore**.

### Signing in and your name

As part 1: address, **Send code**, six digits, **Sign in**, then “What should
the band call you?” the first time. The card shows the band's picture and
name. **Sign out** under your name is new: it ends this sign-in only.

### What is new for you

A take is new for you until you open it (its panel or page) or play it.
Its marks stop being new with it. A mark set or commented on after you
heard its take is new until you open that take again. Dots on takes, songs
and rehearsals, Home's line and “not heard yet” all follow this.

### On a phone

Below 500 px: a top line with ☰, the logo and the band's name; ☰ opens the
sections over the page. The player is a thin line of where the take is,
▶, the take, the time and **Mark**. A panel fills the screen. Tables become
two-line lists. Pages have no card, only the lines between their parts.

### In the band's chat

As part 1, with marks in place of comments. A member's first mark on a
take starts a message, and their next marks on that take are added to it:

> Ira on Viasna 12: 1:42 “The bridge drags here”, 2:58 “Fill too long?”

A comment under a mark goes the same way, one message per person and mark:

> Ivan on Viasna 12 at 2:58: “Keep it. I'll start it two bars later.”

Marks from РЭХА are still not posted on their own.

### The look

РЭХА's History, with РЭХА's tokens and components (`ui/src`). Text is 14 px,
page titles 20 px, group headings 14 px semibold with a grey count. On a
page the groups are one card with a line between them; in a panel, the
parts and lines alone. Rows have no box: a row lights up under the pointer.
Waves are only in the player. Light and dark follow the viewer's system, as
in part 1.

## What РЭХА does

РЭХА sends a song's tempo with each take. The take's meta gets `tempo`: the
song's beats per minute as РЭХА keeps it (`library.tempo_for`), or `null`
when the song has none. The service sets the song's tempo from the newest
take that carries the field. A take from an older РЭХА has no `tempo`, and
the song keeps what it had.

Nothing else changes in РЭХА. The guide's chapter on the band service says
“marks” where it said “comments”, and shows nothing new.

## On reha.stream

The band-service page keeps its chapters. `npm run pictures` in `service/`
retakes every picture from the new screens with its own seed band. The
chapter “Point at the second” becomes a mark at 1:42 with the band's talk
under it. A new chapter says what a mark's colour tells the band: what to
keep, what went wrong, what to do again. Alex sees the page before merge.

## How it is built

### Data

One migration, `0001`, after part 1's `0000_first`.

- `band`: one row, the band's name and the key of its picture in R2.
- `label`: id, name, colour (РЭХА's colour names), position, and `was`, the
  names it had before a rename here. Starts with РЭХА's four.
- `status`: id, name, position. Starts with Learning, Ready, Archive.
- `song` gains `status_id` (every song gets the first status), `key`
  (text or null), `tempo` (number or null), `notes` (text), `created_at`.
- `song_file`: id, song, name, kind, size, the R2 key, who added it, when.
- `comment` stays the one table of marks and comments: a row with no
  parent is a mark, a row with a parent is a comment under it. It gains
  `label_id`, `updated_at`; `label` and `colour` go once copied. `closed`
  belongs to the mark.

### Part 1's comments and marks

What is already in the service moves over in the migration:

- a mark from РЭХА gets the label of its name (made with its colour if the
  band has none yet);
- a member's comment with no parent becomes a mark with the label Note and
  the comment's text as its note;
- a reply becomes a comment under that mark;
- `closed` stays where it was.

### Files

A song's files go to R2 through the worker, up to 50 MB each, one at a
time, under `songs/<song id>/<file id>`. The band's picture is one file
under `band/picture`, up to 5 MB, PNG, JPEG or WebP. Both are served to
signed-in members only, as the takes' files are.

### API

The worker gets routes for: Home's lists; the rehearsals and a rehearsal;
the songs table; a song (read, change status, key and notes, make, delete);
a song's files; statuses and labels (list, add, rename, order, delete with
where the marks or songs go); marks (list with open, closed or all; add,
edit, delete, close, open); comments under a mark (add, edit, delete); the
band (name, picture). Members, keys, stars, seen and trash keep part 1's
routes; seen is also sent when you play a take. Every change checks who
may make it: Alex for the band, members and keys; the writer for their own
mark or comment; any member for the rest.

### The pages

The pages are rebuilt in `service/src` on the prototype's structure, a
module per section (`home/`, `rehearsals/`, `songs/`, `marks/`,
`members/`, `trash/`, `takes/`, `shell/`). They use РЭХА's components and
lib from `ui/src` as the prototype does: the take bar's fills and mark
ticks, the mark dot, the play button, folds, menus, lists. The player of
part 1 (`takes/player/`) stays and becomes the one player of the frame.

The prototype's code is not shipped: `service/mock/` leaves the branch
before the PR, and stays in project files.

### Tests

The worker's tests cover the migration (part 1's rows in, the new shape
out), labels from РЭХА (known name, old name, new name), statuses and
labels deleted with their songs and marks moved, who may change what, the
tempo field, and song files. The browser tests walk the band through the
frame, a take in the panel, a mark with a comment, a song's status, key,
notes and a file, the Marks switch, Members as a member and as Alex, and
the phone menu. РЭХА's tests check the tempo in the take's meta. While
building, only the tests a change touches run, once each; the full suites
run once on CI.

## Not in part 2

РЭХА's player on the take's page (#94). Playing Guitar Pro here (#101).
Sets. A stretch of a take rather than a moment. Marks going back to РЭХА.
Renaming or merging a song in the service. Letters about new takes or
marks. Folds that remember being folded.

## Calls to review

1. One player: opening a take's panel does not put it in the player; only
   ▶ or a press on a wave does, so you can read one take while another
   plays (16:37).
2. The panel has no veil; it covers the right of the page, not the player.
3. **Mark** in the bar fixes the moment when pressed; the player keeps
   playing.
4. A new mark gets the first label.
5. A mark's note is shown whole, not cut, because the band discusses it.
6. Only the writer edits or deletes a mark or comment, Alex too. Deleting
   a mark takes its comments.
7. Anyone in the band closes or opens a mark, and edits a song's status,
   key, notes, files and the statuses and labels.
8. One label list for the whole band; the editor lives on Marks.
9. Statuses live only in the service; РЭХА has none.
10. The tempo is not edited in the service; it follows РЭХА.
11. The best take is part 1's rule: most members' stars, newest on a tie,
    newest with none. ★ at rehearsal does not count.
12. Favourites are takes with stars from at least two members.
13. Latest marks: five, closed ones included and dimmed.
14. “3 not heard yet” opens the first take not heard.
15. The take's number is a shade lighter after the song's title, as РЭХА
    writes it. This replaces the grey pill picked at 17:18, after the look
    moved to РЭХА's at 19:14.
16. A take's bar is green-edged when any member starred it.
17. Which groups fold and which start folded (Rehearsals' month, a
    rehearsal's songs and Marks' songs open; a song's older rehearsals,
    the last status and Tracks in the panel folded; Keys for РЭХА folded
    once a key exists).
18. Part 1's comments become Note marks; replies become their comments.
19. **Sign out** for yourself is new.
20. Files up to 50 MB, the band's picture up to 5 MB.
21. A Guitar Pro file downloads; a PDF or picture opens in a new tab.
22. A mark set or commented on after you heard its take is new for you
    until you open that take again.
23. The prototype's Latest marks leave out closed marks and show them all;
    the build follows item 13.
