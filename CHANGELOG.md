# Changelog

Notable changes, newest first. Versions follow [semantic
versioning](https://semver.org/): until 1.0 the shape of things can still
move, though recordings on disk are never left behind — old rehearsals keep
opening.

## 0.13.1

- Nothing changed in the app. Its website, reha.stream, now goes through a
  rehearsal in four steps, from the soundcheck to the take you keep, with
  the app beside them. A click on anything a step lists shows that part of
  the app up close, with more about it underneath. On a big screen the page
  is wider.

## 0.13.0

- **A metronome, and each song keeps its tempo.** The rehearsal screen has
  a metronome at the bottom left, beside **Finish** and **Record take**: a
  switch, the tempo with − and +, the time signature (4/4, 3/4, 2/4 or
  6/8), **Tap**, and ▶ to play the click between takes. Each song keeps its
  own tempo and time signature, and picking the song under **Next take**,
  on the screen or from the controller, puts them in the metronome. A
  change made there holds until you pick another song, and **Save to song**
  keeps it. A song with no tempo yet gets one from the first take you
  record to the click and keep. In 6/8 the tempo counts eighths, so a song
  felt in two at 66 is 198.
- **The click in the drummer's headphones, and the beat on screen.** In the
  new **Settings › Metronome**, or behind the gear at the end of the row,
  you choose the outputs the click plays through, so that it can go to the
  drummer's headphones alone. Its sound (**Click**, **Woodblock** or
  **Hi-hat**), its volume and the count-in (**None**, **1 bar** or **2
  bars**) are there too. **Record take** counts the band in with big digits
  where the clock is, and the clock starts when the band comes in. From
  there to **Stop** the edge of the window lights on every click. If the
  click's output is unplugged, the take still records with its tempo and
  the beat still flashes. **Record/Stop** on the controller counts in the
  same way. On the recording screen the metronome stays at the bottom left,
  so *Recording*, the take's number and the room left on the disk have
  moved beside **Stop**.
- **A song's tempo tapped, or counted from an old take.** Tap the tempo with
  **Tap** or the T key. After a tap, the drummer can carry on tapping on an
  e-kit's pad, or anyone on a keyboard. A song's page in History has a tempo
  row of its own, saved as you change it. For a song with no tempo, **count
  it from a take** there works the tempo out from one of its takes,
  listening to the drums first, and **halve** or **double** fixes a count
  that comes out twice too fast or too slow. On the rehearsal screen,
  **count it from the last take** does the same from the song's last take. T
  is one of the player's keys in **Settings › Keys**.
- **The click when you listen back.** In the player, a button with the
  metronome's icon after **Master** plays the click with the take, in time
  with its count-in. Beside Master, the take's bars and beats are drawn as
  stripes that follow the zoom. A take recorded without the click, as every
  take from before this version was, has none.
- **Where the band ran ahead or dragged.** After a take, Master's row in the
  player draws the band's tempo bar by bar: against the click the take was
  recorded to, or the song's tempo, or, with neither, the take's own middle.
  Where the band was more than 2% off for two bars or more, the line turns
  amber with a number such as “+7”, and pointing at a bar says its tempo.
  The app listens to the drums, or, when no track has the drums icon, to
  all the tracks but a backing track. Takes from before this version get
  the line too. **Drift shown past**, in **Settings › Metronome**, sets how
  far off is off: 1%, 2%, 3% or 5%. reha.stream shows the line on the
  metronome's tile.
- **Takes recorded to the click sit on the bars in a DAW.** Their files
  start on the first click of the count-in, so with the project at the
  song's tempo, a take put at bar 1 has its bars on the project's bars. A
  take's `.mid` now carries the tempo and time signature it was recorded
  at, and one recorded with no tempo is still written at 120 bpm. **Write
  the tempo into WAV files**, in **Settings › Metronome** and on until you
  turn it off, puts the tempo into the WAVs and the mix as well. Cubase, Pro
  Tools, Studio One and FL Studio read it and fit the take to the project's
  tempo, so set the project to the song's tempo first. Ableton Live and
  Logic ignore it. A song in 6/8 shows half its number in a DAW, which
  counts quarter notes. Cropping a take recorded to the click starts it on
  a bar line, and the notice says where it now starts.
- **Plainer words in the app and the guide.** The player's row of marks is
  called Marks, and a mark's dialog says “Mark at 1:24” and has a **Delete
  mark** button. The interface check talks about your interface instead of
  a card. Messages are plain sentences without dashes: when the chosen
  output is gone, for example, the message says the take plays through the
  system output. The guide, the README and reha.stream use the same words,
  and the guide's pictures show Settings as it is now. reha.stream no
  longer promises more than the app does, and its tile about formats is
  gone.

## 0.12.1

- **Victor Baikov's controller on Windows.** It has been tried on Windows as
  well as on a Mac, and the guide now says how to pair it there: in the
  Bluetooth settings of Windows, before you pick it in **Settings →
  Controls**. His name is spelled as he spells it, and reha.stream says his
  repository also has a case to print on a 3D printer. The app itself is the
  same as in 0.12.0.

## 0.12.0

- **A new look: cobalt, calmer type, rounder corners and lower track
  lanes.** The blue of the main button, and of what plays, is a
  stronger cobalt, the same in both themes, and it is the only blue left:
  **Stop** is now the colour of the text, and a mark's blue label is orange.
  The player's time, the levels on the recording screen and most other
  figures are in the app's own font instead of a typewriter face, every
  digit still as wide as the next. Buttons are in a regular weight, and a
  row of pills no longer shifts when another one is picked. Corners are
  rounder, at 4, 8 or 12 px. In the light theme the page is now white,
  like the panels on it. Grey is left for the side panel and what you
  picked, and grey text and lines are darker, so they are easier to read.
  In the player each track's lane is 56 px high where it was over 90, so more
  tracks fit on a laptop's screen: **M** and **S** are smaller, the *Mono*
  or *Stereo* under a track's name is gone, and a track that records notes
  too has a plain line between its audio and its notes instead of a dashed
  one. Dialogs, menus and notices come and go more smoothly, and with the
  system's Reduce motion on, or while a take records, they simply appear and
  a spinner stands still. While a take records nothing moves but the meters
  and the clock: the red dot beside *Recording* no longer pulses. A red
  button is full red in the dark theme too.
- **A controller for the band: start and stop a take away from the laptop.**
  РЭХА now works with the Bluetooth MIDI controller Victor Baikov built for
  it ([reha-controller](https://github.com/viktor-baikov/reha-controller)).
  Its **Record/Stop** starts a take, and pressed again stops the take and
  keeps it; the laptop's **Stop** still opens the screen where you save or
  discard. From the controller you can also play a kept take and stop it,
  go back to its start, skip back or forward, move to the previous or next
  song or take, set the volume, start and finish the rehearsal, and remove
  a take, which the app's **Undo** brings back. Pick the controller in the
  new **Settings → Controls**; on a Mac, **Pair Bluetooth MIDI controller**
  there opens the Mac's own Bluetooth MIDI window. What the controller
  sends never ends up in a track's notes, and a take keeps recording if the
  controller drops out. It has been tried on a Mac and on Windows.
- **Deleting, discarding and cropping happen at once, with Undo for 10 s.**
  Deleting a take or a rehearsal, clearing false starts, discarding a take
  and cropping one no longer ask first: a notice says what went, and its
  **Undo**, or ⌘Z / Ctrl+Z, puts it back for 10 seconds.
- **Dialogs follow the system: its order of buttons, and its words.** On
  Windows the action now comes first and **Cancel** after it, as in Windows'
  own dialogs; on a Mac the action stays on the right. Every dialog that does
  something has **Cancel** for its way out (*Keep going* is gone from *Finish
  this rehearsal?*) and names its action with a verb: **Finish**, **Remove**,
  **Delete**, **Merge**. Enter presses the action, except in a question
  whose answer cannot be taken back (finishing a rehearsal by Esc, removing
  one from history, deleting a set or a label that has marks, merging two
  songs), where Enter is **Cancel**, so a stray key changes nothing. On
  Windows the app says *the Recycle Bin*, where its messages about deleting
  said *the Trash*. Names in titles are in quotes, *Delete “Fix”?*; finishing
  says "1 take is saved", not "1 take are saved"; a dialog keeps its words
  while it fades out instead of going blank first; and a notice shows above
  an open dialog, not under its shade.
- **The red bar that says something failed lists every problem, not only the
  last.** When more than one thing went wrong as the app started, a second
  problem used to hide the first; now each is there, oldest first, the same
  one never twice, and its ✕ puts them all away. A long list scrolls inside
  the bar instead of covering the window, and past 20 the rest are counted
  under it ("and 5 more"), so the first problem always stays in it. A
  problem in the window itself, not in Python, is now written to crash.log
  too, so the bar is right that all of them are there.
- **The start screen in three groups, with the rehearsal's name beside
  Start.** The past is on the left: *Last time*, the songs not played in it
  and *Earlier*. The tracks are one group, with *Recording with* first,
  **Check signal** and **Save as template** at its head, a line between the
  rows, and **Add track** and the room left on the disk at its foot. The
  rehearsal's name is in the footer, beside the set and **Start rehearsal**.
  In a window narrower than 1100 px (wider as the Appearance size grows:
  1430 px at 130 %) the left part is behind a **Last time** button in the
  header, which opens it from the left; the button shows when something from
  it is playing, and the sound carries on if the panel is closed. A song in
  *Last time* keeps its takes as columns at the end of its row, each as tall
  as the take ran: every starred take is green, and the one its ▶ plays
  stands out from the rest. A long name keeps its width: the figures beside
  it drop, whole and the least needed first, and show whole on hover, and a
  name longer than its whole row wraps to a second line; a name that is cut
  shows whole on hover and when a key reaches it. A track taken off can be
  put back: the notice that says so has **Undo** for 10 seconds, which
  returns the track to its place with its meter, and **Check signal** keeps
  a renamed track's meter too. Smaller things: a MIDI port's note (not
  connected, in use by another app, or shared with another track) is said in
  that track's own line, where nothing moves; **Stereo** is a button that
  stays pressed; the arrow keys reach **Audio**, **Both** and **MIDI**, and
  Space picks one; **Check signal** and **Start rehearsal** show a spinner
  when they take more than a second; an empty list of tracks says how to add
  one; and every screen's title is 20 px.
- **A song's attempts are called takes.** Where the app said *go* for each
  attempt at a song, "4 goes" or *Every go at Pałyn*, it now says *take*, as
  musicians do: "4 takes", *Every take of Pałyn*. The number beside a song's
  title is as it was, and so is "Take 7" for a take nobody named. On the
  review screen the song's takes tonight are named with it, "Viasna 2".
  reha.stream and the user guide say take too.
- **The rehearsal screen and the player in groups, where nothing jumps.**
  The evening's songs are one group: **Send starred** and **Clear false
  starts** at its head, beside the evening's marks counted by label, and
  each song's takes under a line. The evening's figures are no longer over
  the songs as well: the top of the window has them. **Next take** is one
  group beside the songs in every window: the field at its head, where a
  long name wraps, then the set and the other songs, each under a line. A
  long rehearsal name wraps instead of being cut, and the figures beside it,
  *Length*, *Takes*, *In the cloud* and *On disk*, give way to it one whole
  figure at a time, the size on disk first; pointing at them then shows them
  all. Nothing moves as a take plays, a mark nears, a crop runs or an error
  shows: a take's length keeps room for the time played beside it, so its
  bar keeps its width; **Finish** and **Record take** keep their width with
  a take in hand and at take 10; **Mark** is as wide as **Open mark**; and
  the player keeps one line between its buttons and the map for a crop, a
  take that did not load, or a warning about the output the sound is sent
  to. In the player **M** and **S** are on the fader's row, after the fader,
  so a track's name has its plate's whole width; a name still too long is
  cut, and shows whole on hover and when Tab reaches it. The tracks are one
  group, with no lines between them: each track's waveform, or its notes,
  sits on a darker well of its own, and a track on **Both** has its audio
  and its notes on one well, split by a thin line. **Master** is a group of
  its own under them, held at the bottom of the window in a band as wide as
  the lanes, so no part of a lane shows beside it. In History, with no take
  open, the evening's figures have moved from over the songs into the
  rehearsal's own head: they sit beside its name, give way when the name
  needs the room, and pointing at them shows them all. Smaller things: the
  player's **Play**, the share dialog and a lane of notes being read show a
  spinner only after a second, and a lane whose notes cannot be read says
  so; the row names in a lane of notes are 12 px, up from 9, and the lane is
  taller to hold them; **Repeat**, **M** and **S** are grey when on; the
  marker's labels are one switch that the arrow keys move along; on the map
  the part on screen is grey; and an empty set under **Next take** says how
  to fill it.
- **A new layout for the recording screen, with its status beside Stop.**
  At the top is the take: its name, the clock, and under them the bar that
  shows how far you are against the song's last take. Below are the
  tracks, one tile each, every tile on its own darker patch. The header is
  gone. The red *Recording*, the take's number (only for a take you named)
  and the line about the disk or the battery are now at the bottom left,
  beside **Stop**. A long track name wraps onto a second line up its tile,
  and gets smaller if it must, down to two thirds of its size. A name still
  too long is cut short; point at the tile to see it whole. The level in dB
  on a tile is never cut: where it has no room it hides, and pointing at
  the tile shows it. On a tile that also records notes, the notes are now
  grey where they were blue. The clock always has room for ten hours, so a take
  past 10:00:00 no longer runs off the left of a narrow window. In a short
  window things get smaller before the screen scrolls. The start screen
  and the recording screen now say the room on the disk in the same words,
  "Room for about 3 h 20 min of recording", and when it runs low, "Low disk
  space: room for about 12 min". The warning has a yellow icon and words in
  the text's colour, which are easier to read than the yellow words were.
- **The take's name is at the top of the screen after Stop.** The song and
  its number, "Viasna 2", are the title, with the pencil (**Rename take**)
  right after its last word. A long name takes a second line and is then cut
  with its number kept; point at it to read it whole. Over it is a small
  line, the take's place in the rehearsal and the rehearsal's name,
  "Take 5 · Thursday"; a long rehearsal name is cut, and shows whole when
  you point at it. A take nobody named says "Take 7", in grey. The song's
  takes tonight stand at the right as columns, each as tall as the take ran,
  with its number under it. This take's column is in the colour of the text,
  a starred take's is pale green and the rest are grey. In a narrow window
  the columns give way to the name, and pointing at the name then shows them
  as times. The line that said how long the take ran against the last one is
  gone; the player's clock, "0:00 / 2:31", has the length. At the bottom
  **Discard** and **Save take** are at the right, and the cloud line at the
  left: "Send to the cloud: the mix, FLAC" with its checkbox, or "Stays on
  this computer: no cloud folder is set". A long cloud line is cut at its end
  and shows whole when you point at it, and it holds its place while the app
  reads the setting, so nothing moves when it answers. **Save take** is as
  big as **Start rehearsal**, **Record take** and **Stop**. The two parts of
  the player come in one after the other, as on the other screens, and a
  track's fader shows a ring on its knob when the keyboard reaches it, in
  every player. In *Last time* the take that plays is in the colour of the
  text where it was grey, so the two screens draw their columns alike. The
  small line over a screen's title and the headings of the background work
  list, *Working* and *Done*, are no longer in capitals.
- **When a button fails, the app says so in a notice.** On the start screen,
  the rehearsal screen, the recording screen and the screen after Stop, a
  failure of **Check signal**, **Start rehearsal**, **Record take**,
  **Stop**, **Save take**, **Discard**, a rename or a crop used to show as a
  small red line over the buttons at the bottom. It is now a red notice in
  the corner of the window, as it already was in Settings and for the
  evening's buttons. It stays until you close it or leave the screen, and
  trying again puts it away. A notice is drawn over the screen, so nothing
  under it moves.
- **A screen that cannot open no longer leaves the window empty.** Before,
  one problem while a screen opened took the whole window with it, the
  red bar too, and nothing was left to press. Now the screen says it could
  not open, the red bar at the top says what went wrong and where it is
  written down, and **Try again** opens the app again.
- **History's pages are calmer, and a rehearsal's folder opens from its
  path.** The list down the left is on a grey panel. The switch between
  **Rehearsals**, **Songs** and **Marks** stays at its top while the list
  scrolls. A long name takes up to two lines, in the list and at the top of a
  page, and is then cut. Point at it to read it whole. The pencil comes right
  after its last word. On a rehearsal's page, the evening's figures give way
  before the name takes a second line. The bin at the right says what it does
  when you point at it. Under the name are the day, the set and the folder's
  path, where it is on the computer. Click the path to open the folder;
  pointing at it says **Show in Finder** (**Show in Explorer** on Windows).
  The button of that name beside the figures is gone from a rehearsal's page.
  In a narrow window the totals at the top,
  "5 rehearsals · 2 h 24 min played · 5.0 GB", give way one at a time, the
  size first. They used to go all at once. Each page is one card, with thin
  lines between its parts. For a rehearsal played by a set, the card starts
  with the set, in two columns when there is room. A song's card has its
  starred takes, the marks from last time and every take. When a rehearsal
  has more takes of the song than fit on its line, they carry on to a second
  line. On a label's page, **Group by** is at the top of the card. On all
  three pages, a take that cannot be loaded shows a red warning sign in place
  of its ▶, and pressing it tries again. A rehearsal whose folder is missing
  says *Not found on disk* in red on History's pages. The set's line reads
  "Gig on the 25th · 4 of 6 played", on the rehearsal screen too. While
  History reads the folder, a spinner shows after a second, and
  *Reading the folder…* only after ten.
- **Forgetting a song's old name has Undo.** On a song's page in History,
  the × beside an old name under *Also typed as* forgets it. A notice now
  says "“Palyn” was forgotten.", with **Undo** for 10 seconds, or ⌘Z /
  Ctrl+Z. **Undo** gives the name back to the song, so typing it leads to
  that song again. If the name has become another song's in the meantime,
  the notice says why it cannot come back. "Make Palyn a new song" under a
  name field forgets the name at once, as before, with no **Undo**.
- **Unsaved takes have one main button, Recover, at the bottom right.** With
  more than one take it says **Recover all** and adds the takes to their
  rehearsals one after another. If one fails, it stops there and a notice
  names that take's rehearsal and says why. The takes before it are
  recovered, and the rest stay in the list. Each row keeps **Discard**, and
  with more than one take has its own **Recover**, in a thin frame so the
  blue button stays the only one. Only one take is recovered at a time, so
  each take gets the right number in its rehearsal. While one is being
  recovered, every **Recover** is greyed. **Decide later** is beside the main
  button and works then too: it stops **Recover all** after the take in hand.
  The takes are one card, with the warning at its head and a thin line
  between the rows. The warning starts with what to do, "Recover a take to
  add it to its rehearsal." A row is titled with its rehearsal's name. A long
  name takes two lines, is then cut, and shows whole when you point at it or
  a key reaches it. Under the name are the day and time the rehearsal began,
  as History writes them ("Thu 10 Sep, 19:00"), the number of tracks and the
  length, so two takes of one rehearsal are told apart by their length.
  **Discard** and **Recover** name their take and its length, so a screen
  reader can tell those takes apart too. A recovery that takes more than a
  second shows a spinner in its button. The take's progress shows in place
  of the line under the name, and the buttons keep their words until the
  recovery ends, so nothing moves.
- **Single keys can be turned off, in Settings → Keys.** The new **Keys**
  section has two switches, each **On** or **Off**. **Space and Esc** is for
  those two keys on every screen, where they start and stop a take, save or
  discard it, play and pause, and finish the rehearsal. **The player's
  keys** is for the arrows, Home, M, R and ? while listening, and ↑ and ↓ on
  the rehearsal screen and in History. Both are on until you turn them off,
  and the app keeps the choice for next time. When a switch is off, its keys
  do nothing and no longer show on the buttons. With **Space and Esc** off,
  Space presses the button you moved to with Tab. ⌘Z / Ctrl+Z, and Esc in a
  dialog or a text field, work either way.
- **Settings is calmer, in groups, with its sections always in view.** Each
  section is laid out in groups, with more room between them and no lines.
  The list of sections on the left stays where it is while the open one
  scrolls. At a large scale in a small window (narrower than 900 px at
  100 %, or 1350 px at 150 %) the list shows the sections as icons only, so
  the open one gets the room their names took. Point at an icon to see its
  name. Where you pick one of a few,
  such as the rate, the depth, the theme or the scale, there is now a grey
  switch, as in History, in place of a row of buttons with the chosen one in
  blue. **Sets** keeps its two columns at any size, and the list of sets and
  the set you picked each scroll on their own. **Look again** keeps its
  words while it looks, and shows a spinner if it takes more than a second.
  *What gets published* is now **What gets sent**, and *What the copies are
  written as* is now **Copies are written as**. Two hints were wrong. The
  one under **False starts** now says that **Clear false starts** has
  **Undo**, where it said the button asks first. The theme and the scale
  apply as soon as you pick them, and the line that said they waited for the
  next start is gone.
- **A song taken out of a set has Undo.** In **Settings → Sets**, ✕ beside a
  song still takes it out at once, and a notice now says "“Pałyn” was taken
  out of the set.", with **Undo** for 10 seconds, or ⌘Z / Ctrl+Z. **Undo**
  puts the song back where it was, even after you have picked another set
  or left Settings. Each song taken out has its own notice. If its set has
  been deleted since, **Undo** says so.

## 0.11.1

- Nothing changed in the app. Its website, reha.stream, now measures how
  fast it loads for its visitors, with Vercel's Speed Insights, and its 404
  page leaves the addresses Vercel counts visits at to Vercel.

## 0.11.0

- **Record what the e-kit plays, or the keyboard.** Every track card has an
  **Audio / Both / MIDI** switch, and a track on *Both* or *MIDI* has a MIDI
  port to pick under it: an e-kit, a keyboard, several at once. The notes are
  saved as a `.mid` beside the take's WAVs, for a DAW; the app draws them in
  the player and never plays them. **Check signal** says *✓ notes* beside a
  port once a note has arrived. A port that is not plugged in does not stop
  the rehearsal: its card says so in amber, and its notes start the moment
  it appears, even in the middle of a take. A *Both* track's notes lane sits
  under its waveform, a *MIDI* track's has a lane of its own, and in the
  cloud *The original tracks* and the cloud's *Both* copy each `.mid` as it
  is. Under the hood shows which MIDI system the app is on. Every track so
  far is *Audio*.
- **The laptop stays awake during a take.** While a take records, the
  laptop does not go to sleep and its screen does not go dark or lock, so
  Stop and Space still work after a long jam; after Stop the system's own
  settings apply again. On battery at 20% or less, the line at the top of
  the recording screen turns yellow and asks for the charger. If the laptop
  goes to sleep anyway (a closed lid), the take ends there with everything
  before it kept, and once the laptop wakes a note says when it slept.
- **Rehearse by a set.** A set is the songs a gig needs, in the order the
  band plays them, with a name: "Gig on the 25th". It is made from the
  start screen with **New set…**, or in **Settings → Sets**, and picked
  beside **Start rehearsal**, where it stays picked; *No set* plays freely,
  as before. The rehearsal screen lists the set under the next take's name:
  the song on now lit, the one after it *next*, each one played with ✓ and
  its goes. A click on a song, or ↓ and ↑, names the next take after it,
  and a click into the name selects it whole. The band's other songs are
  listed under the set the same way, in place of the songs as buttons: five,
  and the rest one click away. History says which set a rehearsal was
  played by, and over its songs which of the set's songs were played and
  which were not.
- **After a take, just the song.** The screen after a take says what was
  recorded, in place of the name field and its songs: the song with its go,
  "Viasna 2", how long the take ran against the last go at it, "2:31 · 10 s
  longer than go 1", and the song's goes tonight as bars, each as tall as
  it ran. The pencil beside the song renames the take, and the player gets
  the room the field took.
- **Rename a song, or merge two.** The pencil beside a song's title on its
  page in History renames it: every go, with its folder on disk and its
  cloud copies, the files following in the background. The other songs are
  listed under the title; picking one merges the song into it, after
  asking, its goes numbered after the other song's own. A title left
  behind is remembered: "Palyn" typed again in any name field is Pałyn's
  next go, and the field says so, with *Make Palyn a new song* for when it
  is not. The song's page lists these old names, each to forget.
- **Every mark by its label.** History has a third view, *Marks*: the
  labels down the left, with how many marks each has, in how many
  rehearsals, and the newest; beside them every mark with the chosen label,
  from every rehearsal, newest first. **Group by** puts them under a
  heading per rehearsal, per song, or in one list, and the choice is kept.
  **▶** plays a mark's take right there from 5 seconds before it; a click
  opens the take at the mark, and Esc comes back to the list. Marks of a
  rehearsal not on disk stay, greyed.
- **Sort the evening as it goes.** The rehearsal screen, and a rehearsal
  in History, sort the evening while everyone remembers it. A take nobody
  named has the songs under it, and one click names it. A take under 30
  seconds with no ★ and no marks is drawn as a false start, and **Clear
  false starts** moves them all to the Trash, after asking. **Send
  starred** sends every ★ take not in the cloud folder yet, as *What gets
  published* says; that choice in Settings no longer needs automatic
  sending on. Settings also say how short a false start is. **Finish**
  now goes straight back to the start screen.
- **Measured against last time.** The rehearsal screen keeps the next
  take's name and the songs in a panel on the right. The first take of a
  song tonight is measured against how it went before tonight, its newest
  ★ go or the last go of the last rehearsal that played it, with the day:
  "Took 3:20 on 22 Sep".
- **Every song has a page.** History has a *Songs* view beside
  *Rehearsals*, and opens on the one used last. A song's page has every go at
  it, from every rehearsal, one line an evening with its goes drawn to
  scale; a click opens an evening's goes to play, open, star, rename or
  delete. Its ★ goes come first, and the marks from the last time it was
  played under them. A song's title on the setup screen, or in a
  rehearsal's overview, opens its page.
- **Compare goes at the same bar.** The strip over the player has a tab for
  each song of the evening, and a take with no song has its own; **Songs**
  opens them out into columns of goes. Another go at the same song opens at
  the same place, with the same loop, Repeat, zoom and playing, so the
  chorus of Pałyn 2 and of Pałyn 4 are one click apart; ↑ and ↓ do it too.
  Opened from a song's page, the song's column has every go at it, the
  oldest first, from every rehearsal. A long name is cut short, whole on
  hover; with more songs than fit, the mouse wheel moves the strip
  sideways, and ‹ › at an edge show there are more.
- **The evening at the top of the window.** The player and the rehearsal
  screen say how long the takes run, how many takes of how many songs, how
  many are in the cloud and how much of the disk the rehearsal uses, with
  **Show in Finder** (**Show in Explorer** on Windows) to open its folder,
  in place of the folder's path.

## 0.10.0

- **The app is called РЭХА now.** РЭХА is Belarusian for “echo”, and it
  sounds a little like “rehearsal”. The window, the Dock and About, Under
  the hood and the report for a bug say so; the app itself is the file
  Reha: Reha.app on a Mac, Reha.exe in the Reha folder on Windows. The
  downloads keep their names, so older copies find this version as before,
  and the settings and the recordings stay where they were.
- **Marks have labels you make.** A mark's label is a name and a colour, and
  **Settings → Marks** is where the band makes them, renames and recolours
  them, drags them into order and deletes them; a label with marks asks
  which label they move to first. *Note*, *Keep this*, *Went wrong* and *Do
  again* are where every library starts, and every mark keeps its look. The
  marker dialog offers the labels in their order, with the first chosen.
  Every mark is listed under its take now, by its label's name and its
  comment — a plain mark with nothing written included — and a *Note*'s tick
  shows on the waveform, which it never did. Older histories move over the
  first time this version opens them (#12).
- **★ marks a take worth coming back to.** A click on the ★ on a take's
  row, or beside the open take in the player, puts a star on it or takes it
  off. A song can have several, and a take with no song can have one. A
  starred take is the green one, in the list of takes and in the evening
  strip; a *keep this* mark is about a moment again, and no longer turns its
  whole take green. On the setup screen, ▶ on a song plays its newest starred
  take, wherever it was played, and says which. Nothing is starred for you
  (#12).
- **A take is a go at a song, and the go is a number of its own.** The name
  field holds the song's title, with the go it will be dimmed beside it, and
  the songs under it put only the title in. The go is counted across every
  rehearsal — yesterday's Pałyn 2 is followed by today's Pałyn 3 — and shown
  from 1, beside the title, wherever a take is. A number is never given twice: deleting the latest go
  does not free it. A typed number does not
  change which go a take is; a song is spelled one way everywhere; a title
  can end in a number ("Opus 5") when no song is called "Opus"; and a
  recovered take nobody named is "Take 5", like any other. Older takes move
  over the first time this version opens the recordings folder (a copy of
  the history is kept beside it, as `library.sqlite.bak-0001`), their goes
  numbered afresh in the order played, and their folders and cloud copies
  are renamed to match in the background, as *Putting names right*. This is
  what the song pages and starred takes will stand on (#12).
- **The songs under the name fill two rows**, tonight's first and then the
  ones played at earlier rehearsals, and **All songs…** at the end opens
  every song you have played, alphabetically, in columns. When tonight
  alone has played more than two rows hold, the songs played latest stay.
  A click puts a song in the field; nothing moves under the pointer (#10).
- **The take's name is one field, over the main button, before recording
  and after.** On the rehearsal screen it is left of Record, as *Next take*;
  after Stop it is in the same place, left of Save take, holding the name
  picked before recording, so a wrong one is put right there and then. Type
  in it, or click a song under it; ✕ puts back the name the take would have
  anyway, and the field is never left empty. Space types a space in it, and
  Enter or Escape leave it, so the next Space records or saves; so does a
  song or ✕ clicked while typing, which sends only the name clicked, not the
  half-typed one. A name typed and never confirmed is still the one
  recorded. Other… is gone: the field is where another name goes (#10).
- **Every footer is one row**, the buttons on the right and the main one
  rightmost, so it is in the same place on every screen. Finish, Discard,
  History and Decide later have an edge, and read as buttons. On the setup
  screen Last time has moved to the left, so the new rehearsal's setup is
  over Start rehearsal.
- **Rename take uses the same field and songs**, on the rehearsal screen and
  in History: ✕ there puts back the name the take has, and Enter renames.
- **How loud takes play, from the header.** A speaker beside History, on
  every screen a take can be played from: setup, the rehearsal, History and
  the review screen. Behind it is the same **Master** as under a take's
  tracks, and turning either moves both. A take played straight from a row,
  in Last time or a rehearsal's overview, could only be turned down by
  opening it; when the sound goes out through the audio interface, the
  Mac's own volume keys often do nothing. It can be set before anything
  plays, and the next take starts at it (#14).
- **The take's name, big, over the clock while it records.** It was the
  smallest thing on the recording screen, grey in the corner, and it is
  what most often goes wrong: the band has moved on to another song and
  nobody changed it. Now it is half the size of the clock and reads from as
  far. A take nobody named says "Take 3" there, which is the sign. The
  number has moved up beside the red RECORDING, and the bar under the clock
  says only "Took 2:21 last time", since the song is over it (#11).
- **A clip stays on its tile until the take ends**, red and counted,
  "clipped 3×". It was kept for a minute, and a minute is shorter than most
  songs: whoever was playing when it happened looked up to nothing. The pill
  in the middle that said "All 4 tracks recording", or which tracks had
  clipped, is gone, and with it the room it took from the tiles. Running out
  of disk is said where the free space always is, in the top corner, which
  turns yellow.

## 0.9.0

- **The app says when a newer version is out.** A dot on the gear on the
  setup screen, another on Under the hood in Settings, and there an Updates
  section of its own, under the card with your version: which one is out,
  **Download** and **What's new**, or that this is the latest once GitHub has
  said so. To know, it asks GitHub which version is the latest when it starts
  and once a day, sends nothing else, and never asks while a take records;
  with no internet it just does not find out. **Check for new versions** in
  Under the hood switches it off. It only does this from this version on, so
  0.9.0 itself is the last one to find by hand (#6).
- **Download, in Updates**, fetches the new version for your system into the
  Downloads folder, checks its size, its SHA-256 and every file inside it
  against the release, and opens the folder with it picked out. Unpack it,
  close the app and open the new copy; the old one is not touched. On Windows
  a zip the app downloads itself carries no "from the internet" mark, so it
  needs no unblocking. A download cut short or damaged leaves nothing behind
  and can be tried again. Only when asked: nothing is downloaded on its own.
  Replacing the app itself waits for the builds to be signed (#6).
- **A take sounds when Play is pressed.** The player's output was opened with
  whatever the driver calls its "high" latency, as the inputs were until
  0.7.12. Through FlexASIO that held the sound back by over three seconds:
  Play started three seconds late, Pause stopped three seconds after it was
  pressed, a jump played the old place first, and the playhead and the meters
  ran three seconds ahead of what was heard. Now the card is asked for 50 ms,
  or its own low latency if that is longer: about 0.2 s through FlexASIO and
  0.1 s through the system's own output.
- **Last time has a panel of its own** on the setup screen, down the side
  and darker than the screen, as History's list is. On the same background
  as the tracks, the two columns ran into one.

## 0.8.0

- **Songs you have played are a click away when naming a take.** Under the
  name on the review screen, and in the Rename take dialog, are this
  rehearsal's songs and then the rest of the band's, the most recently
  played first. Each gives the take its next number, so with "Polyn" and
  "Polyn 2" recorded it names it "Polyn 3". Typing narrows the list.
- **Name the next take before playing it.** Above **Record take** is the
  name the next take will get, with the songs it could be instead beside
  it. When the band moves on, click the song, or **Other…** for the rest and
  a new name. The take is recorded under that name, with the recording
  screen timing it against that song's last go. A discarded take leaves the
  name for the next go.
- **Last time, on the setup screen.** Beside the tracks is the rehearsal
  before this one, song by song: how many goes each song got and how long
  they ran, with the notes left while listening. ▶ on a song plays its last
  go, so the band can hear where they left off before starting. Under it
  are the songs not played last time, each with its own last go, and the
  rehearsals before. It rests on what every take has, its song and its
  length, rather than on marks, which few takes get. A soundcheck with no
  named takes is skipped. While something plays there, Space and Esc are
  its; **Check signal** and **Start rehearsal** stop it.
- **History shows the list and the rehearsal together.** The rehearsals are
  down the left, by month, and the chosen one's takes beside them, so looking
  for the evening with the good take no longer means opening one after
  another. ↑ and ↓ go through them. Each rehearsal in the list draws its
  evening as a strip, a bar per take as long as the take, grouped by song,
  in place of "Polyn ×4 · Vesna ×3 · and 2 more". A take opened in the
  player has the whole window, and Esc brings the list back. The setup
  screen's **Open** and its list of rehearsals open history on the one
  chosen.
- Durations just under a whole hour, such as the disk space left, read
  "2 h" rather than "1 h 60 min".
- **Each track has an icon**, chosen at the start of its row on the setup
  screen: vocals, a microphone, electric and acoustic guitar, bass, drums,
  percussion, keys, synth, winds, strings, a click, a backing track, or a
  plain one. It is in the top left corner of the track's tile while
  recording, and beside its name in the player. Nothing is guessed from the
  name, and until one is chosen a track has the plain one. It is kept with
  the band, like stereo.
- **The player's tracks are lower**, 96 px at most rather than 160: beside a
  tall lane the name, M, S and the fader sat in a mostly empty card. Each
  track now says whether its file is **Mono** or **Stereo**, and a stereo
  track's meter is two bars, left above right, as on the waveform.

- **A take's whole row opens it** in a rehearsal's list of takes, not only
  its bar. The bar is drawn to the take's length, so a short take's bar was
  a small thing to aim at, while the row lit up under the mouse all the way
  across and a click on the rest of it did nothing. The buttons on the row
  still do their own jobs.
- **Corners are rounded less**, 6 px rather than 12 for a block, a button 4,
  a tile on the recording screen 10. Everything looked soft.
- **The wheel scrolls the page in the player, and Ctrl and the wheel zoom**,
  ⌘ and the wheel on a Mac. The wheel on its own zoomed the take whenever
  the mouse was over the tracks, so a page with tracks below the fold could
  not be scrolled from the middle of it. A pinch on a touchpad still zooms,
  and Shift and the wheel, or a sideways swipe, still move along the take.
  The list of the player's keys, behind ? and the keys button, has both.
- **A map of the whole take above the ruler**. Zoomed in, the part on
  screen is a blue stretch on it and the selection an orange one. Drag the
  blue stretch to move along the take, or click the map to go there. Only
  two times in a corner said which part was on screen, and **Whole take**
  beside them read as one more word. It is a button now, beside the map,
  and at the closest zoom the map says so rather than the times breaking
  over two lines. The map is there zoomed out too, so nothing moves down
  when the wheel first zooms.
- **The selection carries its own buttons**, and only while it is on
  screen. They were in the player's row, far from the stretch they act on.
  In the selection's orange tag with its times, a loop turns Repeat on and
  off, and a cross removes the selection: a Clear button under the times
  read as clearing that part of the take. **Crop** is under them. **Repeat** in the player's
  row has moved next to the time, with the playing, and **Mark** to the end
  of the row.
- **The built app says which version it is.** On macOS About and Finder's
  Get Info said 0.0.0, and they now give the release's number and the
  copyright. On Windows the .exe had no version at all: Explorer now shows
  it under Properties → Details, with the copyright, and Task Manager calls
  the app Rehearsal Recorder. The build's self-test checks the number on the
  file against the app's own. Run from source on macOS, the Dock, the menu
  bar and About had Python's icon, name, version and copyright, and now have
  the app's own, as the Windows taskbar already did.
- The self-test writes UTF-8. On Windows its output into the build's log
  showed "—" as "�", and a path the system's code page cannot spell, such
  as a Cyrillic user name on an English Windows, stopped it at its first
  line.

## 0.7.13

- **The player has a Master for the whole take**, under the tracks, as on a
  desk. It is for listening: turning the band down meant pulling every
  fader, which lost the balance and changed the copy sent to the cloud,
  since that is mixed from the faders. The master changes neither, and the
  next take, or the next time the app starts, plays at the same level. Its
  meter shows the whole mix and turns red when the tracks add up past full
  scale, which no track's own meter can show. It stays in view while the
  tracks scroll.
- **A rehearsal's takes are a list you can play.** With no take open, the
  rehearsal screen and a rehearsal in History show each song with every go
  at it as a row: a bar drawn to the take's length, with its markers where
  they fell and its notes under it. A go that ran long or stopped short
  shows before anything is read. They were small chips of a number and a
  length, and the notes were a separate list below. **Play** on a row plays
  the take right there, without the player: the bar fills as it goes, and
  Space pauses it, the arrows skip and Esc stops it. The bar opens the take
  in the player, and one that is playing goes on playing there. Back from
  the player, a take that is playing plays on in the list. Pointing at a
  row shows rename, the cloud and delete for that take. Above the songs
  are how long was played, how many takes and songs, how many are in the
  cloud, and how many notes of each kind.
- The meters beside the faders go to rest as soon as a take is paused. They
  stayed at the last level until it played again.
- **The keys work after the mouse.** On Windows a clicked button keeps the
  focus, and Space pressed it again. Pressed after **Check signal**, Space
  started the check again instead of the rehearsal. After a fader had been
  touched, no shortcut worked, Escape included. Now Space, Escape and the
  player's keys do what the screen says whatever was clicked last. A button
  reached with Tab is still pressed by Space. In a text field the keys still
  type, and Esc leaves the field and does nothing else. So on the review
  screen you can type the take's name, press Esc, then Space to save it,
  without being asked about discarding it. An open dropdown keeps its keys
  too: Space in the list of inputs on the setup screen used to start the
  rehearsal, and Esc in a list in Settings closed Settings as well.
- **Settings › Playback output always shows the Outputs.** They were shown
  only for a device with more than two outputs, so the choice was hard to
  find. On Windows the same desk has two outputs under MME or WASAPI and
  all of them under ASIO. Each output device now says how many outputs it
  has. Where there are several drivers, a device with two says that another
  driver may show more. With the
  system output, the Outputs are greyed out and it says to choose the
  interface itself.

## 0.7.12

- **The meters read like the mixer's.** When checking the signal and while
  recording, the level is drawn in dB, from −60 at the bottom to full scale
  at the top. With the gain set on the desk so that the loudest hit reaches
  −18 dBFS, that hit fills about two thirds of a tile. Before, it filled an
  eighth. The figure on a tile holds the latest peak for a moment, the way
  the line does. It used to change fourteen times a second, and what the eye
  kept of it was the quiet between the hits, far below the peak a mixer
  shows. An input counts as silent below −60 dBFS. The line was −34, where
  a quiet passage sits at that gain. So a singer between phrases dimmed as
  silent, and an input played quietly read as silent on the setup screen
  and in Check the interface. A meter rises at once and falls back 20 dB a
  second, as on a desk; dropped to each moment's level, a voice made it
  blink. The player's meter is unchanged.
- **The meters follow the sound as it is played.** Inputs were opened with
  whatever the driver calls its "high" latency. For FlexASIO that is a
  second: the meters ran a second behind the voice, the sound came in one
  burst a second, so a tile lit up and went dark, and a take's first sound
  arrived two seconds after it started. Now the card is asked for 50 ms, or
  its own low latency if that is longer. On FlexASIO that gives 64 ms, with
  the first sound in under a third of a second. The level written to disk
  is the one arriving from the card, as it always was.

## 0.7.11

- **Settings › Under the hood** is a page to open when something has gone
  wrong. It says which version this is and whether it is the built app, what
  the app records and plays back through, every audio system on the machine
  with how many devices each lists — so whether ASIO is there at all is
  plain — and the audio engine, the system, where deleted things go and what
  compresses the cloud copies. **Check the interface** runs `--audio-probe`
  from the window: it listens with the settings in force, tries again one
  change at a time if that fails, shows each attempt as it goes, and ends
  with which inputs had signal — or, for a card that sends only silence,
  that it is not the card — or what is wrong and what to do; **Stop** ends
  it early. **Copy details for a bug report** puts all of that, with the band
  on the card's inputs and the last check, on the clipboard as plain lines,
  and **Show** opens the folder with the settings, the history or the crash
  log. It used to be a version number, a path and the local server's
  address.
- The app has its own icon: a red record button with a waveform in it, on
  the taskbar and in Explorer on Windows and in the Dock and Finder on
  macOS. It had PyInstaller's default, and run from source on Windows the
  Python logo — on the taskbar too, which goes by the program rather than
  the window until the app says it is an app of its own. The small sizes, in a title bar or on the taskbar, have a
  plainer drawing of their own that still reads at 16 px. The same logo
  sits beside the app's name on the setup screen and above the line shown
  while the app starts.

## 0.7.10

- A take's copy in the cloud follows the take, however it got there. A
  renamed take or rehearsal renamed nothing in the cloud when automatic
  sending was off, or when the rehearsal was already finished; with sending
  on, every take was mixed again into a new folder and the old one was left
  behind, empty. A rename now moves the files where they are, with nothing
  mixed again. A cropped take sent by hand vanished from the cloud, and one
  sent as mix and tracks came back as the mix alone: it is now made again
  from the cropped take in the shape it had. A deleted take or rehearsal
  takes its copies to the Trash, and its folder in the cloud goes once it is
  empty; the question before deleting says so, since that folder is the
  band's. A new balance or format also mixes again the takes of the rehearsal
  in progress that were sent by hand, keeping their tracks. Empty rehearsal
  folders left in the cloud by earlier versions are swept up at start.

## 0.7.9

- `--audio-probe` listens, instead of only opening. It called a card "ok"
  as soon as the stream opened, and the Realtek ASIO driver on some laptops
  opens every time and then sends one block and nothing more. Each attempt
  now waits for a first block as long as the app does, counts what arrives
  after it, and when sound comes with the settings in force it says which
  inputs had signal and stops there. A card that opens and sends nothing
  gets its own answer. The probe also opens the card the way the app does,
  on the audio thread with a callback: from the main thread in blocking
  mode it crashed that same Realtek driver, and could never have shown the
  "Failed to load ASIO driver" the app itself ran into. It reads the tracks
  the way the app does, too — where each is plugged in on this card, a
  stereo track's second input included — rather than a list that no longer
  carries the inputs, which stopped it before it asked anything.
- The recording screen is made to be read from across the room, not from the
  laptop: nobody stands at it while they play. A big clock; under it, on a
  second go at a song, how long the last go took ("Vesna took 2:21 last
  time") on a bar that fills as you play; one line that says all is well, or
  which track clipped — kept for a minute, since nobody was looking when it
  happened — or that the disk is running out; and a tile per track that
  fills with its level, red-edged after a clip and dimmed while nothing
  comes in. Every track gets a tile of one width in one row, sixteen of them
  included, with a stereo track split down the middle and the track's name
  running up the tile from its bottom corner, so a long one is not broken
  in two across a narrow tile.
- A disk that lasts for days says "Room for many hours of recording". It said
  "Room for about many hours", on the setup screen and while recording.
- The guide in `docs/using-it.md` is written for the person recording, in
  plain words, with a picture of every screen. The reasons behind how things
  work moved to `docs/design-notes.md`. The pictures show a band of four and
  waveforms that look like one, and `tests/docs_screenshots.py` takes them
  again after a change; the README keeps one of them.

## 0.7.8

- **Record take** stands on its own. The line under it, "records “Take 1”",
  mostly repeated the button; the name a take inherits — "Polyn 2" after
  "Polyn" — shows beside its number once it is recording.
- **Finish** sits beside **Record take**, the way Discard sits beside Save
  take. It was up in the header, away from the only other thing to do on
  that screen.
- The background-work button says what it is about, beside **History**: "1
  working · 64%" while a copy runs, then "Done", or "1 failed" in red, until
  it has been looked at. It was a ring the size of a letter, and then a dot,
  easy to take for nothing at all.

## 0.7.7

- An interface reached through ASIO opens. Checking the signal, recording and
  playing through one all failed on Windows with "Failed to load ASIO driver"
  (`PaErrorCode -9999`), whatever the card. An ASIO driver can be loaded
  only from a thread that has joined a COM apartment, and each call from the
  interface arrived on a new thread that had joined none. Every stream is now
  opened, started, stopped and closed on one audio thread that joins one
  first. A stream that opens but will not start is closed again, rather than
  left holding the card so that every later attempt says it is in use.
- A take whose interface goes quiet stops by itself and is kept. An ASIO
  card that is unplugged mid-take never says so: PortAudio ignores the
  driver's reset request and goes on reporting the stream as running, so the
  screen said "Interface connected" over a take that had stopped recording.
  Three seconds with no sound from the card now stops the take, saves what
  was captured, and says why in a notice that stays on the review screen —
  which is where the reason used to vanish even when the card did say so.
  A card that has just been started gets five for its first sound: FlexASIO
  took two to send one.
- The signal check and playback notice a card that goes quiet too. The
  check stops and says so beside it; playback pauses and says so, and the
  next play tries the card again before falling back to the system output.
  Both used to sit there with the bars at rest or the cursor frozen.
- A driver that stops answering no longer freezes the app. Stopping a take
  gives up on it after fifteen seconds and finishes the take all the same;
  until the driver answers again, checking the signal, recording, playing
  and **Look again** say so at once instead of waiting behind it.
- Closing the window mid-take lets go of the card and closes the take's
  files at once, and the take is offered as an unsaved take next time. It
  used to go on recording while the app shut down around it.
- An unsaved take that was already stopped says how long it is. One stopped
  and then left unsaved when the window closed was listed as 0:00, and
  recovered as a take of no length, since only raw files were measured.
- A take that will not start leaves nothing behind, whether the card or the
  disk refused. Its empty files stayed in the drafts folder, open, and came
  back as a 0:00 unsaved take — and kept the rehearsal folder from ever being
  cleaned away.

- Long work says how far along it is and how it ended, on every screen. A
  button in the header shows what is running — a cloud copy, a crop, a take
  being saved or recovered — with a bar each, and what has finished, with
  Retry on a copy that failed. Copying a take to the cloud by hand now runs
  in the background like the automatic copies: the dialog closes at once, and
  the corner says when the copy is there, or why it is not.
- Saving a stopped take no longer reads each track into memory whole: about
  500 MB for an hour of one 24-bit track.

## 0.7.6

- An interface switched on after the app started can be found without
  restarting. The list of interfaces was made once, at start, so a desk
  plugged in later was never offered — and at a rehearsal the desk is usually
  switched on after the laptop. **Look again**, in Settings beside the list
  of interfaces, makes the list again for recording and playback both. It is
  never done while recording, and never on its own: on Windows it starts
  every ASIO driver on the machine in turn.
- A chosen interface that is not plugged in is said to be not connected. The
  setup screen used to say "No interface chosen", which was wrong — it had
  been chosen; and on a Mac it did not say even that, but quietly took the
  first input in the list, usually the laptop's own microphone. It now says
  "“X18/XR18” is not connected" and offers **Look again**; once the desk
  turns up, the tracks take the inputs it remembers, with any names changed
  meanwhile kept.
- Messages about something that just happened appear at the bottom right,
  over the screen — above a screen's footer, never on Start, Stop or Save
  take — and move nothing. "Folder saved" and "Found “X18/XR18”" used to
  appear above the settings they were about, push the whole panel down a
  line and, a few seconds later, let it jump back up. A success goes by
  itself; a warning or a failure stays until it is closed. History and the
  unsaved-takes screen say what failed the same way. What is true rather
  than what happened — a track waiting for an input, an interface that is
  not connected — stays where it is.
- Changing the playback output while a take is open says so when the take
  lands somewhere else. Python always said so; Settings read only whether the
  change went through.
- A crop that went through but could not move the original out of the way
  says so as a warning. It was shown in red where failures go, on a take that
  had in fact been cropped.
- The free-space estimate counts a stereo track as the two channels it
  writes. 0.7.5 said it did, but only the Python side had learned to count
  channels: the setup screen and the recording screen both still asked it
  about tracks, so half a band in stereo was still promised half again as
  much room as there is.

## 0.7.5

- A track can be recorded in stereo. A keyboard has two outputs, and so does
  a pair of microphones over a drum kit; recorded into one mono file, half of
  what arrived was thrown away, and recorded as two tracks they were two
  tracks — two lanes, two faders, nothing saying they belong together. The
  **Stereo** button on a track takes the input after its own as well and
  writes the pair as one two-channel file. Being stereo belongs to the
  instrument rather than to the card, so it survives a change of interface,
  and each card remembers which pair the instrument sits on.
- Both inputs of a pair have to be free. Turning stereo on where the next
  input is already somebody else's leaves that track waiting for an input,
  and says so, rather than quietly recording one signal into two tracks. A
  pair cannot start on the last input of a card, and those inputs are not
  offered.
- Levels and waveforms are kept per channel, which is the reason to bother. A
  meter is one bar of the usual height split along its length — left above,
  right below — and the player draws a stereo lane with its left channel
  above the centre and its right below. An overhead that stopped arriving is
  visible at the moment it stopped instead of being covered by the microphone
  that still works, and the signal check waits for both sides before calling
  a track checked.
- Playback stopped silently discarding channels. A file with more than one
  channel was played as its first channel with nothing said about the rest,
  which had been true of every stereo file the app could open.
- The disk estimate counts channels rather than tracks, so half a band in
  stereo no longer promises half again as much room as there is.
- A crashed take with a stereo track in it recovers as stereo. A `.raw` file
  carries no header, so the recorder writes a small record of each track's
  width beside them and removes it once the wav headers exist.
- A one-input card is asked whether it takes one channel. It was asked about
  two, whatever it was, so it answered "invalid number of channels" to every
  rate and the whole list came back empty — true of every one-input card
  since rates were first offered.

## 0.7.4

- The band survives a change of interface. A saved track carried two facts
  welded into one record — the name, which belongs to the band and is the
  same wherever they play, and the input number, which belongs to the card.
  Input 3 on an eighteen-input desk is somebody's guitar; on a two-input box
  it does not exist. They are stored apart now: the band is one list of
  names, and each interface remembers which input each of those names uses
  on it. Rehearse on the desk, record at home on a small box, come back next
  week — each card brings its own numbers back, and the band is the same on
  both. Starting a rehearsal saves that layout, so nobody has to remember a
  button.
- A track with nowhere to plug in says so instead of going blank. Where the
  band outnumbers the card's inputs, everybody still appears and the ones
  who do not fit arrive with no input, marked, and the rehearsal will not
  start until they have one — which musicians sit out is the band's answer,
  not the app's. The input selector used to show an empty box for a track
  numbered past the card, and the first real word came from PortAudio when
  the signal check opened the card: `Invalid number of channels [PaErrorCode
  -9998]`, a number about a card for a mistake about a template.
- The setup screen says how many inputs the interface has, beside the rate
  and the depth. That count governs every row of the track list underneath
  it and was the one thing not on screen.
- A card that will not say which rates it takes says so, instead of being
  shown as a card that takes all of them. The list used to fall back to
  44.1, 48 and 96 in silence, so a card that answered nothing looked exactly
  like one that said yes to everything. An XR18 has no 96 kHz at all and
  takes only the rate its own mixer is set to.

## 0.7.3

- A card that refuses to open can be asked why. `--audio-probe` opens the
  saved card several times over, changing exactly one thing each time — two
  channels instead of eight, the rate the driver is already at, the block
  size left to the driver, the outputs opened alongside the inputs — and
  reads the diagnosis off which attempts got in, then says what to do about
  it. Needed because a refused ASIO stream reports `-9999`,
  paUnanticipatedHostError, which means only "the driver said no and
  PortAudio has nothing to add": nothing in the app could tell a card held by
  a DAW from tracks assigned past the card's inputs.
- Playback says why a card was not used, instead of blaming the rate. Every
  refusal was reported as the card not taking the take's sample rate, and
  pointed at Audio MIDI Setup — a program only macOS has, offered to Windows
  too. The commonest refusal is not about the rate: PortAudio answers
  `paDeviceUnavailable` when the card is already open, and on ASIO that is
  routinely this app's own recording, since a card reached through ASIO plays
  through one program at a time. So you pressed play while recording through
  your interface, heard it come out of the laptop speakers, and were sent to
  check a sample rate that was never the problem.
- ASIO drivers are loaded far less. Asking a card what rates it takes cost
  six full load-and-unload cycles of the driver — PortAudio answers each such
  question by loading it, initialising it, asking and unloading it again, and
  answers without ever consulting the sample depth. It is three now, one per
  rate, and the answer stands for both depths. Asking a playback card in
  advance cost another cycle on every take, immediately before an opening
  that loads the driver once more; ASIO cards are not asked at all now, the
  opening decides, and a refusal there falls back to the system output the
  way the check used to. ASIO drivers are known to be touchy about being
  cycled, and none of that churn was buying an answer.

## 0.7.2

- The cloud settings fit on the screen. What a copy is written as, and what
  gets sent automatically, were six full-width cards with a heading and a
  sentence each, for two questions answered once; they are rows of small
  buttons now, the way the theme and the scale already are, with the sentence
  kept for the choice in force. How a copy is written comes first, under the
  folder, because it holds whether or not sending is automatic — the takes
  sent by hand are written the same way.
- The cloud folder decides what that part of the screen shows. Without one
  there are no copies, so nothing about a copy is offered at all; the folder
  says the whole of it. It used to leave everything on screen, greyed, with
  three sentences explaining copies that could not happen — and, before that,
  live: a format could be chosen for files nothing was going to write.
- With a cloud folder set and automatic sending off, what would be sent is
  still shown, greyed, saying so. It used to vanish, which moved everything
  under it out from beneath the pointer.

## 0.7.1

- Escape on a rehearsal with takes in it flickered and stayed put: the
  question about finishing opened and closed on the same press, so the only
  way out of that screen was the button. New in 0.7.0, and the reason for
  this release.
- A dialog's answers can be reached from the keyboard. The left and right
  arrows, and Tab, move between them, and the question about finishing a
  rehearsal opens on **Keep going** — so Escape, an arrow, Enter ends a
  rehearsal without the mouse. This is the app's own doing now rather than
  the window toolkit's: on a Mac, Tab moved focus out of the page entirely
  unless macOS **keyboard navigation** had been switched on, which it is not
  unless you went looking for it.

## 0.7.0

- The rehearsal history moved from a `session.json` in every rehearsal folder
  into one database, `library.sqlite`, at the top of the recordings folder.
  Old rehearsals move themselves in the first time this version opens the
  folder — nothing to do by hand, and the recordings on disk do not change.
  An older version opened on the folder afterwards shows an empty History,
  since the `session.json` files are gone; nothing is lost — the recordings
  are untouched, and anything that old version records is moved in the next
  time this version opens the folder.
- Keep the recordings folder on this computer's own disk — not in a synced
  folder or on a network share — open it from one computer at a time, and
  move or copy it with the app closed: the history database in it is written
  while the app runs.
- A rehearsal whose folder cannot be found — moved, renamed outside the app,
  or on a drive that is not plugged in — stays in History instead of
  vanishing, marked "Not found on disk", with "Locate folder…" and "Remove
  from history".
- The cloud folder can be moved to a new place — another drive, another
  machine — without every take being sent again: a cloud copy is kept
  relative to the cloud folder, so it is found again wherever that folder is
  now instead of at the absolute path it was copied to.
- Settings are written atomically — beside the real file, then moved onto
  it — so an app killed mid-write leaves the old settings rather than half of
  new ones.
- On Windows, ASIO is offered. A 16-channel mixer was listed with 2 or 8
  inputs because the PortAudio loaded by default has no ASIO; the one with
  ASIO ships in the same package and is now loaded instead. Starting the app
  can briefly interrupt other sound playing through a device in exclusive
  mode — once, at launch.
- The recording interface and the playback output are chosen through their
  driver first when there is more than one, instead of one list with the
  same card in it four or five times. On a Mac nothing changes.
- Device choices are remembered by name and driver, not only by position in
  the list, so plugging something in no longer moves them. On Windows a
  choice saved by an older version has to be made once more.
- The self-test fails a Windows build that lacks ASIO.
- Playback can come out of any stereo pair of a card with more than two
  outputs — 3–4 into the headphone amp, say — or out of one output on its
  own. It used to be 1–2, always. Choosing another card starts it again from
  1–2, since a pair means something different on every card.
- On Windows, **Save take** did nothing: the button dimmed and stayed that
  way. The review screen plays the take it is asking about, and Windows will
  not move a file that is open for playing. Deleting a take or a rehearsal
  while it played failed the same way. The player now lets go of those files
  first. On a Mac the move had always worked, which is why this was not seen.
- On Windows a take or rehearsal could not be renamed to anything in
  Cyrillic — or in any script outside Western European — and nothing said
  so. The rehearsal's file and the settings were written in the system's
  code page, cp1252 there; they are UTF-8 now, and files an older version
  wrote are still read. Renaming the take that was playing also left its
  folder under the old name without a word; the player now lets go of it
  first. And a folder is never left renamed under a record that could not
  be written.
- Saving a take says whether it goes to the cloud folder — "Send to the
  cloud — the mix, MP3" — and the box can be turned the other way for that
  one take: a false start kept anyway need not go up, and the one good take
  of an evening can, with sending off. A take kept out stays out of later
  re-sends of the rehearsal too. With no cloud folder it says the take stays
  on this computer.
- When something fails inside the app, it says so. A red bar gives the
  error's own words and where the full traceback is kept
  (`~/.rehearsal-recorder/crash.log`, which a windowed build now actually
  writes it to), and the screen that asked gets an answer — a button no
  longer dims and stays dimmed. Saving a take and renaming one both failed
  on Windows with nothing on screen at all, which is what this is for.
- The keys are on the buttons they press: Space on the main button of each
  screen, Esc on Back, on Discard and on Finish. The line under the main
  button that said the same thing for Space alone is gone. A key is shown
  only while it really does that — with a take open Escape closes the take,
  so Finish loses its Esc until then.
- The player's keys are listed behind **?** (or the keyboard button at the
  end of the transport) rather than drawn on its small buttons, which kept
  the row as plain as it was. Three of them are new: Home goes to the start,
  M marks, R turns Repeat on and off. None of them fire while typing a name.
- An open rehearsal with no take picked shows the evening instead of one
  line asking you to pick a take: how long it ran, each song with its goes
  and their lengths, the takes nobody named, and every note left while
  listening. A take opens from there, and a note opens its take at the spot
  it was left. The strip of take pills is hidden meanwhile, since it only
  repeated the overview; it comes back once a take is open, to switch
  between them.
- In that overview, a take already copied to the cloud folder has a small
  cloud on its chip, so what still needs sending is visible without opening
  each take.
- A tick just before the end of a take no longer puts a sideways scrollbar
  under the last track on Windows.

## 0.6.1

- At the closest zoom the window read-out was cut off mid-word — `0:04 – 0:06
  · cl…` — because it does not fit beside the **Whole take** button on one
  line. It wraps instead. Found by regenerating the screenshots for the
  documentation, not by the tests, which check that the read-out is there and
  that its first tick is inside the window but not that all of it is legible.

## 0.6.0

- Each track's fader shows how loud that track is coming out, as a level
  behind the slider itself. What comes out is the source's peak times the
  fader, so it can never pass the thumb: the thumb is the ceiling you set,
  the green is how close the track is getting to it, and the gap between
  them is the headroom left. Measured in the mix, after that track's own
  fader and mute, rather than guessed from the waveform.
- The A and B buttons are gone. They existed to put an edge of the repeat
  region at the playback position, which was the only way to place one to the
  tenth of a second; the timeline zooms now, and a drag there is finer than
  that. The stretch says its own length on the band where it is drawn, so
  beside **Repeat** there is now only a **Clear** — which also stops being an
  unlabelled ×.
- Where something stops working, the app says why: the greyed-out **Crop**
  gives its reason beside the button rather than in a tooltip no disabled
  button can show, the zoom says when it will go no closer, and an interface
  listed once per audio system says so — which is how a card with sixteen
  inputs ends up offering two.

## 0.5.0

- A take can be trimmed to the region marked on the timeline. Most takes are a
  few minutes of music inside a longer recording — somebody walking back to the
  kit, a false start, the silence after everyone stopped — and until now there
  was no way to say so: the whole thing sat in history, in the size on disk,
  and in the time it took to find the part worth hearing again. Cropping keeps
  the take's number and name, moving the markers inside the region with the
  audio they pointed at — the rest go with what is removed. The originals go
  to the Trash, or a `_deleted` folder where there is no Trash to reach, as one
  folder named after the take, so they can be put back. A take that had been
  copied to the cloud folder loses that copy, because the copy is of a
  different take now; with automatic sending on it goes up again by itself.
- Cropping is offered on the review screen too, which is where the dead air at
  the start of a take is most obvious — you have just recorded it and can see it
  on the waveform.
- The timeline zooms. The wheel over the tracks zooms around the pointer, so the
  second under it stays under it; two fingers sideways, or Shift and the wheel,
  move along the take; **Whole take** returns. Fifteen seconds of a nine-minute
  take used to be twenty pixels wide, which made the region impossible to place
  accurately. The waveform is redrawn for the part on screen rather than
  stretched, so zooming in shows detail that was not there before.

## 0.4.0

- The player runs on one timeline across the window instead of a column in
  the middle of it. Every track shares the same time axis, so where one of
  them came apart is now a thing you can point at.
- The repeat region is drawn with the mouse across the tracks, in either
  direction, and its edges can be dragged afterwards. A press that does not
  travel still seeks, as it always did. A and B keep their jobs for when you
  have just heard the exact spot and want it to the tenth of a second.
- Takes in a rehearsal and in history are a strip along the top rather than
  rows that expand. The player sits below and stops moving when you switch
  takes.
- Escape means one level up, one rung per press: a dialog, then the take you
  are listening to, then the screen — out of a rehearsal in History, out of
  the list, out of Settings, and out of a rehearsal by finishing it. Where the
  rung is a decision it asks first: before finishing a rehearsal with takes in
  it, and before giving up a take on the review screen. An empty rehearsal it
  simply leaves. A recording in progress it never touches.
- Discarding a take on the review screen moves it to the Trash instead of
  deleting it. It was the one place left in the app where a recording was
  really destroyed, and the one that needed it least: that take was played
  seconds earlier and cannot be played again. It also refuses a path outside
  the recordings folder rather than removing whatever it is handed.

## 0.3.0

- A rehearsal in History says what was played in it: how long it ran and the
  songs, with the number of goes each one got — "Polyn ×3 · Vesna ×2 · Ogon".
  It is read from the take names, so nothing extra has to be filled in during
  a rehearsal; a rehearsal whose takes were never named says nothing rather
  than repeating its own take count.
- Each rehearsal also says what it weighs on disk, measured rather than
  estimated, and deleting one says how much space that gives back.

## 0.2.0

- The app says which version it is, under Settings → Under the hood, and in
  what `--selftest` prints. The number is the release tag itself, read at
  build time, so there is nothing to keep in step by hand.
- Saved takes can go to the cloud folder on their own. Switch on **Send saved
  takes automatically** in Settings and every take you keep is copied in the
  background, between takes rather than while one is recording, with the
  take's row showing where it has got to. A take that is renamed or remixed
  is sent again; one that has not changed is left alone. Off by default, and
  not offered until there is a cloud folder to send to.

Two changes to the repository:

- The built interface (`ui/dist`) is no longer committed. It is build output:
  the build scripts and CI produce it, and a clone builds it once with
  `cd ui && npm install && npm run build`.
- The Python moved into `src/rehearsal_recorder/`, installed with
  `pip install -e .` and started with `python3 -m rehearsal_recorder`. The
  PyInstaller spec and the debug-allocator script moved to `packaging/`;
  `build.command` and `build.bat` stayed in the root, because they are meant
  to be double-clicked.

## 0.1.0

First release. Everything below already works.

### Recording

- Multitrack capture, one track per input, written to disk continuously and
  forced out every 30 seconds, so a crash costs seconds rather than a take.
- 16- or 24-bit at 44.1, 48 or 96 kHz — only the combinations the interface
  actually accepts are offered.
- A signal check before the rehearsal: open the inputs without recording and
  watch each musician land on their own track.
- The status line during a take shows the interface is alive and how much
  recording time the disk has left. If the interface disappears mid-take the
  recording stops itself and keeps what it had.
- A take interrupted by a crash is offered for recovery at the next launch.

### Listening

- Playback and mixing in Python, so the output device can be chosen and
  memory stays flat however long the take.
- Markers with a note and a kind — a plain note, "keep this", "went wrong",
  "do again" — coloured on the waveform and on the take row. They can be
  placed on the review screen before a take is even saved.
- A–B repeat, ±10 second transport, per-track volume, mute and solo, with the
  balance remembered between takes.

### Keeping and sharing

- History of every past rehearsal, read from disk.
- Renaming takes and rehearsals, folders on disk renamed to match.
- Selected takes copied to a cloud folder as WAV, FLAC or MP3 — as a stereo
  mix, as the original tracks, or both.
- Deleting is never destruction: the system Trash where there is one, a
  `_deleted` folder where there is not.

### Running it

- macOS, Windows and Linux, packaged into an app with everything inside.
- A self-test the packaged app runs on itself, so a missing native library is
  found at build time rather than at a rehearsal.
