# Folding a track's notes in the player

Today a take with an e-kit on **Both** opens with the drums' notes as a lane
94 px tall under the drums' sound, its plate saying only “MIDI”, and a
keyboard on **MIDI** adds a lane of 96 px more. This change folds every lane
of notes to a thin strip when a take opens, with an arrow on its plate to
open it, and moves the grey from under the waves to the plates, so a track
and its notes read as one thing.

It is the player in Timeline, which the band service's take page, РЭХА's
rehearsal screen and History share, so all three change.

The mockup Alex picked from is https://claude.ai/artifact/VNAAGBVrLDmnFy1SGvZ2jU
(the service's take page on answers recorded from a local Worker, with a
made-up keyboard on **MIDI** added to Kupalle #2; source and the ui diff in
/mnt/project-files/band-service/midi-fold/q1-mock/). Every answer with its
time: /mnt/project-files/band-service/midi-fold/answers-log.md.

## Alex's picks

All on 10 November 2026 (UTC).

- 12:27 «в большом плеере миди дорожку нужно сделать сворачивающейся и как
  то показать что она относится к аудио, если аудио такое есть».
- 12:41 A fold to a strip, not a hidden lane, and «все миди дорожки должны
  быть свернуты по умолчанию»: every lane of notes, on **Both** and on
  **MIDI**, folded when a take opens.
- 12:44 «в рэхе тоже»: the same in РЭХА, with no setting to tell them apart.
- 12:47 No frame round a track and its notes (a dashed one was tried and
  dropped). The arrow goes by the notes' M.
- 12:53 The arrow is a bare grey chevron, as on History's song days. The
  notes row under a track loses its “MIDI” word; the MIDI sign stands right
  of it, before M. A track on **MIDI** keeps its icon and name and gets the
  same sign before M.
- 12:55 Nothing jumps when the notes open: the plate's line stays where it
  is.
- 13:03 No grey under the waves; the grey goes on the plates. (More room
  between tracks was tried first and dropped.)
- 13:06 The plate's grey reaches its lane, with no gap.
- 13:07 and 13:11 More air inside the plate, top and bottom, with the row
  still 56 px: a 64 px row was tried and dropped. M, S and the fader must
  read on the grey.
- 13:13 «ок» to the mockup as it stands.
- 13:18 Nothing new on reha.stream (card «Нет, не нужно»): the site's frames
  change by themselves, and the pictures and the guide are redone.

## What the band sees

### The notes, folded

Every lane of notes is folded when a take opens: opening a take from a list,
Stop opening the take just recorded, ↑ and ↓ to the next take in the player.

Folded, the notes are a strip as long as the take, drawn as now but squashed:
under a track the strip is 24 px tall, in a row of 1.5rem + 3 px; a track on
**MIDI** has a row of 1.5rem + 8 px with the notes 26 px tall. The strip has
no row names (Crash, Kick, C4), as a lane too short for them has none now.
The playhead and the loop region cross the strip, a click or a drag on it
works as on any lane, and its notes go paler with their track, as now.

Open, the lane is what it is today: as tall as six drum rows with their
names need (NotesPlate's MIN_HEIGHT).

### The arrow

A bare grey chevron, 14 px in a 20 px square, where S stands on a track: on
the notes' row, right of their M. It points right while the notes are
folded and down while they are open, as on History's song days
(SongLadder.tsx:163), and it turns without motion when motion is off. A
press, Enter or Space opens or folds that one lane; the others stay as they
are. On hover the square gets the accent's grey, as a ghost button does.

The plate's line (MIDI sign, M, arrow) is near the row's top, folded and
open, so the arrow stays under the pointer: in the mockup Drums' arrow is
at 468 px before and after, Keys' at 735.

### Whose notes they are

Under a track on **Both**, the notes' row has no name and no icon on the
left: the track's name is right above. On the right are the MIDI sign, M
pressed for good, and the arrow. The track's plate and the notes' plate are
one grey shape, rounded at the top left and at the bottom left.

A track on **MIDI** is a row of its own, as now: its icon and name, then the
MIDI sign, M and the arrow.

### Grey on the plates

- Waves, notes and Master's click lane have no grey under them; they are
  drawn on the panel's fill.
- Each plate has the grey (--well) from 1 px under the row's top to 1 px
  above its bottom, so 2 px of the panel shows between two plates. The grey
  runs on over the 12 px between the columns, to the lane's left edge; its
  left corners are round, its right ones square against the lane.
- A track and its notes: one grey, round at the top left of the track and
  the bottom left of the notes, with nothing between them.
- Master's plate has the grey too.
- Backing keeps its dashed frame on the plate and the wave, with no grey.
- Inside the plate, the name and the fader row are 2 px apart, not 4, so
  there are 8 px above the name and 8 px under M and S. Master's plate the
  same.
- On the grey, the fader's track is the `selected` grey, not `muted`, and M
  and S that are off have the card's fill, so they read as buttons.

Rows keep their height: 56 px for a track and for Master.

## Where it shows

- The band service's take page on a computer (Take.tsx Full).
- РЭХА: the rehearsal screen's player and History's, which use the same
  Timeline.
- reha.stream: the hero (the rehearsal screen), the story frame (History)
  and the 404 page (TakePlayer) are the real player, so their grey moves to
  the plates on the next site deploy; the demo band has no MIDI, so nothing
  folds there. The MIDI tile in “Notes too” draws NotesPlate itself: it gets
  the MIDI sign before M, and no arrow, since it has nothing to fold.
- Not changed: the service's desk on a phone (Desk.tsx) and РЭХА's
  listening volume, which use the same plates on the card's fill.

## How it is built

- Timeline keeps which lanes of notes are open, by track name, empty when a
  take opens and again when the take changes. It hands each notes row its
  `folded` and a toggle.
- NotesPlate: no name or icon when paired; the MIDI sign before M always;
  an arrow after M when it gets a toggle; the line at the top when folded or
  open. The arrow is a small component of its own, beside NotesMute.
- The rows: a folded notes row has its height set (above); the grey is a
  box round each plate in Timeline, with the margin that takes it over the
  column gap; Waveform, NotesLane and MasterClickLane get no well there.
- LaneControls and MasterControls: the 2 px gap and the fader and toggle
  fills when they are on the grey, and as now elsewhere.
- The code starts from the mockup's diff, without its switches and the
  variants Alex did not pick.

## Pictures and the guide

- The service picture `downloads` (Kupalle #2 with the Download window over
  the player), light and dark, taken again. The drums' notes there are
  opened before the shot, as they are now.
- The guide's pictures with the player, taken again by
  tests/docs_screenshots.py: player.png (also in README), listening.png,
  zoom.png, midi-player.png (notes opened), metronome-master.png,
  drift-master.png and backing-lane.png.
- The guide's words: the player's look (using-it.md ~405, “each track's
  waveform … sits on a darker background of its own”) and the notes in the
  player (~1101, “share its dark background, under a thin line … on a
  background of their own”) say what is there now: the notes start folded
  and the arrow by their M opens them.
- CHANGELOG under Unreleased, one item for the folding and the grey.
- Before the merge, screenshots of the site's hero, story frame, 404 and
  the MIDI tile for Alex (no PR previews for the site).

## Words

- The arrow's name, for screen readers: “Drums notes”, the same folded or
  open, with aria-expanded saying which. No tip: the chevron says it, as on
  History's song days.
- The MIDI sign keeps its name “MIDI”.

## Tests

While developing, only the tests a change touches, once each; the full
suites once on CI.

- ui e2e lanes.spec.ts: the plates' grey and the lanes with none, the 56 px
  rows, 8 px above the name and under M and S, the grey 1 px in.
- ui e2e midi-player.spec.ts: notes folded when a take opens and after ↑/↓,
  the arrow opens and folds one lane, the arrow's place before and after,
  no “MIDI” word under a track, the MIDI sign before M on both kinds, the
  strip's height.
- service e2e takes.spec.ts: the drums' notes and the keys' lane now start
  folded; their checks open them first.
- site e2e page.spec.ts: the MIDI tile's plates with the MIDI sign.
- Unit tests for the open set if it is a function of its own.

## Calls Claude made

- Folded each time a take opens, with nothing remembered between takes or
  between launches, as «свернуты по умолчанию» reads.
- Backing's plate keeps its dashed frame and has no grey.
- Master's plate gets the same 2 px gap as the tracks'.
- The fader and toggle fills change only on the grey plates; the phone desk
  and РЭХА's listening volume stay as they are.
- The arrow has no tip and its name does not change with it.
- In the pictures where the notes are the point (`downloads`,
  midi-player.png) they are opened before the shot.

## Not in this

- Folding a track's audio, or several lanes at once.
- Remembering which lanes were open.
- Any other change to the rehearsal screen while recording: its tiles are
  not this player.
