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

Turning ASIO on moved every later device index, so a choice is saved as the
device's name and audio system beside its index and found again by those. An
index saved before that is not trusted on Windows: the person is asked to
choose again rather than recorded from the wrong card.

What none of this is: proof. There is no Windows machine in the environment
this was built in. `tests/test_platform.py` drives the code into each shape — no
recycle bin, no encoder, Windows naming rules — and checks it takes the right
branch, which is worth something but is not the same as having run it there.
The first Windows run will find things.

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
