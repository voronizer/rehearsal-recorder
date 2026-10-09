# A metronome for songs

A band rehearsing a song wants it at the same tempo every time, and the
drummer wants a click in the headphones while the others do not. Today the
app has no tempo anywhere: MIDI recording writes its `.mid` files at 120 bpm
because there is nothing better to write (D8 of
[recording MIDI](2026-10-08-midi-recording-design.md)).

This adds a metronome. Each song keeps its own tempo and time signature, and
picking the song puts them in the metronome. The click plays through an
output of its own, so it can go to the drummer's headphones only, and the
beat flashes on screen. A take recorded to the click keeps its tempo, and
its `.mid` and WAV files carry it, so in a DAW the bars of the take land on
the project's bars.

It builds on [recording MIDI](2026-10-08-midi-recording-design.md) (the
`.mid` files and their clock, the ports for tapping),
[the player timeline](2026-09-20-player-timeline-design.md),
[crop and zoom](2026-09-21-crop-and-zoom-design.md),
[song sets](2026-10-08-song-sets-design.md) and renaming and merging songs
(issue #12, step 10). It is built after the design-system work and follows
its rulings; every screen named here is drawn with that system's components
(`/mnt/project-files/design-system/rulings.md`).

## Decisions

Alex decided these on 9 Oct 2026, one question at a time, each on a mockup
built from the app (sources in `/mnt/project-files/metronome/q7` to `q13`).

- **M1. Who hears it** («A (настраиваемый выход) + D»). The click goes to
  an output picked in Settings, a device and its outputs as the player's
  output is picked, and the beat always flashes on screen.
- **M2. When it clicks** («A (с настраиваемым отсчетом) + C»). From Record,
  after a count-in whose length is a setting, to Stop. Between takes the
  metronome has its own button to run the click.
- **M3. A song keeps its tempo and signature** («C + D»). Picking the song
  puts them in the metronome, and they can be changed before a take. The
  tempo is typed, nudged with − and +, or tapped. For an old song without a
  tempo, a button counts it from a take; the signature is picked by hand.
- **M4. Three cases** («примерно да»): a song with a tempo, a song without
  one, and a free take. See [Part 2](#part-2--where-a-tempo-comes-from).
- **M5. A change before a take reaches the song only by a button** (Q4,
  «C»): "Save to song", shown while the metronome and the song differ.
- **M6. Four signatures** (Q5, «A. Обычные»): 4/4, 3/4, 2/4 and 6/8, picked
  from a list. The first beat is accented, in 6/8 the fourth too.
- **M7. One tempo and one signature per song** (Q6, «A. Нет, пока не
  надо»). No changes inside a song.
- **M8. The metronome is one row at the bottom left of the rehearsal
  screen** (Q7, «B. Внизу»), beside Finish and Record, with a status line
  under it.
- **M9. The count-in as big digits in the clock's place, then the window's
  edge flashes on every beat** (Q8, «B. Вспышка по краю»), brighter on the
  first. The bottom-left row stays while a take records.
- **M10. Its settings in a Settings tab "Metronome" and behind a gear in
  the row** (Q9, «A + C»): the same four settings in both places.
- **M11. A song's tempo on its page in History** (Q10, «A»): a metronome row
  under the title, saved to the song at once; a song without a tempo can
  count it from one of its goes. The song list stays as it is.
- **M12. Tap by mouse, by the key T, and by MIDI pads** («а + в»), on the
  ports already given to track cards («A»).
- **M13. The click when a take plays back** (Q11, «да» to D): a metronome
  button in the Master plate turns it on, and Master's row shows the click's
  bars as stripes.
- **M14. On reha.stream** (Q12, «C. Ещё и своя плитка»): the story's words,
  an FAQ question and a tile of its own.
- **M15. In 6/8 the number counts eighths** (Q13, «Восьмые»): six clicks a
  bar, so a song felt in two at 66 shows 198.
- **M16. The tempo goes into the WAVs too** (Alex, «WAV темп не пишу - мне
  кажется это ты погорячился», then «ок» to the proposal). Takes recorded to
  the click get a tempo chunk, under a Settings checkbox that is on by
  default. Cropping such a take starts it on a bar line.

Claude's own calls, told to Alex as the questions went and not objected to,
are marked *(told)* where they come up. Calls first made in this spec are
marked *(new)*; they are listed again at the end, in
[New in this spec](#new-in-this-spec).

## Words

- **Tempo**: the number the metronome shows. In 4/4, 3/4 and 2/4 it counts
  quarter notes a minute and is labelled "bpm". In 6/8 it counts eighths a
  minute and is labelled with a drawn eighth note (M15). The range is 30 to
  300 in x/4 and 60 to 600 in 6/8 *(told)*, so a fast 6/8 fits.
- **Signature**: 4/4, 3/4, 2/4 or 6/8.
- **A click** is one sound of the metronome: a beat in x/4, an eighth in
  6/8. A bar is 4, 3, 2 or 6 clicks.
- **The count-in**: none, one bar or two bars of clicks before the band
  plays, a setting.
- **A click take**: a take recorded with the metronome clicking from its
  count-in. Its tempo and signature are known, and its bars start at the
  first sample of its files.
- **Quarter tempo**: what a DAW calls the tempo. In x/4 it is the number; in
  6/8 it is half the number (198 eighths a minute is 99 quarters).

## Part 1 — What is stored

**A song** (migration with the next free number when this is built; 0007
is MIDI's):

- `song.tempo`: integer, nullable, in the song's own count (eighths in 6/8);
- `song.signature`: text, nullable, one of the four.

Both are null for every existing song.

**A take**:

- `take.tempo` and `take.signature`: what the metronome showed when Record
  was pressed, nullable *(told: every take remembers the tempo and signature
  the metronome clicked at)*;
- `take.click`: whether it is a click take.

A take with a tempo but no click (the switch was off) keeps the tempo for
its `.mid` (Part 9) but has no bars in the player.

`library._take_data` adds `tempo`, `signature` and `click`; `songs()` and
the song's page add `tempo` and `signature`.

**`take.json`**, written as a take starts (`capture.py` `_write_record`),
gains `click: {tempo, signature, first_click_frame}`. A take the app did not
live to finish is recovered with the same grid as one it finished (Part 3,
*Where the bars are*).

**Settings** (`config.json`, read through `get_settings`):

| Key | What | Default |
|---|---|---|
| `click_device`, `click_channels` | The click's output, as `output_device` and `output_channels` | none: the player's output *(new)* |
| `click_sound` | `click`, `wood` or `hihat` | `click` |
| `click_volume` | 0 to 1 | 0.7 |
| `count_in_bars` | 0, 1 or 2 | 1 |
| `tempo_in_wav` | Write the tempo into click takes' WAVs (M16) | on |
| `metronome_on` | The row's switch: does Record click | on |

The row's tempo and signature are not settings: they follow the song in the
next take's name (Part 2).

## Part 2 — Where a tempo comes from

**The metronome follows the next take's name**, the field on the rehearsal
screen that says what the next take is. Each time that field names another
song, or none, the metronome takes the tempo and signature that go with it:

1. **A song with a tempo**: the song's tempo and signature. A change made
   in the row holds until another song is picked (M5). While the row and the
   song differ, the status line says so and offers **Save to song**.
2. **A song without a tempo**: the row is empty ("—"), and Record records
   without a click. The tempo can be typed or tapped. The first click take
   of the song that is kept gives the song its tempo and signature
   *(told)*. A false start thrown away on the review screen does not
   *(new)*. The row also offers **count it from the last take** when the
   song has one (Part 10).
3. **A free take** (an empty name or "Take N", `library.py` `_resolve`): the
   row is empty and can be set by hand. The tempo stays with the take only.
   It holds until a song is picked. When such a take is later named as a
   song with no tempo, the song gets the take's tempo.

A new song, made by keeping a take under a new title, is case 2: if the take
clicked, the song starts with its tempo.

**Renaming and merging songs** (step 10): a rename keeps the tempo. A merge
keeps the target's tempo, or takes the merged song's when the target has
none *(new)*.

**What a take records** as its tempo is what the row showed at Record. Its
`.mid` gets that tempo, or 120 when the row was empty *(told: "click tempo,
else song tempo, else 120")*; the row shows the song's tempo, so "the
song's" is covered by it.

**Changing the signature keeps the number** *(new)*. Going from 4/4 at 128
to 6/8 gives 6/8 at 128 eighths; the band then sets the number it wants.

## Part 3 — The click

**The sound.** Three sounds, Click, Woodblock and Hi-hat (M10), made by the
app at the output's sample rate rather than played from sample files, so
there is nothing to license. The first click of a bar is higher, and in
6/8 the fourth too (M6). The volume is one setting for every click.

**The count-in** is the setting's number of bars, at the take's tempo and
signature. It is part of the recording: the files start with it, and the
recording screen's clock starts at 0:00 when it ends *(told)*. With "None"
the first click is the first beat the band plays.

**Through which stream.** The app never opens a second stream on a device
it already holds *(new)*. Windows ASIO allows one stream at a time
(`devices.py:262`), and elsewhere one stream keeps the click on the
device's own clock:

- **During a take, on the recording card**: the take's stream becomes one
  stream with inputs and outputs (`sd.Stream`) instead of an input stream
  only. The click is written into its output in the same callback that
  reads the inputs, so it is locked to the recorded samples.
- **During a take, on another device** (the laptop's jack, a headphone
  amp): the click has its own output stream. That device's clock drifts
  from the recording card's, so each click is placed by the recording's own
  clock: MIDI's line from the system's time to the recorded sample (F1 of
  the MIDI spec) says when, in the system's time, a beat falls, and the
  output stream's own marks turn that into the frame to put it on.
- **Between takes, and in previews** (▶ in the row, ▶ on a song's page, a
  sound picked in Settings): the click has its own output stream, unless
  the player has the same device open, in which case it is mixed into the
  player's stream. The player then opens its stream wide enough for both
  its own outputs and the click's.
- **A second ASIO card** cannot carry the click while another ASIO card
  records. The click output picker says so under such a card, and does not
  offer it while the recording card is on ASIO.

**Where the bars are** (in the files). The first click of the count-in
falls on the first sample of every WAV and on time 0 of every `.mid` of the
take *(told)*. So, in a DAW, a take dropped at bar 1 of a project at its
tempo has its bars on the project's bars.

- The click is heard some milliseconds after it is written (the output
  latency), and what the band plays reaches the files some milliseconds
  after it is played (the input latency). Both are taken from what the
  driver reports, so a beat played exactly on the click lands exactly on
  its place in the files.
- The take's stream starts at Record. The first click is scheduled a short
  moment after the first block, and the recorded audio before the moment
  it is heard is dropped from the files. `first_click_frame` in `take.json`
  is that point, so a recovered draft is cut the same way.
- The `.mid` files' time 0 moves with the WAVs.
- The aim: a beat played on the click within 5 ms of its place on the
  recording card, and within 10 ms on another device, at the start of a
  take and after an hour. The plan measures it with a cable from the
  click's output into an input (see Testing).

**Stop on a click take records on to the next click** *(new)*, a fraction
of a second, so the files hold whole clicks and the tempo chunk's beat
count agrees with its tempo (Part 9). A take that ends on its own (the
card gone) ends where it ends.

**The switch in the row** says whether Record clicks. During a take it
silences the click and turns it back on; the take stays a click take and
keeps its tempo, and the click comes back on the beat *(told)*. The tempo
cannot change during a take *(told)*.

**When the click's output is not there** (unplugged, or taken by another
app) *(new)*: the row's status line says so in amber before Record, Record
still records, the screen still flashes the beat, and the take is still a
click take, since its grid exists.

**The click is not recorded** as a track *(new)*. Played back, it is made
again from the take's tempo (Part 8).

## Part 4 — The rehearsal screen

One row at the bottom left, beside Finish and Record (M8), as the Q7 to Q13
mockups have it, left to right:

- the metronome icon and the switch (does Record click);
- the tempo: a number field with − and + on either side, its unit after it
  ("bpm", or the drawn eighth in 6/8) with a tooltip saying what it counts
  ("Beats a minute"; "Eighths a minute: the six clicks of a bar");
- the signature, a select of the four;
- **Tap** (Part 11);
- **▶ / ■**: run the click between takes (M2). It stops at ■, at Record
  (the take's own count-in starts) and when the screen is left;
- the beat dots, one per click of a bar, the accented ones larger; lit on
  each click while the metronome runs. In 6/8 they sit in two groups of
  three so the row still fits at 960 px;
- the gear: the four settings (Part 6).

**The status line under it** always keeps two lines' room, so picking a song
moves nothing:

- "Off: takes record without the click."
- "The song's tempo."
- "The song has 128 · 4/4; this holds until another song. **Save to song**"
- "No tempo in the song yet: the first take played to the click keeps this
  one. **Save now**"
- "No tempo yet: type or tap one, or **count it from the last take**"
  (the link only when the song has a take)
- "Counting the tempo from the last take…", then "Counted from Dym 5. Pick
  the time signature, then **save it to the song**"
- "Free take: no click unless you set a tempo." / "Free take: this tempo
  stays with the take only."
- *(new)* in amber: "The click's output, X18, is not connected. The beat
  will only flash."

At 960 px the row and Finish and Record fit on one line in every state
above, in both themes, with nothing cut.

## Part 5 — While recording

- **The count-in**: big digits in the clock's place, the clock's size, from
  1 to the clicks of a bar (1 to 6 in 6/8), the accented ones in the accent
  colour. Two bars count twice.
- **Then the beat**: the window's edge lights on every click, wider and
  brighter on the first of a bar (M9), until Stop. In 6/8 that is every
  eighth. The light is a thin edge, not the screen, and stays under WCAG
  2.3.1's general flash threshold even at 600 a minute *(new)*; the plan
  checks it.
- **The bottom-left row stays**: the switch, the tempo with its unit and
  the signature, the dots, and a line: "Count-in: 2 of 4", "Clicking to
  Stop.", "Click off. The tempo still goes into the take." or "No click:
  this take has no tempo." No gear, no Tap and no
  tempo field during a take.
- **What the screen shows follows the sound.** Python knows when each click
  is heard; the screen asks when the next ones fall and lights them on
  time. It never runs a timer of its own that could drift from the click.
  This goes through the polling the levels already use
  (`mediaserver.py`, `POLLABLE`) as `metronome_state()`.

## Part 6 — Settings

**A tab "Metronome"** after Audio, "Where the click is heard, its sound, and
the count-in", and **the same four settings behind the gear** in the row
(M10), one setting underneath, so a change in one is seen in the other:

- **Click output**: a device and its outputs, with the player's own
  pickers (`DevicePicker`, `OutputChannels`). "Where the click is heard. A
  pair of outputs that feeds only the headphones keeps it off the mics."
  Until one is picked, the click goes where the player plays *(new)*.
- **Sound**: Click, Woodblock, Hi-hat. "The first beat of a bar is higher,
  in 6/8 the fourth too. Pick one to hear it." Picking one plays a bar.
- **Volume**: a slider; a bar plays when it is let go.
- **Count-in**: None, 1 bar, 2 bars. "Clicked before every take that has
  the click. It is in the recording; the take's clock starts after it."

**In the tab only**, below them (M16):

- **Write the tempo into WAV files**, on by default: "Takes recorded to the
  click get their tempo and time signature in each WAV. Cubase, Pro Tools,
  Studio One and FL Studio then fit them to the project's tempo, so set the
  project to the song's tempo first. Ableton Live and Logic ignore it."

The gear has a line "The same settings are in Settings › Metronome." and the
tab "The same settings are behind the gear in the metronome row, on the
rehearsal screen."

## Part 7 — A song's page in History

A tempo row under the song's title (M11, the Q10 mockup): the tempo with −
and +, its unit, the signature, Tap and ▶. A change is saved to the song at
once, as Settings are.

- **A song with no tempo**: "No tempo yet: type or tap one, or **count it
  from a take**". The link opens a list of the song's goes, starred first,
  then the newest: "Count the tempo from a whole go of the song:".
- **After counting**: "Counted from Dym 5; pick the time signature. If the
  click runs twice too fast or too slow: **halve** or **double**." *(told)*
- **A song with a tempo**: "Picking Dym at a rehearsal puts this in the
  metronome." Counting is not offered for it *(told)*.

## Part 8 — Listening back

In the player, wherever a take opens (M13, the Q11 mockup, variant D):

- **A metronome button in the Master plate**, after "Master", 24 px, icon
  only. Its tooltip: "Click with the take: 128 bpm · 4/4". Pressed, the
  click plays with the take, in step with its count-in.
- **Master's row gets a lane** right of its plate, as tall as the plate and
  in line with the tracks' lanes, sticky at the bottom with Master. It draws
  the click's bars and beats as stripes, dimmed while the click is off, the
  playhead, and "Click 128 bpm · 4/4" in its corner. With many beats in view
  it draws bars only, and past 480 beats every fourth bar. It follows zoom
  and the region as the other lanes do.
- **A take that is not a click take**: no stripes, "Recorded without the
  click" in the lane, and the button disabled with the tooltip "This take
  was recorded without the click". Takes recorded before this feature are
  such takes.
- **The click goes to the player's output**, mixed with the take, not to the
  click's own output *(told)*. Its volume is the metronome's, under the
  player's master volume so the take turned down turns the click down
  *(new)*. It is not in the master meter.
- **The button is off when the app starts** and stays as left from one take
  to the next *(new)*.
- In 6/8 the tag and tooltip use the drawn eighth instead of "bpm", as
  every place a tempo is shown does *(new)*.

## Part 9 — Into the files

**The `.mid`** (on top of F4 of the MIDI spec, which writes 120 bpm):

- the tempo meta event (FF 51) is the take's quarter tempo, as microseconds
  a quarter note: `round(60,000,000 / quarter tempo)`; 120 when the take has
  no tempo;
- a time signature meta event (FF 58) for a take with a signature: x/4 as
  `nn 02 18 08`, 6/8 as `06 03 0C 08` (a click on every eighth);
- for a click take, time 0 is the first click (Part 3).

A DAW that takes the file's tempo then shows the quarter tempo: 99 for a 6/8
at 198 *(told)*.

**The WAV** of a click take, when `tempo_in_wav` is on (M16): an `acid`
chunk before the data, the only place a WAV carries a tempo
(`/mnt/project-files/metronome/research/tempo-in-wav.md`):

- the quarter tempo as a float, the signature, and the number of beats in
  the file;
- written by the app's own WAV writer, since neither `wave` nor
  python-soundfile writes custom chunks. `raw_to_wav`, `crop_wav` and
  `mixdown` write through it;
- a take that is not a click take never gets one, setting or not: the band
  was not on a grid, and a DAW would stretch it for nothing *(told)*;
- turning the setting off affects the takes recorded after it.

What DAWs do with it, from their documentation: Cubase and Nuendo turn
Musical Mode on and fit the file to the project's tempo; Pro Tools conforms
it to the session's tempo; Studio One shows it as the file's tempo; FL
Studio reads it when its own setting is on; Reaper probably fits it.
Ableton Live ignores it, and Logic does not list it among what it reads.
For those two the bar at the file's first sample and the `.mid` remain.

**Crop** (`_crop_tracks`, `crop_draft`): on a click take the region's start
moves back to the bar line before it, and its end on to the next click, so
the cropped files still start on a bar and hold whole clicks *(told for the
start; new for the end)*. The notice that says the take was cropped says
where it now starts. The take stays a click take; its `.mid` is cut the
same way.

**The mix** (`mixdown`) of a click take gets the same chunk.

**The cloud**: WAV copies are copied as they are, so they carry the chunk;
FLAC and MP3 copies do not *(told)*. The cloud's `.mid` copies carry their
tempo as any `.mid` does.

## Part 10 — Counting a tempo from a take

The app's own counter in numpy, after librosa's way of doing it, with no
library added (`/mnt/project-files/metronome/research/tempo-estimation.md`):

- an onset envelope from the spectrum's rises, its autocorrelation over
  windows, and a gentle preference for tempos around 120;
- **what it listens to**: the drums' `.mid` when the take has one (its hits,
  the kick and snare counting more than the hats); else the drums' WAV (the
  track with the drums icon); else the take's tracks mixed;
- **a drifting take** gives the median of its windows' tempos;
- **in 6/8** it looks for the eighth, the number shown (M15): of the
  periods it finds, the one whose triple is also strong *(new)*;
- the answer is in the signature the row shows, and is kept while the row
  is open, so picking the signature after counting turns the same count
  into that signature's number *(new)*;
- **halve** and **double** fix the usual mistake, a tempo twice or half the
  real one (about one song in four for this kind of counter).

It reads in blocks, as `mixdown` does, and a three-minute take takes about
a third of a second. `count_tempo(folder, take_number, signature)` returns
`{ok, tempo}` or an error for a take whose files are missing.

## Part 11 — Tap

- **The Tap button**, and **the key T** anywhere on the rehearsal screen
  and a song's page, except in a text field (`useSpacebar.ts` `useKey`; T is
  free, the player uses M and R).
- **The tempo** is the average of the last four gaps between taps; a pause
  of two seconds starts afresh. In 6/8 a tap is an eighth (M15).
- **MIDI pads** (M12): after Tap or T is pressed, hits on the ports given to
  the track cards count as taps, until a pause of about two seconds
  *(told)*, so playing never changes the tempo. A hit is a note-on with a
  velocity. During a rehearsal those ports are open already (MIDI spec,
  Part 3). On a song's page in History, pressing Tap or T opens the band's
  ports for the tapping and closes them after the pause *(new)*. A port
  another app holds gives no taps.
- The hits reach the screen through the same polling, with their times.

## Testing

Tests come before the code, and each is seen failing first.

**Python** (`tests/test_engine.py`, sounddevice and pylibremidi stubbed as
now):

- migration: songs and takes with no tempo read as before;
- Part 2's three cases; the first kept click take giving a song its tempo,
  a thrown-away false start not; a free take renamed into a song with no
  tempo; rename and merge keeping or taking the tempo;
- the click: each sound's accents in 4/4, 3/4, 2/4 and 6/8; clicks on the
  exact frame for a tempo that does not divide the sample rate, over an
  hour, with no build-up of rounding; the count-in's bars;
- the streams: one stream with inputs and outputs when the click is on the
  recording card; a separate stream on another device; the click mixed into
  the player's stream on its device, and the player's stream widened;
- the grid on another device: a click output running 200 ppm off the
  recording card still putting the click of an hour in on its sample,
  within a millisecond, as MIDI's F1 test does;
- the files: the first click at sample 0 of every WAV; `first_click_frame`
  cutting a recovered draft the same; the `.mid`'s time 0 moving with it;
  Stop recording on to the next click;
- the `.mid`: FF 51 and FF 58 for 4/4 and for 6/8 at 198 (99 a quarter);
  120 and no FF 58 without a tempo;
- the `acid` chunk: written by `raw_to_wav`, `crop_wav` and `mixdown` for
  click takes only, read back through libsndfile's loop info (tempo,
  beats, signature) and through `wave` (the audio unchanged); not written
  with the setting off;
- crop: the start moved to the bar before, the end to the next click, the
  take still a click take;
- the counter on synthetic takes (4/4, 3/4, 6/8, a drift from 124 to 134,
  drums `.mid` first), and against librosa and mir_eval as dev-only
  references, never shipped;
- tapping from pad hits: only after Tap, ending after the pause.

**Vitest**: the tap average and its reset; the row's status line for every
case; 6/8's numbers and labels.

**Playwright** (the fake bridge gains the songs' tempos, `metronome_state`,
`count_tempo` and click takes):

- the row with a song with a tempo, without one, and a free take; Save to
  song; the amber line for a missing output;
- the count-in digits and the edge's light;
- Settings' tab and the gear showing the same values;
- a song's page: counting, halve and double;
- Master's button and stripes; a take without the click;
- nothing cut and nothing moving at 960 px, in both themes.

**By hand, before the PR** (the plan has a checklist):

- a cable from the click's output into an input, recorded as a click take,
  on the recording card and on another device, on macOS and on Windows
  with ASIO: the click's recording within the aim of Part 3, at the start
  and after an hour;
- a click take opened in a DAW that reads the `acid` chunk (Reaper runs on
  Linux, so it can be tried in the container) and, if someone has one, in
  Cubase, Pro Tools or Studio One: the tempo read, nothing stretched in a
  project at the song's tempo;
- the counter on the band's own click takes, whose tempos are known.

## Docs

- **`docs/using-it.md`**, a new section "The metronome": the row and its
  switch; a song's tempo, Save to song, counting from a take, Tap and pads;
  the click to the drummer's headphones (a pair of outputs that feeds only
  them); the count-in; the click when listening back; in a DAW, set the
  project to the song's tempo and put the files at bar 1 (a 6/8 song shows
  half its number there, in quarters); what the WAV setting does in which
  DAW. Screenshots of the row and of Master's stripes, from the fake.
- The MIDI section's line "set the project to 120 bpm" changes: a take with
  a tempo carries it.
- **`CHANGELOG.md`**.

## On reha.stream

As the Q12 mockup's variant C has it (M14):

- **The story, step 2**: "Start, and ↑ picks Pałyn under Next take, and its
  128 bpm for the click." and "Record: a bar of clicks to count in, then the
  take's name over a big clock,". The frames are the real app, so they show
  the row and the count-in by themselves.
- **The FAQ**, after the audio-interfaces question: "Is there a
  metronome?" "Yes. Each song keeps its tempo and time signature: typed,
  tapped, or counted from an old take. The click plays through the output
  you choose, so it can go to the drummer's headphones only, and the screen
  flashes on every beat. A take recorded to the click keeps its tempo, and
  its WAV and .mid files carry it, so the bars line up in your DAW." (*"WAV
  and"* is new since the mockup, after M16.)
- **A tile "A click for the drummer."** beside "Records at what the card
  can do": "Each song keeps its tempo and time signature. The click can go
  to the drummer's headphones only, and the beat flashes on screen." with
  the real metronome row (Pałyn, 128 bpm, 4/4). "Never destroys anything"
  goes the whole width. The MIDI tile and the sets tile join the same
  section first, so where the three go is settled when this is built, with
  every row full.
- The site's demo songs get tempos as the demo band plays them (Pałyn 128),
  and its takes are click takes, so the hero player shows Master's stripes;
  the plan checks they sit on the band's beats. The click stays silent on
  the site *(told)*.

## Not part of this

- Tempo or signature changes inside a song (M7), and signatures beyond the
  four (M6).
- Recording the click as a track.
- Sending MIDI clock, or following a DAW's or a drum machine's clock.
- A click while listening back through the click's own output (Part 8).
- Tempo in FLAC or MP3 copies.
- Choosing the accents, subdivisions or a sound file of one's own.

## New in this spec

Calls made while writing this, not yet seen by Alex:

1. The click goes where the player plays until its output is picked.
2. A false start thrown away does not give a song its tempo.
3. A merge keeps the target's tempo, or takes the merged song's.
4. Changing the signature keeps the number.
5. The app never opens a second stream on a device it holds: on the
   recording card the click shares the take's stream; between takes it
   shares the player's. A second ASIO card cannot take the click.
6. Stop on a click take records on to the next click, so files hold whole
   clicks; crop's end moves on to the next click for the same reason.
7. A missing click output: an amber line, and the take still records with
   its tempo and the flash.
8. The click is not recorded as a track.
9. The edge's light stays under the WCAG flash threshold.
10. On playback the click is under the master volume, out of the meter,
    off when the app starts and kept as left between takes.
11. In 6/8 the drawn eighth replaces "bpm" wherever a tempo is shown.
12. A count is kept while the row is open, so picking the signature after
    counting converts it; in 6/8 the counter looks for the eighth.
13. On a song's page, Tap opens the band's MIDI ports for the tapping.
14. The FAQ answer says "its WAV and .mid files".

## Not yet confirmed

- The `acid` chunk's field order for the signature, and what "beats" counts
  in 6/8: no published specification; checked by reading back through
  libsndfile and in a DAW by hand.
- Which DAWs read the chunk beyond those documented (Reaper probably;
  Bitwig and GarageBand unknown).
- How exact the drivers' reported latencies are; the cable test says.
- The counter's accuracy on real rehearsal takes; the band's click takes
  are the test set.
