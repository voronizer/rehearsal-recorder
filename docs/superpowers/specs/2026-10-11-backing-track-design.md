# A backing track for songs

Some songs are rehearsed to a backing track: pads, keys or a choir the band
does not have, or a whole arrangement without the part someone is learning.
Today that file is played from a phone or another laptop into the mixer. It
is recorded as an ordinary input, with the "Backing track" icon
(`ui/src/lib/instruments.ts:53`). Nothing lines it up with the click, and
someone has to start it on time.

This lets a song keep its backing track. The app plays it from Record: it
comes in on bar 1, right after the metronome's count-in, through an output
of its own. The take keeps it as a track of its own, made from the file. When
the file is added, the app counts its tempo and finds its bar 1. For pads
with no beat, the band sets bar 1 by ear, on the start of the file drawn with
the song's bars over it.

It is built on main after the design system, the metronome and tempo drift,
which all shipped in 0.13.0. It follows the last two:

- from [the metronome](2026-10-09-metronome-design.md):
  the song's tempo and signature (M3, Part 1), the count-in and click takes
  (Words, Part 3), its row and status line (M8, Part 4), Settings and the
  gear (M10, Part 6), the song page's tempo row (M11, Part 7), Master's lane
  (M13, Part 8) and the tempo counter (Part 10);
- from [tempo drift](2026-10-10-tempo-drift-design.md): its beat tracker
  (`audio/tempo.py` `track` and `snap`, whose docstring already names bar 1
  of a backing track), and its "mix" source, which leaves the backing track
  out.

Every piece is drawn with the design system's components and tokens
(`/mnt/project-files/design-system/rulings.md`).

## Decisions

Alex decided these on 11 Oct 2026, one question at a time, Q5 to Q9 on
mockups built from the app. The sources are in
`/mnt/project-files/backing-track/q5` to `q9`, and every answer is in
`/mnt/project-files/backing-track/rulings.md`.

- **B1. What it is** («минус к песне должен быть привязан», then Q1 «А»): the
  song keeps its backing track, and the app plays it itself from Record. A
  backing track made from a take, a mix without some tracks (Q1's B), is
  not part of this.
- **B2. When it comes in** (Q2, Alex's own proposal: «можно дать
  возможность посчитать темп при добавлении минуса. если посчитался - ок,
  если нет - задать время первого такта.»): on bar 1, right after the
  count-in. When the file is added, its tempo is counted. If no tempo comes
  out, the first bar's time is set by hand. During a take the click never
  follows the file: «клик идёт по минусу - я бы не спешил. минус может быть
  люым материалом».
- **B3. What a song holds** (Q3, «А. вариант В - можно добавить как
  тикет-задачу на гитхабе»):
  - A song holds its tempo, its signature and its backing track, nothing
    more.
  - History › Songs gets a **New song** button and a backing-track section
    on the song's page.
  - Lyrics, chords, key and notes are GitHub issue #41, to be decided later.
- **B4. One file, one output** (Q4, «А»): mono or stereo, one track in the
  take. No stems.
- **B5. On the rehearsal screen, its own row under the metronome's** (Q5,
  «А», mockup https://claude.ai/artifact/LsSKGUhmjGiKth3hAUxfHc). The row has
  a switch, the file and its length, a volume and ▶. The metronome's status
  line says when it comes in.
- **B6. On the song's page, bar 1 dragged on the drawn start of the file**
  (Q6, «B», mockup https://claude.ai/artifact/SJq8JwR24ref8awnJckdAV). The
  song's bars and beats are drawn over it, and a "Bar 1 at" field sits
  beside it.
- **B7. Its output with the click's** (Q7, «B», mockup
  https://claude.ai/artifact/GpADTZtdcuiWQss3vYRazX):
  - The metronome's Settings tab becomes "Click & backing track".
  - The metronome's gear holds the backing track's output too.
  - The backing track's row has no gear.
- **B8. In the player, a dashed lane right above Master** (Q8, «тогда В. и
  состояние М - сохраняется для песни», mockup
  https://claude.ai/artifact/2UQSMyhucRVfWj9b6UNgGG). The first time a take of
  the song opens, the lane is muted. After that, M stays as it was last left
  for that song.
- **B9. On reha.stream** (Q9, «D», mockup
  https://claude.ai/artifact/18k8aaDAeTSB8G461TWag2): the story's second step,
  a question in the FAQ, and a tile of its own beside "Never destroys
  anything".

Some calls are Claude's own, told to Alex with the questions and not objected
to. They are marked *(told)*. Calls first made in this spec are marked
*(new)*, and they are listed again in [New in this spec](#new-in-this-spec).

## Words

- **The backing track**: the song's one audio file. On screen, in English, it
  is "backing track"; the take's track is called "Backing".
- **Bar 1**: where the song's first bar starts in the file, in seconds, to
  a hundredth. What comes before it is the **lead-in**: silence, a pickup, a
  count.
- **The counted tempo**: what the metronome's counter found in the file when
  it was added. It is in the song's own count: eighths in 6/8, as
  metronome M15 has it. A file with no steady beat has none.
- **A click take** and **the count-in**: as in the metronome.

## Part 1 — What is stored

**A song** (migration 0009; the metronome took 0008, and tempo drift added
none):

- `song.backing_file`: text, nullable. Where the app's own copy of the file
  is, relative to the recordings folder.
- `song.backing_name`: the file's name as it was added ("Pałyn backing.wav").
  This is what screens show.
- `song.backing_first_bar`: float, seconds into the file.
- `song.backing_tempo`: the counted tempo, nullable (no steady beat).
- `song.backing_heard`: boolean, default false. Whether the backing track is
  heard when a take of the song opens in the player (B8).

All five are null or false for every existing song. The file's length and
channels are read from the copy when they are needed. They are not stored.

**A take's files**: `take_file.kind` gets a third value, `backing`. It marks
a WAV the app wrote from the song's backing track *(new)*. Everything that
opens a take's audio opens it too: the player, the mix, crop, the cloud and
the waveforms. Only the player treats it differently (Part 7), and the tempo
counters leave it out (Part 9). Today the column keeps `.mid` files away
from what opens audio, so those filters become "not midi".

**The copy** *(told: the app keeps its own copy, so moving or deleting the
original breaks nothing)*:

- It goes in a folder **Backing tracks** in the recordings folder, beside the
  library's database (`store/db.py` `database_path`). So it moves with the
  library *(new)*.
- It is byte for byte as added. A name already used gets " (2)", as
  `_unique_path` gives (`api.py:202`).
- Beside it the app keeps the file **ready to play**: a WAV at the sample
  rate the app plays and records at. It is made when needed and can be
  deleted, as a cache (Part 3).
- Replace and Remove send the old copy and its ready file to the Trash, as
  everything the app deletes goes *(new)*. A take that was played with it
  keeps its own Backing track (Part 4).

**`take.json`**, written as a take starts, gains `backing: {file,
from_frame}`. That is the ready file, and which of its frames plays at the
take's frame 0. So a take the app did not live to finish gets the same
Backing track as one it finished (Part 4) *(new)*.

**Settings** (`config.json`, read through `get_settings`):

| Key | What | Default |
|---|---|---|
| `backing_device`, `backing_channels` | The backing track's output, as `output_device` and `output_channels` | none: where the player plays *(told)* |
| `backing_volume` | 0 to 1, one for every song *(told)* | 0.8 |
| `backing_on` | The row's switch: does Record play it *(told: holds until changed)* | on |
| `backing_row` | The row has been shown: it stays from then on *(told)* | off |

## Part 2 — The file, and counting it

**Adding** ("Add backing track…" on the song's page, Part 6) opens the
system's file picker:

- The picker offers what the bundled libsndfile 1.2.2 reads: **WAV, AIFF,
  FLAC, MP3 and OGG** *(new)*. M4A and AAC, which iTunes and Apple Music
  give, are not readable by it. A file that cannot be read says so: "This
  file can't be read. Use WAV, AIFF, FLAC, MP3 or OGG; most players can
  export one." (soundfile is already bundled, `packaging/rehearsal-recorder.spec:82`.)
- **Mono or stereo only** *(new)*. A file with more channels says so.
- The app copies the file, makes it ready to play, and counts it. The
  section shows "Counting the tempo of Pałyn backing.wav…" meanwhile.

**Counting** *(told: it runs by itself when the file is added)*:

- The tempo comes from the metronome's counter (its Part 10) on the file
  read as a whole mix, in the song's signature. With no signature, it counts
  4/4 *(new)*.
- **Bar 1** goes on the first strong beat *(told)*. The beats come from the beat
  tracker tempo drift added (`audio/tempo.py` `track` and `snap`). Bar 1 is the first beat of the strongest
  of the bar's possible downbeats: of the 4 (or 3, 2, 6) places a bar could
  start, the one whose beats are loudest on average across the file
  *(new)*. A pickup can still put it one beat off, and the status line
  offers one beat earlier or later (Part 6).
- **A song with no tempo** takes the counted one. Halve and double are
  offered, since about one count in four is doubled or halved *(told)*.
- **A song with a tempo** keeps it when the count differs, until "take the
  backing track's tempo" is pressed *(told)*. When they agree, the status
  line says "as the song".
- **No steady beat** (pads, a drone): the app says so. Bar 1 is the file's
  start until it is dragged, and the song's tempo is typed or tapped as the
  metronome has it *(told)*.

`add_backing(song_id)` opens the picker and returns `{ok, name, seconds,
channels, tempo, first_bar}`. `count_backing(song_id)` counts again; it is
used after Replace. Both run on a thread of their own.

**Ready to play** *(new)*:

- The file is decoded through libsndfile.
- Unless its rate is already the rate the app plays and records at
  (recording settings), it is resampled with **soxr**. That is the
  resampler librosa uses by default, and its wheels cover macOS (Intel and
  Apple) and Windows. It is LGPL, as libsndfile already is, and is shipped as
  a separate module. It is a new dependency, and a sinc resampler in numpy
  is the fallback if bundling it fails (Not yet confirmed).
- The ready file is a 32-bit float WAV beside the copy, named with its rate.
  It is played through a memmap, as the player reads takes (`player.py`
  `_open_track`).
- A three-minute MP3 takes a second or two. It is made when the file is
  added. It is made again when the rate in Settings changes, and when a song
  is picked whose ready file is missing.

## Part 3 — Playing it in a take

**When it comes in** (B2):

| The take | The backing track |
|---|---|
| A click take (the song has a tempo, the metronome's switch is on) | Its bar 1 on the take's bar 1, the first click after the count-in |
| No click (the song has no tempo, or the metronome is off) | From the file's start, at Record *(told)* |
| A free take, or the song has none, or the row's switch is off | Not played, not recorded |

- **A lead-in longer than the count-in** *(new)*: what fits plays during the
  count-in, and the rest of the lead-in is skipped. With the count-in set to
  None, the file starts at its bar 1, with the first click.
- **Without a click**, the take's files start when the file's first sample
  is heard, as a click take's start at its first click (metronome Part 3)
  *(new)*. So the Backing track and the band line up from sample 0.
- **The tempo changed in the row** for this take, away from the counted
  tempo: the file plays at its own speed, and the status line says so
  (Part 5) *(new)*. Time-stretching is not part of this.
- **It plays on to Stop** *(told)*, even after the band stopped. Past the
  end of the file it is silent. At Stop it fades out over 20 ms, so the
  room hears no click *(new)*.

**Through which stream**, as the click (metronome Part 3), and never a second
stream on a device the app holds:

- **On the recording card**: written into the take's stream's outputs, in the
  callback that reads the inputs. The click shares this stream too.
- **On another device**: its own output stream. That device's clock drifts
  from the recording card's, about 50 ms an hour at 15 ppm and more on cheap
  cards. A click is placed beat by beat, but a file plays without stopping.
  So the file is played very slightly faster or slower to stay on the
  recording's clock (MIDI's F1 line, as the click uses it). The change stays
  under 0.1%, too small to hear *(new)*. The band and the Backing track stay
  together after an hour.
- **Between takes** (▶ in the row and on the song's page; picking an output in
  Settings): its own output stream, or mixed into the player's stream when
  the player has that device open, as the click is.
- **A second ASIO card** cannot carry it while another ASIO card records,
  as the click cannot. The output picker says so.

**Channels**:

- A stereo file goes to the two outputs picked.
- A mono file goes to both outputs of a pair *(new)*.
- On one output, a stereo file plays in mono *(told)*.

**Volume**: `backing_volume`, one for every song *(told)*. It changes what is
heard, not what is recorded (Part 4).

**When its output is not there** (unplugged, or taken by another app) *(new)*:
the status line says so in amber before Record (Part 5). Record still
records, without the backing track: the take gets no Backing track, since
nobody heard it.

## Part 4 — What the take keeps

**The Backing track** *(told: taken straight from the file, not through an
input)*:

- At Stop the app writes `Backing.wav` into the take's folder from the ready
  file. Its frames are placed as they were heard: on bar 1 after the
  count-in, or from sample 0 without a click. So in a DAW it lands on the
  band.
- It has the take's rate and bit depth, mono or stereo as the file, and the
  take's length. It is silent where the file had ended.
- **The switch or the volume during a take** change only what is heard. The
  track is the file as placed, whatever the level *(told for the volume; new
  for the switch)*.
- **Its name** is "Backing" *(told)*. When a track of the band already has
  that name, it is "Backing (2)" *(new)*. Its icon is "Backing track".
- A recovered draft gets the same track from `take.json` (Part 1).
- **Takes recorded before this feature** do not change *(told)*. Neither do
  takes recorded before the song's backing track was replaced or removed.

**What carries it**:

- **The mix** (`mixdown`): by its fader, like any track. The player's mute is
  not applied to the mix today (`api.py:1015` `save_mix` keeps faders by
  track name). So a muted backing track is in the shared mix unless its fader
  is down (B8, as Q8's option said).
- **Crop**: cut with the other tracks.
- **The cloud**: when tracks are sent, `Backing.wav` goes with them *(new)*.
- **The disk line**: it counts as one more track while a backing track will
  play *(new)*.

## Part 5 — The rehearsal screen

**The row** sits under the metronome's row at the bottom left (B5, the Q5
mockup, variant A), and the metronome's status line moves under both. It appears once any song has a backing track, and stays
from then on *(told)*. Left to right:

- the "Backing track" icon and the switch;
- the file's name, truncated, and its length. While ▶ plays it shows "0:12 /
  3:42". It is dimmed while the switch is off;
- the volume, a slider;
- **▶ / ■**: plays the file from its start, alone, to hear it and set the
  level *(as in the mockup)*. It stops at ■, at Record, when another song is
  picked, and when the screen is left.

There is no gear (B7). A song without a backing track: "No backing track for
Dym. It is added on the song's page in History." A free take: "Free take: no
backing track."

**The metronome's status line goes on with one sentence** (B5) and keeps its
two lines' room:

- "The backing track comes in on bar 1, after the count-in."
- "The backing track starts with Record: no click, so no count-in."
- "Backing track off: takes record without it."
- *(new)* "The backing track was counted at 128: it will not follow 132."
- *(new)* in amber: "The backing track's output, X18 5–6, is not connected.
  Takes record without it."

At 960 px the two rows and Finish and Record fit in every state above, in
both themes, with nothing cut. The plan checks the longest pairs of
sentences.

**While recording** *(new)*: the row stays, as the metronome's does (M9). It
shows the switch, the file with "1:12 / 3:42", and the volume. There is no
▶, and nothing new among the track tiles.

## Part 6 — A song's page, and New song

**The backing-track section** sits under the metronome's tempo row (B6, the
Q6 mockup, variant B). On the first line:

- the icon;
- the file's name, its length and "stereo" or "mono";
- **Bar 1 at 0:00.80**: − and + move it a hundredth of a second, and it can
  be typed. ↑ and ↓ do the same in the field; with Shift, a tenth;
- **▶**: the file from its start, and the click from bar 1. "They should land
  together." *(told)* With no tempo, the file alone;
- **⋯**: Replace… and Remove. "Takes already recorded keep the backing track
  they were played with." *(told)*

Under it, **the start of the file, drawn**:

- It runs from the file's start to four bars past bar 1, and at least 8
  seconds. The scale stays fixed while the page is open, so dragging does
  not change it *(new)*.
- The song's bars (numbered) and beats are drawn over it from bar 1.
- **Bar 1's marker is dragged**, or moved with ← and → (a hundredth; Shift, a
  tenth). The playhead shows while ▶ plays.
- "Drag bar 1; the lines are the song's bars and beats." With no tempo: "No
  tempo, so no bars to draw: drag bar 1."
- Every change is saved to the song at once, as the tempo row's are.

**The status line under it** keeps two lines' room:

- No backing track: "One audio file, mono or stereo. Its tempo is counted
  when it is added; with no steady beat in it, bar 1 is set by ear.", and
  the row has "Add backing track…".
- "Counting the tempo of Pałyn backing.wav…"
- "Counted 128 bpm, as the song; bar 1 on the first strong beat. A beat off
  (a pickup)? One beat **earlier** or **later**."
- "Counted 104 bpm, now the song's tempo; bar 1 on the first strong beat.
  Twice too fast or too slow: **halve** or **double**." followed by the same
  beat links.
- "Counted 126 bpm; the song stays at 128 until you **take the backing
  track's tempo**. Bar 1 on its first strong beat."
- "No steady beat in it (pads): the click keeps the song's 96. Drag bar 1 to
  where the band comes in, and check it with ▶."
- "No steady beat in it, and the song has no tempo: type or tap one above,
  or leave it, and the backing track plays from Record with no click."

The page says the line that fits the song now, from what is stored (the
counted tempo, the song's tempo). So it reads the same when the page is
opened again *(new)*.

**New song** (B3): a button over History's song list.

- It opens a dialog "New song", with the line "A song with no takes yet: give
  it a tempo and a backing track before its first take." It asks only for the
  title. Create opens the new song's page.
- A title already a song, or one of a song's old names, says "Pałyn is
  already a song." and Create is disabled.
- The song is made with `last_go` 0. Its first take is go 1.

**Songs with no takes** *(new)*. Today History lists only songs with a go
(`store/library.py:597` `songs()`), and the Next take list comes from
rehearsals (`api.py:1829` `song_choices`).

- Both also list a song that has never had a take (`last_go` 0) or that holds
  a backing track. A song whose takes were all deleted stays hidden, as
  today, unless it has a backing track.
- In the list it says "No takes yet". Its page says "No takes yet: its first
  comes with the first take kept under this title." It has no go ladder.
- Under Next take it is offered with the other songs, so it can be picked
  for its first take.

**Renaming and merging songs** (step 10): a rename keeps the backing track.
A merge keeps the target's backing track, or takes the merged song's when
the target has none. The copy that is left goes to the Trash *(new)*.

## Part 7 — Listening back

In the player, wherever a take opens (B8, the Q8 mockup, variant B):

- **The Backing track's lane comes last, right above Master.** Its plate and
  lane have a dashed border, and its waveform is drawn as any track's. The
  plate says "Backing" and, under it, "Stereo file" or "Mono file". It has
  M, S and the fader, like any track.
- **M per song** (B8): the first time a take of the song opens, the lane is
  muted. Pressing M sets `song.backing_heard`, and every take of that song
  then opens with M as left. It is kept with the song, so it lasts across
  restarts *(told)*.
- **The fader** is kept by track name, as every track's is. The mix follows
  it (Part 4).
- **Review**, right after a take, is the same player, so it shows the same
  lane.
- The metronome's button and lane in Master's plate do not change.

## Part 8 — Settings, and the metronome's gear

As the Q7 mockup's variant B has it (B7):

- **The tab "Metronome" becomes "Click & backing track".** After the
  metronome's four settings (Click output, Sound, Volume, Count-in) it has
  **Backing track output**: a device and its outputs, with the player's own
  pickers (`DevicePicker`, `OutputChannels`). Its line reads "Where the
  backing track is heard: the speakers the band plays to, or the mix for
  in-ear monitors. Picking one plays two seconds of it." *(told: picking
  plays two seconds)* Then its **Volume**, the same slider as the row's.
- On one output the line adds "One output: a stereo backing track is played
  in mono."
- The tab today has the groups Click output, The click, Tempo drift and the
  WAV checkbox. Backing track output and its Volume are a group "Backing
  track" after The click; Tempo drift and the WAV checkbox stay last, in the
  tab only.
- The tab's line in the list becomes "Where the click and the backing track
  are heard, the click's sound, and the count-in", and its last line "The
  click's and the backing track's settings are also behind the gear in the
  metronome row, on the rehearsal screen."
- **The gear** in the metronome's row: its popover is titled "Click and
  backing track". Under the click's four settings it has Backing track
  output. Its closing line becomes "The same settings are in Settings ›
  Click & backing track."

## Part 9 — What this changes in the metronome and in tempo drift

Built on top of both as they are on main. Nothing in them is undone:

1. **Metronome Part 6**: the tab and the gear are renamed and get the
   backing track's output (Part 8). The tab is called "Metronome" until this
   is built.
2. **Metronome Part 4**: the status line goes on with the backing track's
   sentence (Part 5). The row gets a second row under it.
3. **Metronome Part 3**: the take's stream and the player's stream carry the
   backing track too. A take without a click starts its files when the
   backing track is first heard.
4. **Metronome Part 10** ("count it from a take") and **drift Part 2**
   (source 3, "all the take's WAVs summed") leave the Backing track out
   *(new)*. A steady file in the sum would hide the band's own tempo. Drift
   already leaves out a track with the "Backing track" icon (`api.py`
   `take_drift`), but the app's Backing track is not one of the band's
   tracks, so the take's files say which one it is, and both counters go by
   that. `count_tempo` today sums every track.
5. **The site**: the metronome's and the drift's items are unchanged. The
   backing track gets an item of its own (On reha.stream).

## Testing

Tests come before the code, and each is seen failing first. Python check
labels and Playwright titles are Latin only.

**Python** (`tests/test_engine.py` and a new `tests/test_backing.py`, in
`tests/run_all.py`; sounddevice stubbed as now):

- the migration: songs read as before; `take_file.kind` "backing" opened as
  audio by the player, the mix, crop and the cloud, and never as a `.mid`;
- adding: the copy in Backing tracks, " (2)" for a name used; WAV, AIFF,
  FLAC, MP3 and OGG read; M4A and a 6-channel file refused with their
  messages; Replace and Remove sending the copy to the Trash;
- the ready file: 44.1 kHz to 48 kHz and 96 kHz to 48 kHz, a sine's
  frequency and level kept, aliasing under −90 dB; made again when the rate
  changes or the file is missing;
- counting on synthetic files: 4/4, 3/4 and 6/8 at known tempos with a known
  bar 1 after a lead-in, a pickup, pads (no beat); bar 1 on the right beat;
  a song with no tempo taking the count, one with a tempo keeping it;
- placing, as the band hears it: bar 1 on the first click after a one- and a
  two-bar count-in; a lead-in longer than the count-in cut; no count-in;
  no click, from sample 0; the files starting when it is first heard;
- the stream: written into the take's stream on the recording card; mixed
  into the player's stream on its device; mono to a pair, stereo to one
  output; a second ASIO card refused;
- another device running 200 ppm off the recording card: after an hour, the
  file heard within 10 ms of where the Backing track has it;
- the track: `Backing.wav` sample-exact against the ready file, the take's
  length, silent after the file's end, the same with the switch flipped and
  the volume changed during the take; "Backing (2)"; a recovered draft
  getting it from `take.json`; no track with the output missing;
- the mix by its fader, muted or not; crop cutting it;
- songs with no takes: listed when `last_go` is 0 or they have a backing
  track, hidden otherwise; offered under Next take; New song refusing a
  title or an old name in use; merge keeping or taking the backing track;
- `song.backing_heard` kept across a restart;
- drift and the metronome's counter leaving the Backing track out of the
  mix.

**Vitest**: the row's sentence for every case of Part 5; the song page's
status line for every case of Part 6; bar 1's field (typing, − +, ↑ ↓, Shift).

**Playwright** (the fake bridge gains songs' backing tracks, `add_backing`,
`count_backing`, takes with a Backing track and songs with no takes):

- the row: a song with one, without one, a free take, off, ▶ and ■, the
  amber line; it appears once any song has one;
- the song page: adding and counting (as the song, now the song's, a
  different tempo, no beat), halve and double, one beat earlier and later,
  dragging bar 1 and the field, ▶, Replace and Remove;
- New song: making one, a title in use; "No takes yet" in the list and on
  the page; picking it under Next take;
- Settings' tab and the gear: the renamed titles, the output pickers, the
  mono line;
- the player: the dashed lane above Master, muted the first time a song's
  take opens, M kept for the song from one take to the next, Review;
- nothing cut and nothing moving at 960 px, in both themes.

**By hand, before the PR** (the plan has a checklist):

- a cable from the backing track's output into an input, recorded with a
  click take, on the recording card and on another device, on macOS and on
  Windows with ASIO. The recorded input should sit on the Backing track
  within 5 ms on the card and 10 ms on another device, at the start and after
  an hour;
- a take opened in a DAW: the Backing track on the band;
- the counter on the band's own backing tracks: is bar 1 right, and how
  often is it a beat off?

## Docs

- **`docs/using-it.md`**, a new section "The backing track", after the
  metronome's and the drift's. It covers:
  - adding one to a song, and what files work;
  - counting, and bar 1 by ear;
  - New song;
  - the row and its switch;
  - its output: the speakers or the in-ear mix, with the click still in the
    drummer's headphones;
  - the Backing track in the take, its M in the player;
  - its fader in the shared mix.

  Screenshots of the row, the song page and the lane, from the fake.
- **`CHANGELOG.md`**.

## On reha.stream

As the Q9 mockup's variant D has it (B9): words where the evening starts, a
question in the FAQ, and an item of its own whose window shows Pałyn's page.
The site was rebuilt in 0.13.1 after Q9 (PR #68): the tiles became the items
of a story in four steps (`site/content/story.md`), with the live app beside
them. So D's three parts go where that page has room for them *(new)*:

- **The step "Before you play."**: its line becomes "The tracks are filled
  in from last time, and each song brings its tempo and its backing track."
  This is the old story step 2's sentence, in the step that now says it.
- **An item "A song brings its backing track."**, a tile (`evening.ts`
  `KIND`), right after "Every song keeps its tempo.":
  - its line: "Add the file to the song once. It comes in on bar 1, after
    the count-in, through its own output, and the take keeps it as a
    track.";
  - its window: a still piece of Pałyn's page (`pieces.tsx`), the start of
    the file drawn with the bars over it, bar 1 at 0:00.80, as D's tile had
    it;
  - under the window: "The app counts the file's tempo and finds bar 1. For
    pads with no beat, drag bar 1 to where you hear it. In the player the
    take's Backing track sits right above Master, muted the first time, so
    you hear the band without it."
- **The FAQ**, after "Does it show where we sped up?": "Can it play a
  backing track?" "Yes. A song can keep one audio file, mono or stereo: a
  backing track, pads, a loop. Add it on the song's page in History: the app
  counts its tempo and finds bar 1, or you drag bar 1 to where you hear it.
  It comes in on bar 1, right after the count-in, through the output you
  choose: the speakers, say, while the click stays in the drummer's
  headphones. The take keeps it as a track of its own, so you can listen to
  the band without it."
- **The demo**:
  - Pałyn has a backing track (counted 128, bar 1 at 0:00.80), and so do
    Sonca (pads, no beat) and Viasna.
  - The live app shows the row under the metronome's once ↑ picks Pałyn
    (the first step's last moment), and the take the story records, Pałyn
    3, opens with the dashed Backing lane, muted. Viasna 1, tonight's take
    5, has one too.
  - The hero's rehearsal screen shows Viasna's row at the bottom. Its lanes
    rise by the row's height, so Vocals shows only by half, and the hero
    frame keeps its size *(told)*.
  - The backing track makes no sound on the site, as takes make none
    *(told)*.

## Not part of this

- A backing track made from a take (Q1's B), and several files or stems
  (Q4's B).
- Lyrics, chords, key and notes for a song (issue #41).
- Time-stretching the file to the click's tempo, or a tempo map from it.
- Trimming, fading or editing the file in the app.
- A backing track for a free take.
- Removing a song with no takes. A mistaken New song can be renamed or
  merged.

## Since it was ok'd

Alex ok'd this spec on 11 Oct 2026. On 24 Oct it was checked against main
`79c7993` (the design system, the metronome, tempo drift, the rebuilt site)
before the plan:

- Tempo drift is built, and its beat tracker is in `audio/tempo.py`, so bar
  1 is found with it as Part 2 says. Drift already leaves a track with the
  "Backing track" icon out of its mix; Part 9 says what is still needed.
- The migration is 0009.
- The screens were rebuilt by the design system after the mockups. Every
  place this spec puts something is still there: the metronome's row with
  its status line under it, the recording screen's row, the song page's
  tempo row, the player's lanes above Master, Settings › Metronome and the
  gear. Part 5 says the status line moves under both rows, as the Q5 mockup
  had it, and Part 8 names the tab's groups as they are now.
- reha.stream was rebuilt in 0.13.1, so "On reha.stream" puts D's three
  parts in the new page (item 19 below).

## New in this spec

Calls made while writing this. 1 to 18 were ok'd with the spec on 11 Oct; 19
is from 24 Oct:

1. Files: WAV, AIFF, FLAC, MP3 and OGG, mono or stereo. M4A and AAC are not
   readable by the bundled libsndfile.
2. The copy lives in a "Backing tracks" folder in the recordings folder.
   Replace and Remove send it to the Trash.
3. The file is made ready at the app's sample rate with soxr, a new
   dependency (LGPL, like libsndfile).
4. A lead-in longer than the count-in: what fits plays during the count-in,
   and the rest is skipped. With no count-in it starts at bar 1.
5. Without a click, the take's files start when the backing track is first
   heard.
6. On another device the file plays a hair faster or slower to stay on the
   recording's clock.
7. With its output missing: an amber line, and the take records without it.
8. The switch flipped during a take changes what is heard, not the track.
9. During a take the row stays, without ▶.
10. A line when the row's tempo differs from the counted one: the file does
    not follow it.
11. A band track already called "Backing": the file's track is "Backing
    (2)".
12. History and Next take list songs that never had a take, or that hold a
    backing track. A song whose takes were all deleted stays hidden
    otherwise.
13. A merge keeps the target's backing track, or takes the merged song's.
14. Drift and the metronome's counter leave the Backing track out of "the
    mix".
15. Bar 1 is placed on the loudest of a bar's possible downbeats. With no
    signature, it counts 4/4.
16. The drawn start of the file keeps its scale while the page is open.
17. A mono file goes to both outputs of a pair. At Stop it fades out over
    20 ms.
18. The Backing track goes to the cloud when tracks are sent, and the disk
    line counts it.
19. *(2026-10-24)* reha.stream, rebuilt since Q9: D's words go in the step
    "Before you play.", and D's tile is an item of that step with Pałyn's
    page in its window.

## Not yet confirmed

- soxr in the PyInstaller bundle on macOS and Windows. If it does not
  bundle, a sinc resampler in numpy takes its place.
- How often bar 1 lands on the right beat in real backing tracks. The
  band's own files are the test set, and the beat links are the fix.
- MP3 gaps: whether libsndfile's MP3 decoding drops the encoder's padding.
  Bar 1 is found on the decoded file, so a fixed offset changes nothing, but
  the plan checks that the same file always decodes the same.
- How exact the drivers' reported latencies are, and how well the clock
  follow holds on a cheap USB card. The cable test says.
