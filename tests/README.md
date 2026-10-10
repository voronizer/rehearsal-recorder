# Tests

```bash
python tests/run_all.py              # the Python suites
cd ui && npm test                    # the interface, what needs no browser
cd ui && npm run build && npm run test:e2e   # the interface in a browser
```

Five Python suites and two for the interface, because they answer different
questions.

## test_engine.py — the audio

Mixing, seeking, A–B looping, disk estimates, crash recovery (a crashed take
that was recording notes comes back with a `.mid` too), take naming, renaming,
markers, both bit depths, compressing cloud copies, the notes going to the
cloud with the original tracks (each `.mid` as it is, never encoded, left out
of the mix, sent again after a crop), and the notes the player is sent for a
take (`take_notes`: a drum grid by the band's icon, a missing file or one that
cannot be read answered with an error while the others answer). The MIDI
ports before a take run here too, through the Api on a fake port system: the
signal check opens them (a band of nothing but MIDI is checked all the same),
Start keeps what the check had open and opens what the final tracks say,
Finish and closing the app let them go, and Under the hood and Copy details
say what MIDI there is. A take with notes runs here as well, driven by the
recorder's own callback and a fake port system: Start gives the card only the
tracks that record sound (a MIDI track has no input) and begins the notes on
the audio's clock, Stop stops the audio and then makes the `.mid` files and
says which tracks have none, Keep and Recover move them beside the WAVs (Keep
finds any `.mid` it is not told of, and a recovered track's audio and notes
come back under its name), everything or nothing when a file will not move, a
`.midraw` the disk would not let become a `.mid` is moved with the take rather
than thrown away with the drafts, no take or check begins while a Stop is
still saving, a kit pulled mid-take costs the take nothing, and a rig that
fails costs it no audio. A take's notes follow its
files: renaming a take, merging its song and the pass that puts names right
move the `.mid` files with the folder (a take of nothing but notes, which has
no `.wav` to find its folder by, included, and an unconverted `.midraw` goes
along), deleting finds the folder through them, and cropping cuts them with
the audio, a draft's too, with the originals of both kinds put aside together
and put back together when a move fails, when the new `.mid` cannot take its
name or when one cannot be read. An unconverted `.midraw`, with its clock and
its record, goes aside with the originals, and the cropped take keeps none.

No sound card and no browser: `sounddevice` is replaced by a stub before
anything imports it, the renderer is called directly, and the samples that
come out are inspected. That is why FLAC being lossless is a fact here rather
than a claim — the bytes are compared.

## test_platform.py — the three systems

Only one operating system is ever present, so the code is driven into each
shape deliberately: no recycle bin, no encoder, Windows naming rules, a path
near the 260-character limit.

This proves the code takes the right branch, not that the branch works where
it runs: only the system itself shows that. CI runs the Python suites on
macOS and on Windows for exactly that reason — it used to run them on Linux,
where a check about a filesystem that ignores case had nothing to catch and
skipped itself for weeks.

## test_store.py — the history database

The schema, the migrations and the move of every old `session.json` into the
database. The migrations run for real on SQLite, the way the app runs them at
start, and a chain of test-only migrations stands in for the ones later
versions will add — so the backup taken first, and the rollback when one
fails halfway, are checked before there is a second real migration to need
them.

## test_ports.py — the MIDI ports

`midi/ports.py` is the one module that talks to the MIDI library, and this
suite runs it against `fake_libremidi.py`, a stand-in for the library with the
real one's quirks: callbacks only inside `poll()`, no settable timestamps,
unreadable message bytes, a port that stays "connected" when the device is
pulled, a dummy instead of an error for what is not there, a COM apartment on
Windows. It proves `ports.py` handles each of those, not how CoreMIDI or
Windows behave: that is `python tests/midi_live.py`, which is not a suite (the
suites block the library so no test opens a port) and which CI runs on its own
on the Mac and the Windows machine. The other suites stub the library out with
`sys.modules["pylibremidi"] = None`; the ones for code built on `ports.py`
use `fake_midi.py`, a system with nothing behind it.

## test_midi.py — notes beside the audio

So far: the three sentences that stop Start (no track that records sound, a
track that takes notes with no port, two on one port), that the card check
then holds only the tracks that record audio to the card's inputs, and that a
saved port is found again after a replug, with a device's playing port listed
first, and the `.mid` file: what a Standard MIDI File can hold, written with
`midi/smf.py` and read back with mido (the test imports mido for that), names
in UTF-8, ticks that do not drift over a long take, and a file a DAW saved
again at other ticks to the beat and with tempo changes; and what a port has
set and holds, from the bytes it sent: the state a take's `.mid` starts with
and the keys and pedals let go when it ends; and the audio's own clock: fake
audio blocks in, a note's time on the computer's clock turned into seconds on
the audio, an interface 200 ppm fast included (the recorder marking it is in
`test_engine.py`); and one take's notes on disk: a `.midraw` written as the
events are played, the `.mid` made from it at Stop, and the same `.mid` made
from a take whose app died (a torn last line, hex that does not read, a first
line that never reached the disk), keys held before the take and held at its
end, a key struck twice and let go as often as it was struck, a port that goes
and comes back, a burst of 40000 events, a disk that refuses a write or takes
it only in part, a disk that refuses for so long that lines are dropped (a
`NotesDropped`, said once in the log) and a `take.clock` refused for longer than
8 KB of marks, two threads driving one recorder, and a flush or a stop that
must not hold the other thread up while it waits for the disk. The disk is
refused by a stand-in for the file, not by a full disk. In `test_engine.py`, a
draft that `stop` had already made `.mid` files in comes back with them, and one
whose `.midraw` could not be made keeps its `take.json` for the next try. And
the rehearsal's ports, on `fake_midi.py`: a track whose port is not plugged in
waits and records from the moment it is, a port pulled mid-take and plugged
back is one file with its held notes let go when it was last heard, a port
another app holds, two that nothing tells apart, no MIDI system at all, a
device that stops sending active sensing, the same notes on two ports, a
keyboard's other port counted during the check and then picked (on a system
that, like classic Windows MIDI, opens a port only once: `FakePortSystem(...,
exclusive=True)`), a track renamed or two that swap ports keeping the port open
and what it set, a track re-picked or renamed while its port is not plugged in
starting from that port's state, an event still waiting as Start is pressed, a
port gone quiet just before Start that the watcher sees only after it, two
tracks on one port, a pedal down when its port goes let up in the take and
for the next one, the flush, a band changed during a take, a burst of 10000
events, a recorder whose disk refuses, abandon_take, a take begun over one
still recording, Look again when the observer missed a change (`fake.notify =
False`), release, notes still waiting when the counts start again, two failures
that take turns said once each and again once they have worked, and the rig on
its own two threads, ticking on its own clock; and a take's `.mid` read back as
the notes the player draws (`midi/notes.py`): a drum grid when the track has the
drums icon or every note is on channel 10, a piano roll rounded out to whole
octaves otherwise, the General MIDI drum map with the e-kits' extra notes and
an Other row only when a note outside it is used, a roll on one note paired
oldest first, a note-on at velocity 0 as a release, a note never released
lasting to the file's last event, a file with no notes, and a take of an hour
and 40000 notes; and a `.mid` cropped (`crop_mid`): what was set before the
start written at tick 0, a key held across the start left out with its release
(on its own channel, a note-on at velocity 0 too), a key held across the end let
go there with the pedals that are down, a key's pressure going the way its key
does, a SysEx kept whole, the names kept,
every tick `round(seconds * 1920)` from the new start over 20000 events and from
a start that is not on a tick, a file a DAW saved again at other ticks and
another tempo, and a file that cannot be read or written answered, never
raised; and the tool for the hand check of F1, `tools/midi_alignment.py`, run on
a folder of generated WAVs and `.mid` files and its printed numbers read back
(four cases as a command, for the exit code and the bytes on the pipe, the rest
through its `main()` in the suite's own process): clicks every half second with
notes 3 ms late or 3 ms early, a take of 130 s answered in two windows (the
notes 2 ms behind at the start and 9 ms at the end) and one of 90 s in one, 16
and 24-bit, 8 channels (read in blocks of whole frames, which a stand-in WAV that
records what it is asked for checks) and 32-bit float, drum hits that rise over
3 ms hard and soft, soft hits (8% of the loudest) that rise over 10 ms, a ringing,
irregular pattern, a ringing tone with a hit five times louder 52 to 55 ms after
it and a 60 Hz rumble about as loud as the softest hits, each with its notes at
the exact start of the hit and the worst within 3 ms (early as well as late), a
note beyond the window left unmatched and said so, `--max-ms` widening
it, two notes at one click (one matched), a `.mid` with no WAV of its name and
`--wav`, a folder with no `.mid`, no `.wav` or no folder at all exiting
non-zero, an unreadable `.mid`, a soundfile that will not import, and the output
staying ASCII, names in Cyrillic told apart by their escapes. Later tasks add to it.
Plain functions over plain dictionaries and files in a temporary folder: no
port is opened, and the MIDI library is blocked as in the other suites.

## The interface — in ui/, in TypeScript

Beside the code it tests, in two kinds:

- **`ui/src/**/*.test.ts`**, under Vitest (`npm test`): what can be checked
  without a browser. How loud a meter draws, what a time is written as, where
  the ruler puts its ticks. Seconds.
- **`ui/e2e/*.spec.ts`**, under Playwright Test (`npm run test:e2e`): the
  built `ui/dist` in a real browser, against the faked Python side in
  `ui/e2e/fake-bridge.js`, served by `ui/e2e/serve.mjs` with no `/api` so
  the interface polls over the bridge. For what needs a page laid out, a
  mouse and a keyboard: every screen, the timeline, the recording screen's
  tiles, the keys. Each test sets up the state it needs, so they run side by
  side; they wait for what they are waiting for rather than for a length of
  time, and a page's clock is fast-forwarded where the app counts seconds.
  An error in the page's console fails a test, unless the test says it
  expects that one.

Build first: the browser tests drive `ui/dist`, not `ui/src`. The first time,
`cd ui && npx playwright install chromium` fetches the browser.

CI runs both once, on Linux: they run in a browser against a faked Python
side, and nothing in them depends on the system underneath.

## docs_screenshots.py — the pictures in the docs

Not a suite: it checks nothing and `run_all.py` does not run it. It takes the
pictures in the README and `docs/using-it.md` — the built bundle and the
same `ui/e2e/fake-bridge.js`, with a band of four on an XR18 and waveforms
worked out from a song, so the pictures look like a rehearsal rather than a
test. The two MIDI pictures lay the drummer on Both, from the port "TD-17",
over that band. It writes `docs/screenshots/*.png`. Run it after changing
anything they show, and look at them before committing. Needs Playwright for
Python: `pip install playwright && playwright install chromium`.

## Why not pytest

`test_engine.py` stubs the `sounddevice` module before importing anything
that would otherwise need a real sound card, and that has to happen at import
time. Making that work under pytest's collection means fighting it for no
benefit: each suite exits non-zero on failure, prints a readable report, and
CI runs them directly.
