# From soundcheck to the take you keep.

<!-- The four steps of an evening, by id, and under each its items: tiles
     first, then cards. Keep the ids and their order. The app beside the
     steps goes through the same four (site/src/stage/Story.tsx), and an
     item's id says whether it is a tile or a card and what the app's
     window shows for it (site/src/page/evening.ts). -->

## Before you play. {#before}

The tracks are filled in from last time, and each song brings its tempo.

### Rehearse the set, in order. {#set}

Make the gig's songs a set once. The rehearsal screen lists them in order,
and History says which ones you never got to.

### Every song keeps its tempo. {#tempo}

Pick a song for the next take, and its tempo and time signature go into the
metronome. The click plays through the outputs you choose, so it can go to
the drummer's headphones alone.

### Hear where you left off. {#left-off}

Before you start, ▶ beside a song plays its newest ★ take.

### Tap the tempo on a pad. {#tap}

Press Tap once, and the drummer taps the rest on any pad of the e-kit.

### A tempo from an old take. {#counted}

For a song with no tempo, the app counts one from a take, listening to the
drums.

### The first take sets the tempo. {#first-take}

A song with no tempo keeps the one from the first take you record to the
click and keep.

### Each interface knows its inputs. {#inputs}

The XR18 in the rehearsal room, a small box at home: each one puts every
musician back on their own input.

## While you record. {#during}

A count-in, then a big clock and a tile for each musician.

### Every musician on their own track. {#tracks}

Each track is written to disk as you play and kept as its own WAV file. If
the app closes during a take, you lose at most the last 30 seconds.

### Notes too, from an e-kit or a keyboard. {#midi}

A track records its audio, its MIDI or both. The notes are saved as a .mid
file beside the audio.

### A count-in in big digits. {#count-in}

The clock starts at 0:00 when the band comes in.

### The beat on the edge of the screen. {#edge}

After the count-in, the edge of the window lights on every click until Stop,
brighter on the first of a bar.

### How long it took last time. {#last-time}

Under the clock: “Took 2:21 last time”, with a bar that fills as you play.

### A clip stays red. {#clip}

A tile that clipped stays red until Stop, and says how many times:
“clipped 3×”.

### The laptop stays awake. {#awake}

While a take records, the laptop does not sleep and its screen does not
lock.

### An unplugged interface ends the take. {#unplugged}

A few seconds after the interface goes, the take stops on its own, with
everything before it kept.

### Disk space in hours. {#disk}

“Room for about 28 h 40 min of recording”, counted for your tracks and
their quality.

## After the take. {#after}

Listen to it, mark it, keep it or not.

### Marks say what happened. {#marks}

Keep this, Went wrong or the band's own label, with a comment, right on the
take.

### Where the band ran ahead. {#drift}

After a take, Master's row draws the band's tempo bar by bar. Where it ran
ahead or dragged, the line turns amber: “+7”.

### Undo, for 10 seconds. {#undo}

Deleting, discarding and cropping happen at once. For 10 seconds, Undo puts
it back. After that it goes to the Trash.

### The same bar in the next take. {#same-bar}

Loop the bridge of one take and open the next: the same place, still
looping. ↑ and ↓ do the same.

### False starts, cleared at once. {#false-starts}

A short take with no ★ and no marks is drawn dashed. Clear false starts
moves them all to the Trash.

## After the rehearsal. {#later}

Every take of every song, and the good ones sent to the band.

### Every take of a song, in one place. {#song-page}

A song's page has every take of it from every rehearsal, a line for each
evening, drawn to scale.

### Send takes to the band. {#cloud}

The takes you pick, or every take you save, are copied to a folder that
Google Drive or Dropbox syncs: the mix to listen to, the tracks for a DAW,
or both.

### ▶ starts just before the mark. {#mark-lead}

In Marks, ▶ plays a take from 5 seconds before the mark, so you hear the
moment coming.

### One number for each take. {#numbers}

A song's take numbers go on from one rehearsal to the next: Pałyn 17 is one
take, wherever you played it.

### The cloud copy keeps up. {#cloud-follows}

Rename, crop or delete a take, and its copy in the cloud does the same.

### A mix any phone plays. {#phone-mix}

The mix sent to the band is 16-bit, and turned down if the tracks together
would clip.

### Takes that sit on the bars. {#bars}

A take recorded to the click starts on the first click of its count-in. Put
it at bar 1 in a DAW at the song's tempo, and its bars sit on the DAW's
bars.

### The tempo inside the WAVs. {#wav-tempo}

Cubase, Pro Tools and Studio One read it and fit the take to the project.
