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
MME, DirectSound, WASAPI, WDM-KS, ASIO if the card has a driver — with the
same name each time. The list shows which is which, because otherwise it reads
as five copies of the same device. For multitrack, ASIO if the interface
offers it, otherwise WASAPI; MME is the default and the worst of them.

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
line: which device, and why. A device already held by another app at a
different rate is the usual reason; Audio MIDI Setup shows what it is running
at.

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
2. Reproduce it under `./run-debug.sh`. It runs with the allocator's own
   checks turned on, so the crash lands on the bad write rather than on an
   innocent allocation later. The resulting report names the culprit.

## Deliberately not done

- **Panning per track** — volume and mute/solo only.
- **A separate recording level** — only the listening volume is adjustable; it
  does not touch the files themselves, and should not.
- **Old rehearsals without `session.json`** — they will not appear in History
  (the file is written starting from the version that introduced History). The
  recordings themselves are untouched on disk.
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
- **Packaging into a .app** — for now it runs as `python3 app.py` in a venv.
