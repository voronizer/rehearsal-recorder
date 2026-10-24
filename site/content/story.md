# From soundcheck to the take you keep.

<!-- The four steps of an evening, by id, and under each its items: tiles
     first, then cards. Keep the ids and their order. The app beside the
     steps goes through the same four (site/src/stage/Story.tsx), and an
     item's id says whether it is a tile or a card and what the app's
     window shows for it (site/src/page/evening.ts). An item has two
     paragraphs: its tile's or card's line, then what the window says
     under the app once the item is picked. -->

## Before you play. {#before}

The tracks are filled in from last time, and each song brings its tempo and
its backing track.

### Rehearse the set, in order. {#set}

Make the gig's songs a set once. The rehearsal screen lists them in order,
and History says which ones you never got to.

On the rehearsal screen the set comes first under Next take, in order, each
song played with ✓ and how many takes it got. The rehearsal's first take is
the set's first song.

### Every song keeps its tempo. {#tempo}

Pick a song for the next take, and its tempo and time signature go into the
metronome. The click plays through the outputs you choose, so it can go to
the drummer's headphones alone.

The row at the bottom left shows the song's tempo and time signature, and
says “The song's tempo.” A change made there holds until you pick another
song, and Save to song keeps it.

### A song brings its backing track. {#backing}

Add the file to the song once. It comes in on bar 1, after the count-in,
through its own output, and the take keeps it as a track.

The app counts the file's tempo and finds bar 1. For pads with no beat, drag
bar 1 to where you hear it. In the player the take's Backing track sits right
above Master, muted the first time, so you hear the band without it.

### Hear where you left off. {#left-off}

Before you start, ▶ beside a song plays its newest ★ take.

Last time is the rehearsal before this one, song by song: how many takes
each song got and how long they ran, with the marks you left while
listening. A song with no ★ take plays its last one, usually the take you
settled on.

### Tap the tempo on a pad. {#tap}

Press Tap once, and the drummer taps the rest on any pad of the e-kit.

The tempo is the average of the last four gaps between taps, so five taps
are enough. Two seconds without a hit ends it, and what the band plays
after that leaves the tempo alone. A keyboard taps the same way.

### A tempo from an old take. {#counted}

For a song with no tempo, the app counts one from a take, listening to the
drums.

Pick a take of the whole song and its time signature, then ▶ to hear the
count. If the click runs twice too fast or too slow, which happens with
about one song in four, halve or double fixes it.

### The first take sets the tempo. {#first-take}

A song with no tempo keeps the one from the first take you record to the
click and keep.

Type or tap a tempo into the row before the take. Save now gives the tempo
to the song at once, without waiting for a take.

### Each interface knows its inputs. {#inputs}

The XR18 in the rehearsal room, a small box at home: each one puts every
musician back on their own input.

The musicians stay the same on every interface, and each interface
remembers which input each one is on. The first time an interface sees a
musician, it puts them on the lowest free input: Check signal shows if that
is the right one.

## While you record. {#during}

A count-in, then a big clock and a tile for each musician.

### Every musician on their own track. {#tracks}

Each track is written to disk as you play and kept as its own WAV file. If
the app closes during a take, you lose at most the last 30 seconds.

Each tile fills with its musician's level, in dB like a mixer's meter, and
the figure at the top is the latest peak. A tile with nothing coming in
goes dim and says “silent”, which is normal while someone is not playing.

### Notes too, from an e-kit or a keyboard. {#midi}

A track records its audio, its MIDI or both. The notes are saved as a .mid
file beside the audio.

An e-kit sends every hit down its USB cable as MIDI: which drum, when and
how hard. The player draws the notes in a lane of their own, a kit in six
rows from Crash to Kick, and never plays them.

### A count-in in big digits. {#count-in}

The clock starts at 0:00 when the band comes in.

With the click on, Record take counts the band in where the clock will be:
1 to 4 in 4/4, the first in blue. With 2 bars it counts twice. The take's
files start with the count-in, so in the player a take runs that much
longer than the clock showed.

### The beat on the edge of the window. {#edge}

After the count-in, the edge of the window lights on every click until Stop,
brighter on the first of a bar.

The edge lights even with Reduce motion on in the system's settings, since
the band may count on it. If the click's output is unplugged, the take
still records with its tempo and the edge still lights.

### How long it took last time. {#last-time}

Under the clock: “Took 2:21 last time”, with a bar that fills as you play.

The bar shows how far into the song you are. A song's first take of the
rehearsal is measured against the take ▶ plays for it in Last time: “Took
3:20 on 22 Sep”.

### A clip stays red. {#clip}

A tile that clipped stays red until Stop, and says how many times:
“clipped 3×”.

Clipped means the input got more than it can take, so the sound is
distorted. The tile stays red until the take ends, so you still see it when
you look up from your instrument.

### The laptop stays awake. {#awake}

While a take records, the laptop does not sleep and its screen does not
lock.

Closing the lid, choosing Sleep or a battery about to run out still puts it
to sleep: no app can stop that. The take then ends there, with everything
before it kept, and opens with a note saying why once the laptop wakes.

### An unplugged interface ends the take. {#unplugged}

A few seconds after the interface goes, the take stops on its own, with
everything before it kept.

After three seconds without sound the take stops and opens as usual, with a
note saying why. Plug the interface back in and record the next take. A
MIDI port that goes away stops nothing.

### Disk space in hours. {#disk}

“Room for about 28 h 40 min of recording”, counted for your tracks and
their quality.

The free disk space is shown as recording time, counted for the number of
tracks and the recording quality. When the disk is nearly full, the line
turns amber: “Low disk space: room for about 12 min”.

## After the take. {#after}

Listen to it, mark it, keep it or not.

### Marks say what happened. {#marks}

Keep this, Went wrong or the band's own label, with a comment, right on the
take.

Press Mark, or M, while a take plays, pick a label and type a comment if
you like. The marks show as colours on the take everywhere it is listed, so
you can see which takes went wrong without opening them.

### Where the band ran ahead. {#drift}

After a take, the Master row draws the band's tempo bar by bar. Where it ran
ahead or dragged, the line turns amber: “+7”.

The dashed line is the tempo the take was meant to have, and the grey band
around it is on tempo, within 2% either way. Point at a bar to read it:
“Bar 61 · 135 bpm (+7)”. The app finds the beats by listening to the drums.

### Undo, for 10 seconds. {#undo}

Deleting, discarding and cropping happen at once. For 10 seconds, Undo puts
it back. After that it goes to the Trash.

A notice in the corner says what went, such as *“Pałyn 5” went to the
Trash.*, with Undo. Undo, or ⌘Z on a Mac (Ctrl+Z elsewhere), puts a take
back with its star, its marks and its copy in the cloud.

### The same bar in the next take. {#same-bar}

Loop the bridge of one take and open the next: the same place, still
looping. ↑ and ↓ do the same.

Another take of the same song opens at the same second, with the same
selection, Repeat on or off and the same zoom. The takes don't line up
exactly, but close enough to find a chorus by ear.

### False starts, cleared at once. {#false-starts}

A short take with no ★ and no marks is drawn dashed. Clear false starts
moves them all to the Trash.

A take shorter than 30 seconds, with no ★ and no marks, says false start.
Clear false starts takes their copies in the cloud with them, and Undo
brings them all back. How short is short can be set in Settings, from 5 to
120 seconds.

## After the rehearsal. {#later}

Every take of every song, and the good ones sent to the band.

### Every take of a song, in one place. {#song-page}

A song's page has every take of it from every rehearsal, a line for each
evening, drawn to scale.

Under the song's tempo come its ★ takes, the marks left on it last time,
then every take: a line for each rehearsal, newest first. A take that ran
long or stopped short shows without reading a number.

### Send takes to the band. {#cloud}

The takes you pick, or every take you save, are copied to a folder that
Google Drive or Dropbox syncs: the mix to listen to, the tracks for a DAW,
or both.

Set a cloud folder in Settings, one that Google Drive, Dropbox or a similar
app already syncs. Send a take by hand, every ★ take with Send starred, or
every take you save automatically. Only the copies change format: the
recordings on disk stay WAV.

### ▶ starts just before the mark. {#mark-lead}

In Marks, ▶ plays a take from 5 seconds before the mark, so you hear the
moment coming.

Marks lists every mark with a label, from every rehearsal, newest first, by
rehearsal, by song or in one list. Clicking a row opens the take in the
player at the mark.

### One number for each take. {#numbers}

A song's take numbers go on from one rehearsal to the next: Pałyn 17 is one
take, wherever you played it.

The number counts the song's takes across every rehearsal, and deleting a
take does not free its number. A take nobody named is called by its place
in the rehearsal: “Take 4”.

### The cloud copy keeps up. {#cloud-follows}

Rename, crop or delete a take, and its copy in the cloud does the same.

Rename a take or a rehearsal, and its copies get the new name. Crop a take,
and its copy is made again from the cropped take. Delete one, and its
copies go to the Trash with it.

### A mix any phone plays. {#phone-mix}

The mix sent to the band is 16-bit, and turned down if the tracks together
would clip.

The mix is one stereo file with the balance you set in the player. As MP3
it is about a tenth of the size of the WAV, right for listening on phones
and wrong for a DAW.

### Takes that sit on the bars. {#bars}

A take recorded to the click starts on the first click of its count-in. Put
it at bar 1 in a DAW at the song's tempo, and its bars sit on the DAW's
bars.

Set the project to the song's tempo and time signature before you bring the
take in. A song in 6/8 shows half its number in a DAW, which counts quarter
notes: 198 in the row is 99 there.

### The tempo inside the WAVs. {#wav-tempo}

Cubase, Pro Tools and Studio One read it and fit the take to the project.

Write the tempo into WAV files is in Settings › Click & backing track, and on
until you turn it off. Ableton Live and Logic ignore it. A take recorded without the
click never gets a tempo in its WAVs, so no DAW stretches it for nothing.
