# Where the band drifted

A band that rehearses a song wants to know where it ran ahead or dragged:
the bridge that always rushes, the outro that sinks. Today the player shows
the sound of every track and, after [the metronome](2026-10-09-metronome-design.md),
the click's bars on Master, but nothing says whether the band stayed on the
tempo.

This draws the band's tempo bar by bar along Master's row in the player. A
dashed line is the tempo the take aimed at, a grey band around it is "on
tempo", and where the band was further off for two bars or more the line
turns amber and says by how much: "+7".

It is built after the design-system work and after the metronome, on Alex's
word, and follows both: the take's and the song's tempo and signature
(metronome Part 1), click takes (its Words), Master's lane (its M13 and
Part 8), the tempo counter (its Part 10) and Settings › Metronome (its
Part 6). Every piece is drawn with the design system's components and
tokens (`/mnt/project-files/design-system/rulings.md`). Nothing new is
stored: no migration.

Re-checked on 19 Oct 2026 against main d6c96db, the metronome as merged
(PR #65); what that changed here is listed in
[Since the metronome was built](#since-the-metronome-was-built).

## Decisions

Alex decided these on 10 Oct 2026, one question at a time, Q2 and Q3 on
mockups built from the app (sources in `/mnt/project-files/tempo-drift/q2`
and `q3`; rulings in `/mnt/project-files/tempo-drift/rulings.md`).

- **D1. What it is measured against** (Q1, «А - если есть темп (метроном).
  В - если нету.»): the tempo the take had, when there is one (the click it
  was recorded to, else the song's tempo); else the take's own middle tempo.
  So every take gets it, old ones too.
- **D2. Where it shows** (Q2, «а», mockup
  https://claude.ai/artifact/4LBmQJg8qNZXGsjXoTtRBg): a line along
  Master's lane, over the click's bars.
- **D3. What it is counted from** (Alex asked «по какому треку ты дрифт
  собрался считать?»; the answer drew no objection): the drums, found by
  the drums icon, not by name; their `.mid` when the drums record MIDI, kick
  and snare weighing more than the hats; else their audio; with no drums
  icon in the take, the mix of all its tracks. The click is never in the
  files, but its times are known.
- **D4. On reha.stream** (Q3, «C», mockup
  https://claude.ai/artifact/PY5cTk7oHSQPDeA9YVcEir): the story's fifth
  step and a question in the FAQ say it, and the metronome's tile carries it
  with Master's row under the metronome's row. No tile of its own.

Claude's calls told to Alex with the questions, not objected to, are marked
*(told)*. Calls first made in this spec are marked *(new)* and listed again
in [New in this spec](#new-in-this-spec).

## Words

- **A beat**: what the tempo counts, a quarter in x/4 and an eighth in 6/8
  (metronome M15). A **bar** is 4, 3, 2 or 6 beats.
- **The aim**: the tempo a take is measured against (Part 1).
- **A bar's tempo**: how fast the band played that bar, in the aim's unit.
- **Off**: a bar's tempo further from the aim than the tolerance, 2% unless
  changed in Settings (Part 5).
- **A stretch**: bars off the same way, two or more of them, drawn amber
  with one number.

## Part 1 — The aim

Each take's aim, first that applies (D1):

| The take | The aim | Master's tag |
|---|---|---|
| A click take | its click's tempo | "Click 128 bpm · 4/4" (as metronome Part 8) |
| Not a click take, with a tempo (the metronome showed one at Record but its switch was off) | that tempo | "No click · 128 bpm · 4/4" *(new)* |
| A take of a song that has a tempo (takes from before the metronome too) | the song's tempo now | "Pałyn 128 bpm" |
| Anything else (a free take, a song with no tempo) | the middle of the take's own bar tempos (their median) | "No tempo · middle 126 bpm" |

- The signature comes with the tempo: the take's, else the song's. With
  neither, bars are counted as 4/4 *(new)*; only bar numbers depend on it.
- The tag is where the metronome's lane has it (`MasterClickLane.tsx`): top
  left, 12 px, muted. It also replaces the lane's screen-reader label.
- In 6/8 the tag says the drawn eighth instead of "bpm", as every tempo
  does (metronome New 11).
- With no drums icon in the take, the tag ends "· from the mix" *(new)*, so
  the band knows why the line is rougher.
- The interface picks the aim and sends it with the take to Python; the
  middle tempo comes back from Python. A take carries its own tempo,
  signature and click (`TakeClick`); the song's tempo for an older take
  comes from the songs the screen already has (`Library.song_tempos`).

## Part 2 — A bar's tempo

Python counts it, numpy only, with no library added: the metronome's
counter (Part 10, `audio/tempo.py`) gives the onset envelopes
(`_audio_envelope`, `_hits_envelope`); this adds a beat tracker and bars. The method and its measurements are in
`/mnt/project-files/tempo-drift/research/findings.md`, prototype beside it.

**What it listens to** (D3), first that the take has:

1. the `.mid` of the tracks with the drums icon: their note-ons as weighted
   hits, as the counter weighs them: the kick and snare rows of the app's
   drum map 1, the rest 0.4 *(told: kick and snare weigh more)*. The map
   already puts a TD-17's hi-hat edge (22, 26) on the hi-hat;
2. the WAVs of the tracks with the drums icon, summed when there are several
   (a kick mic and overheads) *(new; the counter takes the first only)*;
3. the take's WAVs summed, leaving out tracks with the Backing track icon,
   and, once the backing track is built, its own file (`take_file.kind`
   "backing") *(new, from the backing track's spec, its Part 9 item 4)*: a steady file
   in the sum would hide the band's own tempo, and a band can record a
   backing track today as an input with that icon.

When one gives no steady beat (Part 3, *States*), the next is tried *(new)*.

**How** *(told: per bar)*:

1. The onset envelope: the counter's spectral flux, with a hop of about
   12 ms instead of its 23 ms, so a bar's ends land closer (`_audio_envelope`
   takes the hop as an argument; the counter keeps 23 ms). For a `.mid`, the
   counter's impulse train at 200 a second.
2. The beats: a dynamic-programming beat tracker (Ellis 2007, as librosa's
   `beat_track`) around the aim, in `audio/tempo.py` beside the counter so
   that the backing track finds its file's bar 1 with the same one *(new)*. Without a tempo the counter's own count is
   the aim's start. It follows a band that drifts and keeps going through a
   fill or a two-bar stop.
3. Each beat moves to the strongest hit within 15% of a beat of it; a beat
   with no hit there stays where the tracker put it.
4. **Bar 1**: on a click take the bars lie on the click's grid, which
   starts at sample 0 (metronome Part 3), and bar 1 is the grid's first bar
   in which the drums play, so the count-in is skipped whatever its length;
   otherwise bar 1 starts on the first beat the drums play *(new)*. A pickup can put bar numbers one beat off;
   the tempo is not affected.
5. **A bar's tempo**: the median of the slopes between every pair of its
   beats, taking in one beat before and after the bar *(new)*. A single
   misplaced beat then changes no bar; a straight line through the bar's
   own beats let one bad beat swing two bars by up to 5.6% in the prototype.
6. A bar where most beats found no hit has no tempo, and the line breaks
   there *(new)*: a stop, a drum-less verse.

**Measured** on 13 synthetic takes (drums with the band's bleed, the drums'
`.mid`, the mix; 4/4, 3/4, 6/8 at 198, a ballad, a click take): a bar's
tempo within 0.2–0.5 bpm in the median and 2.5 bpm at worst (1.3%); every
stretch that was there found, on the right bars; none on steady or gently
wandering takes. About 0.5 s for a 2.5-minute take. Not yet tried on a real
rehearsal (Not yet confirmed).

`audio/drift.py` `take_drift(tracks, notes, aim)` answers:

```python
{"ok": True,
 "source": "drums-mid" | "drums" | "mix",
 "per_bar": 4,                    # beats a bar
 "middle": 126.4,                 # the median of the bars' tempos
 "bars": [{"n": 1, "start": 4.71, "end": 6.58, "tempo": 128.3}, ...]}  # tempo None: no beat
# or {"ok": False, "why": "short" | "no-beat" | "missing"}
```

`aim` is `{"tempo", "signature", "click"}` or None. The
stretches are found in the interface (Part 3), so the tolerance can change
without counting again.

## Part 3 — In the player

Master's lane (metronome Part 8, `MasterClickLane.tsx`), as the Q2 mockup
has it, variant A. The lane is now 3.5 rem (56 px) tall, as every track's
lane is under the design system, not the mockup's 92 px; less the well's
3 px either side, the line has about 50 px *(new: the line keeps the lane's
height)*:

- **The aim**: a dashed line across the middle. **On tempo**: a faint band
  around it, as wide as the tolerance either way.
- **The band's tempo**: a line through each bar's tempo at the bar's middle,
  in text colour, 2 px *(as in the mockup)*. The lane's height covers 8%
  either side of the aim; a bar further off is drawn at the edge *(as in the
  mockup)*. At 50 px a bpm at 128 is about 2.4 px, and the 2% band about
  12 px tall.
- **A stretch** *(told)*: two or more bars off the same way is drawn in the
  warning amber (`--warn`) with a light amber fill between the line and the
  aim. Stretches the same way with two bars or fewer between them join into
  one *(new)*. One chip per stretch, above a rise and below a dip, or beside
  it where the edge leaves no room: its largest difference in whole beats a
  minute, "+7" or "−5", after a three-bar median so one rough bar does not
  inflate it *(new)*. The chip is `--warn` with `--warn-foreground` text, 12
  px (R11), radius 4 (R17), digits tabular. Where two chips would overlap,
  the smaller difference's is hidden; its stretch is still amber *(new)*.
- **Hover** *(told)*: anywhere along the lane, "Bar 61 · 135 bpm (+7)" (in
  6/8 the drawn eighth for "bpm").
- **The click's stripes** stay on a click take, dimmed to a third under the
  line *(as in the mockup)*. The metronome button in the Master plate is
  unchanged.
- **The region** (a loop) is drawn over Master's lane in amber, as over the
  tracks (main does so since the metronome). The line and its chips stay
  over it; the plan checks that a stretch inside a region still reads.
- **The tag** in the corner (Part 1).
- **Zoom and the region** move the line with the lanes. Zoomed far out the
  line is still drawn per bar.
- **States**, in the tag's place, muted text. While it counts, the design
  system's loading rule (B5): nothing under 1 s, then a spinner, and past 10
  s "Counting the tempo…". Then "Too short to show the tempo" (fewer than 4
  bars); "No steady beat found" (none of the three sources gave one); a take
  whose files are missing shows nothing new *(new: the wordings)*.
- **For a screen reader** the lane says the stretches in words: "Tempo:
  ahead 7 bpm, bars 46 to 68; behind 5 bpm, bars 70 to 75." or "Tempo:
  steady." *(new)*.
- **At 960 px** nothing is cut and nothing moves, in both themes.

## Part 4 — When it is counted

- **When a take opens in the player**, wherever that is: the rehearsal
  screen, History (a rehearsal, a song's page) and Review right after a take
  *(new: Review too, since the site's words say "After a take")*. The
  interface asks once per take opened, as it asks for the notes
  (`TakePlayer.tsx` `useTakeNotes`), and keeps the answer with the lists it
  was for.
- **Python keeps the last 32 answers** in memory, by the files' paths, sizes
  and times and the aim, so opening a take again is instant; a crop or a
  re-take rewrites the files and is counted afresh *(new)*. Nothing goes to
  the store or to disk.
- **It reads in blocks**, as `mixdown` does, in a thread of its own.
- **Never while a take records**: Record stops a count in progress, and the
  player asks again when it opens *(new)*. The recording's own thread is not
  delayed by it.

## Part 5 — Settings

One setting in **Settings › Metronome**, in a group of its own, "Tempo
drift", after the group "The click" and before the WAV checkbox's group
*(new)*:

- **Drift shown past**: 1%, 2%, 3% or 5%; default 2%. "How far from the tempo
  a stretch of two bars turns amber on Master. 2% is about 2.5 bpm at 128."

`drift_tolerance` in `config.json`, 0.01, 0.02, 0.03 or 0.05. It is not
behind the metronome row's gear: it is about listening back, not about the
click. The tab's last line, "The same settings are behind the gear in the
metronome row, on the rehearsal screen.", becomes "The click's settings are
also behind the gear in the metronome row, on the rehearsal screen." *(new)*,
since neither this nor the WAV checkbox is there.

## Part 6 — What this changes in the metronome

To be built on top of the metronome as it is approved; nothing in it is
undone:

1. **M13, a take that is not a click take**: the lane no longer says
   "Recorded without the click" (`MasterClickLane.tsx` `NO_CLICK`, its tag
   and its screen-reader label); it shows the drift line and its tag (Part
   1). The button in the plate stays disabled with its tooltip. The guide's
   sentence on it (`docs/using-it.md`, "Listening back to the click") changes
   with it.
2. **Settings › Metronome** gets the one setting of Part 5.
3. **The site's metronome tile** gets a sentence and Master's row (D4).
4. **The demo takes** (`ui/e2e/band.js` `clickedAt`): on main every take of
   a song with a tempo is a click take. Here the hero opens Pałyn 2 and its
   line against Pałyn's 128 (+7 in the bridge), as the Q3 mockup showed, so
   the fixtures' Pałyn takes are recorded with the click switched off: they
   keep the tempo 128 and their tag reads "No click · 128 bpm · 4/4" *(new)*.
   Viasna's stay click takes with stripes, and the take the story records,
   Pałyn 3, is still recorded to the click.

## Since the metronome was built

What the re-check against main d6c96db changed in this spec:

1. Master's lane is 56 px, not 92 (Part 3).
2. The sources reuse the counter's envelopes; the mix leaves out the Backing
   track icon; the drum map already knows a TD-17's hi-hat edge (Part 2).
3. Where the setting sits in the tab, and the tab's last line (Part 5).
4. The demo's Pałyn takes are recorded with the click switched off, since on
   main every demo take of a song with a tempo is a click take (Part 6).
5. The site's metronome tile is a row of its own with its words beside the
   row; the FAQ answer says the 2% can be changed (On reha.stream).

The backing track (paused, its spec ок'd) touches the same places: it puts
its lane right above Master and leaves Master's lane alone; it renames the
tab "Click & backing track" and adds its output after the click's settings,
leaving drift's group and the WAV checkbox last; its FAQ question and this
one both follow the metronome's, in the order they land. Its file's bar 1
needs beat times too, so the two share this spec's beat tracker (as that thread
proposed on 19 Oct); whichever is built second uses the one already
there.

## Testing

Tests come before the code, and each is seen failing first. Python check
labels and Playwright titles are Latin only.

**Python** (`tests/test_drift.py`, added to `tests/run_all.py`): the
research's synthetic takes, made in the test (a few seconds each):

- a bar's tempo within 2% of the truth in every bar, and every stretch found
  on its bars, for drums audio with bleed, drums `.mid`, the mix, 3/4, 6/8
  at 198, a ballad at 72, a click take;
- no stretch on a steady take, nor on one wandering by 1.2%;
- the sources: `.mid` before audio; two drums-icon tracks summed; no icon
  gives "mix"; silent drums fall back to the mix;
- bar 1 on a click take after a two-bar count-in; drums coming in after
  eight bars of guitar; a two-bar stop breaks the line;
- "short", "no-beat" (a sustained chord), "missing";
- the cache: the same answer object again; a rewritten file counted afresh;
- Record stops a count in progress.

**Vitest** (`lib/drift.test.ts`): stretches (two bars, same sign, joined
across two, the three-bar median for chips, chips that would overlap); the
aim and tag for each row of Part 1, 6/8 included; the tolerance setting.

**Playwright** (the fake bridge gains `take_drift`, with the mockup's
curves for the demo takes): the line, band, chips and hover on Pałyn 2;
Viasna's stripes under the line; a free take's middle tag; each state;
zoom moving the line with the lanes; Review shows it; the setting moves
what turns amber; nothing cut or moving at 960 px; both themes.

**By hand, before the PR**: the band's own click takes (their tempo is
known) and a few free takes; does the amber land where the band hears the
rush? Takes from a real rehearsal room are the one thing the synthetic set
cannot stand in for.

## Docs

- `docs/using-it.md`, in the metronome's section, "Where the band
  drifted", after "Listening back to the click": the line, the band, amber and its number, the hover, what it is
  measured against, what it listens to, the setting. A screenshot of
  Master's row from the fake.
- `CHANGELOG.md`.

## On reha.stream

As the Q3 mockup's variant C has it (D4), with the metronome's site part
in place:

- **The story, step 5**: "Open Pałyn 5 and loop its bridge: the Master row
  says it ran ahead, +7." and "Step to Pałyn 6: the same bar, still looping,
  and the bridge held 128." The frames are the real app.
- **The FAQ**, after "Is there a metronome?": "Does it show where we sped
  up?" "Yes. Under the tracks, the Master row draws the band's tempo bar by
  bar: against the click the take was recorded to, or the song's tempo, or,
  for a song without one, the take's own middle. Where the band ran ahead or
  dragged by more than 2% (you can change that in Settings), the line turns
  amber and says by how much." *(new: the bracket, so the 2% is not a
  half-truth)*
- **The tile "A click for the drummer."**, on main a row of its own with its
  words beside the metronome's row: its words end "After a take, the Master
  row shows where the band ran ahead or dragged.", after "…the edge of the
  screen lights on every click.", and on the piece's side Master's row of
  Pałyn 2 goes under the metronome's row (the real lane; its plate hidden
  under 600 px).
- **The demo**: the hero's Pałyn 2, step 5's Pałyn 5 (+7 in the bridge)
  and Pałyn 6 (steady) show their lines from the fake's curves (Part 6,
  item 4).

## Not part of this

- How far ahead of or behind the click each beat falls (milliseconds), and
  who rushes against the drums (Q1's option C).
- Tempo changes the song means (a written ritardando, a half-time bridge):
  one tempo per song (metronome M7), so they show as drift.
- A drift mark in lists (History, the start screen) or comparing two takes'
  lines.
- Writing the band's tempo into the `.mid` or WAV.

## New in this spec

Calls made while writing this, not yet seen by Alex:

1. The tag for a take with a tempo but no click: "No click · 128 bpm ·
   4/4"; "· from the mix" when no track has the drums icon.
2. With no signature, bars count as 4/4.
3. Several drums-icon tracks are summed; a source with no beat falls back
   to the next.
4. Bar 1 is the first beat the drums play when there is no click.
5. A bar's tempo takes one beat either side (robust to one bad beat); a bar
   with no hits has no tempo and breaks the line.
6. Stretches the same way two bars apart or closer join; the chip shows the
   largest difference after a three-bar median; an overlapping smaller chip
   is hidden.
7. Counted when a take opens, Review included; 32 answers kept in memory;
   nothing stored; not while a take records.
8. The states' wordings, and the screen reader's sentence.
9. A setting "Drift shown past" in Settings › Metronome: 1, 2, 3 or 5%,
   default 2%.
10. The demo's Pałyn takes are recorded with the click switched off
    (tempo 128 kept); Viasna's and the story's Pałyn 3 keep the click.
11. The line keeps the lane's 56 px (the design system's lane height).
12. The mix leaves out tracks with the Backing track icon.
13. A settings group "Tempo drift" before the WAV checkbox; the tab's last
    line says only the click's settings are behind the gear.
14. The FAQ's "(you can change that in Settings)".

## Not yet confirmed

- Accuracy on real rehearsal audio: cymbal bleed into every mic, ghost
  notes, half-time feels. Measured only on synthetic takes.
- E-kits whose notes the app's drum map does not know (it knows General
  MIDI and a TD-17's): their hats would weigh as the rest do, 0.4, which is
  right, but a kick or snare on an unknown note would weigh 0.4 too. Beats
  are still found; only the weighting is off.
- How long the mix takes for a 16-track take of 10 minutes; the plan
  measures it.
