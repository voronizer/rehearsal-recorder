# Design notes

Decisions that are not obvious from the code, and the reasoning behind
them — including the ones that were wrong the first time. Written for
whoever touches this next, including me in six months.
## The three systems

This started as a macOS app and quietly stayed one for longer than it should
have. The differences now live in `platform_support.py` rather than scattered
through the code, because scattered is how it became macOS-only without anyone
noticing.

**Deleting.** Nothing is ever destroyed — that part is the same everywhere and
is the part worth promising. How it is not destroyed differs. With the
`send2trash` package installed (it is in requirements.txt) a delete goes to
the real Trash or Recycle Bin on all three systems. Without it, macOS and most
Linux desktops have a trash folder a plain move can reach; Windows does not,
and there the take moves into a `_deleted` folder inside the recordings
folder instead. The app knows which of those happened and the confirmation
says so — a dialog promising "the Trash" on a machine with no Trash is simply
a lie.

**The crash log.** `faulthandler.register` and SIGTRAP are Unix only. An
earlier version reached for `signal.SIGTRAP` unconditionally, which on Windows
raises before the window ever opens — the app would not have started at all.
It now asks for each piece before using it, and a diagnostic that cannot be
armed never stops the app.

**Compressing cloud copies.** No longer a difference at all: it was three
external programs, and is now one pip package that ships wheels for all three
systems. This is the one place where the platform-specific answer was simply
the wrong answer.

**Naming.** Windows refuses `\ / : * ? " < > |`, names ending in a dot or a
space, and the device names CON, PRN, AUX, NUL, COM1–9 and LPT1–9 whatever the
extension. Take and rehearsal names are sanitised for all of that everywhere,
not only on Windows, so a folder made on one machine opens on another.
Windows also stops at 260-character paths, and Settings warns when the
recordings folder is already close.

**Picking an interface.** On Windows one card appears once per audio system —
MME, DirectSound, WASAPI, WDM-KS, ASIO — with the same name each time and a
different number of channels. Settings therefore asks for the driver first and
then the device, as every audio program does; with one driver, as on a Mac,
only the device is asked. ASIO is there because `SD_ENABLE_ASIO` is set before
`sounddevice` is imported, which makes the pip wheel load its PortAudio built
with ASIO. It is on unconditionally: as a setting it would need a restart, and
as one entry in the driver list it needs nothing. For multitrack, ASIO if the
interface has a driver, otherwise WASAPI; MME is the default and the worst.

An ASIO driver is a COM object, and PortAudio loads it on the thread that
asks for the stream — which must have joined a COM apartment first. PortAudio
joins one for the thread that starts it and leaves every other thread to the
caller, and the interface's calls each arrive on a fresh thread that has
joined nothing. So every stream is opened, started, stopped and closed, and
every card asked what it can do, on one long-lived audio thread that joins a
single-threaded apartment before its first job (`AudioThread` in
`audio/devices.py`). `--audio-probe` opens through that thread too. It used
to open from the main thread, in blocking mode: it could never have seen the
difference, and Realtek's ASIO driver crashed under it.

Nothing waits on that thread for ever, with one exception. A call that takes
longer than fifteen seconds is given up on, and until the thread is free
again every other call is refused at once rather than run: PortAudio is not
safe to enter from two threads, and the stuck call is still inside it, so a
fresh thread in its place would be worse than none. A stream that opens after
its caller gave up is closed. A close is never refused or dropped, only
queued: whoever asked has already let go of the stream, and one left running
would go on calling into a player or a take nobody holds. The case all this
is for is stopping a take on a card that was just unplugged: the take is
finished whether or not the driver comes back. The exception is **Look
again**, which waits however long stopping and starting PortAudio takes —
given up on half-way, PortAudio would be left half torn down with the device
list read from under it.

An unplugged ASIO card has to be noticed by the app itself. The driver sends
a reset request, PortAudio ignores it, and the stream is never called again
while still reporting itself active, so `finished_callback` never fires. The
callback of every stream notes each call (`audio/heartbeat.py`), and three
seconds without one, outside a call, is a card that has gone: the take stops
and is kept, the signal check stops and says so, and the player pauses and
tries the card again on the next play. A call that takes long — a block a
slow disk is slow to take — is the app being busy, not the card gone. Nor is
the wait for the first block, for five seconds: a driver can take a couple
to start its card, and FlexASIO's first block came two seconds after the
stream started, which counted against three would have left one to spare.

Turning ASIO on moved every later device index, so a choice is saved as the
device's name and audio system beside its index and found again by those. An
index saved before that is not trusted on Windows: the person is asked to
choose again rather than recorded from the wrong card.

What none of this is: proof. There is no Windows machine in the environment
this was built in. `tests/test_platform.py` drives the code into each shape — no
recycle bin, no encoder, Windows naming rules — and checks it takes the right
branch, which is worth something but is not the same as having run it there.
The first Windows run will find things.

## Long work, and how far along it is

Four things take real time on a long take: a cloud copy (a mixdown and an
encode, or every track encoded), a crop (every track rewritten), a stop and a
recovery (every raw track wrapped as .wav). Each registers with one journal,
`activity.py`, and reports a fraction weighed by how much each part has to
get through, in frames — so a copy of the mix and eight tracks at 64% has
done 64% of the work, not "the fifth of nine". The interface polls it over
http like the meters, through one store (`ui/src/lib/activity.ts`) that feeds
the header of every screen, the corner notices for cloud results and each
screen's own progress line.

Cloud copies, by hand as well as automatic, run on the publishing thread and
never block a screen. Crop, stop and recover still run inside their bridge
call: what comes next needs them, and a take being rewritten must not be
played, cropped again or saved meanwhile. A screen left half-way lets them
finish; their result is in the list.

## Why the meters do not go through the bridge

pywebview starts a new OS thread for every call that crosses from JavaScript
into Python, and that thread then waits on the main thread to hand the answer
back. For a button press that costs nothing. The meters are not a button
press: they ask fourteen times a second while recording, the player asks eight
times a second while listening. Over a two-hour rehearsal that is on the order
of a hundred thousand threads created and destroyed, all of it going through
the main thread — which is also the thread WebKit draws on.

So the polling calls do not use the bridge. The app already runs a local
server for the interface and the audio; those five read-only calls
(`player_state`, `get_levels`, `monitor_levels`, `recording_health`,
`session_state`) are served from it as JSON at `/api/...`, and the interface
fetches them like any other web page would. Nothing that changes anything is
reachable that way — a GET must not be able to delete a rehearsal — and if the
interface is ever opened without the server, polling falls back to the bridge
on its own.

Commands still go over the bridge, which is where they belong: they are rare,
and they need to happen in order.

## The local server (why it exists)

`api.py` starts a small HTTP server on `127.0.0.1` on a random free port. It
serves two things: the interface itself (`ui/dist`) and the .wav files for the
player (`/media/...`). It is not reachable from outside the machine.

This is because WKWebView — the pywebview engine on macOS — will not load
audio from other folders on a page opened over `file://` (which is why the
player used to sit silently doing nothing), nor the ES modules the React
interface is built from. Windows uses WebView2 and Linux WebKitGTK, which are
less strict, but the server is simpler than having two ways in and it costs
nothing.

## When the playback device is not there

Device indices are not stable: unplug the interface, reboot, connect a pair of
headphones, and the number saved in the config points at something else. Used
blindly that produces `PaMacCore (AUHAL) Error ... err='-50'` in the console
and no sound, which tells nobody anything.

So the saved output is checked before it is opened — does it exist, does it
have a stereo output, will it take the take's sample rate. If any of that
fails, playback falls back to the system output and the player says so in one
line: which device, and why.

The line used to say the same thing whatever went wrong — that the card would
not take the rate, and that Audio MIDI Setup would show what was holding it,
which is a program only macOS has. The reason is read off PortAudio's error
code now. `paDeviceUnavailable` is not about the rate at all: it means
something already has the card, and on ASIO that is routinely this app's own
recording, since a card reached through ASIO plays through one program at a
time. `paInvalidSampleRate` keeps the old sentence, pointed at whatever this
system actually has. Anything else quotes the driver rather than guessing.

An ASIO card is not asked in advance at all. PortAudio answers that question
by loading the driver, initialising it and unloading it again — a full cycle,
on every take, in front of an opening that is about to load it once more — and
the answer is no better than the opening's: while our own recording holds the
driver, the question comes back "unavailable" whatever the rate. So the
opening decides, and a refusal there falls back to the system output the same
way the check used to.

## If it crashes

There is one known crash, seen once on macOS 26.6: the process dies with
`BUG IN CLIENT OF LIBMALLOC: memory corruption of free block`. That message
means the system allocator found its own bookkeeping overwritten. It aborts at
the next allocation, on whichever thread happens to be allocating — in that
report an HTTP request thread that was merely importing a module. That thread
is the victim, not the cause.

Nothing written in Python can corrupt a heap. The code that can is underneath:
PortAudio (through sounddevice), numpy, or PyObjC/WebKit. macOS 26 also ships
a new allocator, which checks far more aggressively than the old one, so the
same code may have been getting away with it on earlier systems. Which of
those it was cannot be told from a single report, and guessing would be
worthless.

One concrete race has since been found and fixed, and it is a candidate for
the corruption above: opening and closing a player could overlap. Calls from
the interface arrive on their own threads, and two of them in the player at
once would pass a `is not None` check and then find the stream already gone —
visible in the console as `[player] close: 'NoneType' object has no attribute
'close'`. Underneath that Python symptom, PortAudio was being asked to open
and close streams from two threads at the same time, which it does not
support. Every stream in the app is now created and destroyed under one lock,
and the player's lifecycle is serialised on the API side as well.

A second finding, from the crash log this time: pywebview starts a fresh OS
thread for every call from the interface into Python. With the meters polling
fourteen times a second, a rehearsal was creating and destroying tens of
thousands of threads, every one of them routed through the main thread. That
is an enormous amount of allocator traffic for no benefit, and it is now gone
— see "Why the meters do not go through the bridge" below. Whether it was the
cause of the corruption is still not proven; it was worth removing either way.

What else has been done: the audio callbacks no longer allocate at all.
They reuse preallocated buffers, measure peaks with scalar comparisons instead
of temporary arrays, and never print. That is correct practice for a realtime
thread regardless, and it takes this app's own code out of the list of
suspects. Stopping a take twice is now harmless too, which it was not.

What to do if it happens again:

1. `~/.rehearsal-recorder/crash.log` now holds a Python traceback for every
   thread at the moment of the crash — that says what this app was doing,
   which the native report does not.
2. Reproduce it under `packaging/run-debug.sh`. It runs with the allocator's own
   checks turned on, so the crash lands on the bad write rather than on an
   innocent allocation later. The resulting report names the culprit.

## The history database

Every rehearsal, take, marker and cloud copy lives in one SQLite database,
`library.sqlite`, at the top of the recordings folder — `store/` has the
models, the migrations and the code that reads and writes it.

**It sits in the recordings folder, not in `~/.rehearsal-recorder`.** The
recordings folder is the thing that actually gets moved — onto another drive,
a new computer, or copied to a NAS as a backup — and the history has to go
with it or it stops meaning anything. Putting it next to the audio it
describes means moving the folder is still just moving the folder, with the
app closed.

What that costs: the recordings folder now belongs to one computer at a time
and has to be on a local disk. The database is written while the app runs,
in WAL mode, and WAL needs shared memory that a network filesystem does not
provide; a sync client can upload `library.sqlite` without its `-wal` file,
or make conflicting copies of it; and two machines on one synced folder each
keep a history the other never sees. The recordings folder was never the
thing to sync — the cloud folder is — so `using-it.md` says to keep it on the
computer's own disk and to move it with the app closed.

**One file, not one per rehearsal.** Before this, every rehearsal wrote its
own `session.json`, and building History meant opening every one of them.
That is a directory listing and N file reads for something that should be one
query, and it only gets slower as the folder fills up with years of
rehearsals. A shared database also lets rehearsals refer to a single settled
schema instead of each file guessing at whatever the app looked like the day
it was written.

**Paths inside it are relative, not absolute.** A rehearsal's folder is
relative to the recordings folder, a take's files to the rehearsal folder, and
a cloud copy to the cloud folder. Renaming or moving any of the three moves
everything that points into it without touching a row — a rename is one
`UPDATE`, not a rewrite of every path it contains.

**Settings stayed JSON.** `config.json` is a flat set of keys, each with a
default, and it holds `recordings_dir` — the setting that says where the
database is, so it cannot itself live inside that database. It changed only
once, from a device index to a name and audio system, and that was handled in
code (`saved_device`) without needing a migration; there has been nothing
here that a schema would have bought.

**Songs are still not stored.** They are derived from take names by
`_songs_of` — "Verse riff 3" counts as a third go at "Verse riff" — and that
is a rule, not a fact. Storing its output would just be a second copy that
could disagree with the names themselves.

**Import runs on every open, not once.** A rehearsal folder copied in from a
machine still on an older version brings its `session.json` with it, and
that folder needs picking up the first time *this* recordings folder sees it,
whichever open that is — not only the very first time the app runs.

Every connection also turns on `PRAGMA foreign_keys` and WAL, and its "begin"
hook emits `BEGIN IMMEDIATE` rather than SQLite's default deferred begin: a
transaction takes the write lock the moment it starts, so the interface
thread and the publishing thread wait for each other instead of one of them
failing with "database is locked" after doing some of its work.

## The player

**Python plays the audio, not the browser** (`audio/player.py`). The reason
was choosing the output device: a web page switches output with `setSinkId`,
and WebKit does not offer it for `AudioContext`. It also removed the memory
ceiling and the split between two playback modes.

- All tracks are mixed into one stream from one position, so they cannot
  drift apart.
- Tracks are read through `memmap`: the system pages in what is needed, so a
  twenty-minute take costs no more memory than a three-minute one, and
  seeking is a change of index.
- Volume, mute and solo are applied with a short ramp on the coefficient;
  without it, switching clicks.
- The waveform is computed in Python (`audio/waveform.py`, numpy) and arrives
  as peaks. When zoomed in, the peaks are fetched again for the part on
  screen.

**One surface for seeking and selecting.** A press on the lanes that does not
travel is a click and seeks; one that travels draws the repeat region. The
region's edges are grabbed on the ruler, not in the lanes, so a press in the
lanes always starts a new region, even exactly where the old one ended. The
playhead has its own grip on the ruler for scrubbing. There used to be A and
B buttons that put an edge at the playback position, the only way to place
one to a tenth of a second; once the timeline could zoom, a drag was finer
than that, and they went. Zoom stops at two seconds across the screen: closer
than that is detail nobody looks for, and the gesture turns twitchy.

**Nothing is open when a rehearsal opens.** No audio file is read until
someone picks a take; until then the space shows the overview.

**Markers on a take that has no folder yet.** The review screen offers
markers, but the take is still a draft with nowhere on disk to write them.
They are held in the screen and passed along when the take is saved, and
dropped with it when it is discarded.

**Crop is refused** for a region under a second, which is far more likely a
slip of the mouse than an intention, and for one covering the whole take.
Both grey the button out, which is why the guide mentions them: a greyed-out
button beside a region just drawn otherwise looks broken.

**Renaming a take moves its files**, so the player reopens it from the start.

## Asking a card what it can do

The rates and depths offered are the ones the card accepts, asked before the
choice is shown rather than found out when it fails. ASIO answers about the
rate and says nothing about the depth, so a rate it takes is offered at both
depths — and it is asked once per rate, not once per combination, because
each question loads and unloads the driver in full.

A card can also refuse to answer at all, and the screen says so. It used to
fall back to the usual three rates in silence, so a card that said nothing
looked like one that said yes to everything: an XR18, which has no 96 kHz
and takes only the rate its own mixer is set to, was offered all three. A
saved choice that stops being possible — another card, another setup — is
replaced by one that works, instead of failing when everyone is ready to
play.

**When a card will not work, the window asks it why.** Settings › Under the
hood's Check the interface is `--audio-probe` for someone at a rehearsal
with no command line: the same attempts, from `probe.plan_for`, run by
`probe.InterfaceCheck` on a thread of its own and read by the page as they
come in. It never runs beside a take, and it takes the card from the signal
check if that has it: an ASIO card is one stream's at a time, and the check
opening it beside another would find the other one, not the fault. Stop
waits for the attempt under way, because a driver closed halfway through
opening is worse than a few seconds. The page's Copy details puts what the
page says, the band on the card's inputs and the last check on the
clipboard as plain lines: a report worth having is one that is actually
sent, and one step is what gets it sent.

## Cloud copies

Converting goes through libsndfile, via the `soundfile` package, which comes
as a prebuilt wheel of about a megabyte on macOS, Windows and Linux.

The first version called `afconvert` instead, on the reasoning that another
native audio library was a risk after this project had already had one
memory fault. That was applied too widely: `afconvert` exists only on macOS,
so the feature did nothing on Windows, and the fault it guarded against was
in the recording path, where a realtime callback runs and a crash costs a
take. Converting runs afterwards, on a copy, in an ordinary call.

- Files are converted a block at a time, so a long eight-track take does not
  have to fit in memory. Without `soundfile` a copy stays WAV and Settings
  says so. That FLAC round-trips bit for bit at both depths is checked by the
  test suite.
- MP3 is variable bitrate: around 320 kbps for a stereo mix and 128 for a
  mono track, the same quality per channel.
- The mix is written 16-bit, because it is what gets sent to people and every
  phone plays it. If the tracks would clip when summed, the level is pulled
  down, and by how much is recorded.
- A copy remembers what it was made from: the take's name, what was sent,
  the format, the balance and the folder. A new balance or format sends the
  takes of the rehearsal in progress again; nothing else is mixed twice.
- A copy follows its take, whatever sent it. Sending on its own decides what
  goes up, not what becomes of what is there — that was the first version's
  mistake: a rename was "send it again", so with the setting off, or for a
  rehearsal already finished, nothing happened and the cloud kept the old
  name; with it on, every take was mixed again and the emptied folder left
  behind, and a take sent by hand as its tracks too came back as a mix alone.
  Now a rename moves the files and rewrites their record, a crop makes the
  copy again in the shape it had, a delete takes it to the Trash, and a
  rehearsal's folder in the cloud goes once it is empty. What cannot simply
  be moved — a copy being made at that moment, one not where its record says
  — is made again instead.
- Folders earlier versions emptied and left are swept at start and when a
  cloud folder is chosen: only empty ones, named the way the app names a
  rehearsal's folder, straight inside the cloud folder. The rest of it is the
  band's.
- Automatic copies wait while a take records: mixing is not something to
  start competing with the sound card.
- The recording itself stays WAV. It is the one thing here that cannot be
  made again, and disk is cheap.

## Screens and keys

**Settings is four groups** — Audio, Folders, Appearance, Under the hood —
because six sections stacked in one column was a wall nobody could scan. The
track layout is not repeated there: it is edited where it is defined, on the
setup screen. The interface and the quality are the opposite case: they
belong to the room and the card, so they are set once in Settings and the
setup screen only shows them.

**The recording screen is read from across the room.** Nobody stands at the
laptop while they play, so it is a big clock, one line and a tile per track
rather than a column of meters with figures on them. A clip is kept on that
line for a minute, because the person who would act on it was playing, not
watching, when it happened. Silence only dims a tile: a singer between
verses is silent, and an alarm for that would soon be ignored along with the
real ones. Every tile is one width, a stereo one split down the middle, so
the sixteen inputs of an XR18 still fit in one row. Two other layouts were
drawn and dropped: a waveform per track growing as it records, which cannot
be read from behind the kit, and markers dropped with a key during the take,
which nobody would press while playing.

**History measures a rehearsal's size by walking its folder**, not from the
durations, so it is the number the file manager gives.

**A key is shown on a button only while the key presses it.** With a take
open, Space plays the take rather than recording, so Record take stops
showing it; Escape closes the take first, so Finish does too.

**Where Escape's next step is a decision, it asks.** Finishing a rehearsal
that has takes asks, because doing it by accident puts the rest of the
evening in a second folder; an empty rehearsal does not, since there is
nothing to protect and Python removes its folder anyway. The review screen
asks before discarding: that take was played seconds ago and cannot be
played again. The buttons themselves do not ask, because pressing a labelled
button is not an accident. Escape never stops a recording.

## Theme and scale

The theme and the scale are stored twice. The real copy is in `config.json`
with the other settings; a copy in localStorage lets the page apply them
before its first paint, while the bridge to Python is still coming up, so
somebody who chose light does not see a dark window for a moment. When the
two disagree, the Python config wins.

The scale sets the root font size, and the layout is in rem, so padding,
buttons and the waveform grow with the text.

## Deliberately not done

- **Panning per track** — volume and mute/solo only.
- **A separate recording level** — only the listening volume is adjustable; it
  does not touch the files themselves, and should not.
- **Folders with no entry in the database** — a folder copied into the
  recordings folder without a `session.json` (or already imported, with
  nothing left to import) does not appear in History; nothing scans the
  recordings folder for loose audio looking for one. The recordings
  themselves are untouched on disk.
- **Compressed recording** — libsndfile is now in the app, so writing FLAC
  straight from the recorder is no longer far-fetched. It is still not done,
  for one reason: the crash-safe design writes raw bytes continuously and
  wraps them in a header at the end, which is what lets a take survive the app
  dying mid-recording. A FLAC stream cut off mid-frame does not recover that
  way. Halving the disk is not worth trading that for. The copies that go to
  the cloud are compressed instead, where nothing is at stake.
- **32-bit float recording** — some interfaces offer it and it does make
  clipping impossible, but it is 2× the disk of 16-bit for a problem 24 bits
  already solves in practice.
- **Proof that Windows works** — the code no longer assumes macOS anywhere
  (see "The three systems"), and every branch is exercised by
  `tests/test_platform.py`, but it has never been run on Windows. Taking the
  branch correctly is not the same as working.
- **Packaging into a .app** — for now it runs as `python3 -m rehearsal_recorder` in a venv.
