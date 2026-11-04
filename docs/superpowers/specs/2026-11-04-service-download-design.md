# Downloading a take from the band service

Until now a take's page in the band service ended with a group of its own,
**Download tracks**: a row per track with its FLAC, or its MP3 while the
FLAC was still on its way, and its .mid where it recorded notes. There was
no way to get the whole take as one file. This change takes that group away
and puts one **Download** button by the take's name. It opens a window with
three choices: **The mix**, one MP3 of the take as you hear it on the page;
**Tracks in MP3**; **Tracks in FLAC**. For the tracks you tick the ones you
want, and each comes as a file of its own.

The mockups Alex picked from are the service's own pages on answers recorded
from a local Worker over the pictures' band (sources in
/mnt/project-files/band-service/download/):

Alex approved this spec on 4 November at 10:35 («интересно. ладно. делай»).

- where the button goes: https://claude.ai/artifact/QA9soomaCzZcLM3fPLgFfk
- where the mix comes from: https://claude.ai/artifact/BHVM4AJJJDkWgNxFJUo1cg
- how the tracks come: https://claude.ai/artifact/3msnD7Xm6A11K8Gh25mcZc

## Alex's picks

All on 4 November 2026, in the thread «Добавить скачивание MP3 в сервисе».

- 10:05 «добавь скачку мп3 в сервисе».
- 10:06 «отдельно блок в котором скачивание - такое себе решение. предложи
  что нибудь вменяемое на UI».
- 10:16 One **Download** button by the take's name, opening a window with
  the choices, as РЭХА's **Copy to the cloud** does (card «C. Кнопка
  Download»).
- 10:19 The page makes the mix itself, as you hear it there, with your
  levels, M and S, for every take already in the service, with no new
  РЭХА (card «1. Сводит страница»).
- 10:25 Tracks are picked in a list with a tick for each, all ticked at
  first, and come as separate files (card «3. Выбрать дорожки»).
- 10:27 On reha.stream: the chapter on taking tracks home gets new words and
  a new picture, and «Hear your own part» gets one sentence about the mix
  (card «Строка и картинка»).

## What the band sees

### The button

The take's page has **Download** in its title row, before the star, as an
outline button with the ↓ icon. On a phone it is the ↓ icon alone, with
“Download” as its name for a screen reader, so the row keeps room for the
name, the star and ⋯. The take's panel in the lists has no **Download**:
the page is where you work with a take.

**Download tracks**, the group at the bottom of the page, is gone, on the
computer and on the phone.

### The window

> **Download “Viasna 12”**
> Pick what you need. It goes to your Downloads folder.
>
> **The mix** · One MP3 of the take as you hear it on this page: your
> levels, mute and solo.
> **Tracks in MP3** · Every track on its own, small files for a phone or a
> quick look.
> **Tracks in FLAC** · Every track as РЭХА recorded it, and the notes as
> .mid, to open in a DAW.
>
> **Close**

The three are rows in РЭХА's share dialog's look (`ShareDialog.tsx`): icon,
name, the line under it. They act at once, so the window has only **Close**
(design system C3).

While РЭХА has not sent a take's FLAC files yet, **Tracks in FLAC** is
greyed and its line says “The originals are still coming from РЭХА.”, the
words the old group used.

### The mix

Pressing **The mix** mixes the take in the page and saves one MP3:

- Each track at the level the page plays it at now: yours where you turned
  it, РЭХА's balance where you did not (`levelOf`, player/levels.ts).
- A muted track is left out; with a track on S, only that track is in.
- **Master** is not in it. Master is how loud this phone or computer plays,
  not part of the band's balance.
- If the tracks together go over full scale, the whole mix is turned down
  to just under it, as РЭХА's mixdown does (`audio/mixdown.py`,
  `TARGET_PEAK` 0.97). It is never turned up.
- Stereo, at the tracks' sample rate: a mono track in the middle, a stereo
  track keeping its sides. MP3 at the best variable bit rate, as РЭХА makes
  its mixes (`audio/encode.py`, `MP3_QUALITY` 0).
- MIDI is not in it: the service does not play notes.

The file is called after the take, and after what was left out:
“Viasna 12.mp3”, “Viasna 12 - without Bass.mp3”, “Viasna 12 - without
Bass, Vocals.mp3”, “Viasna 12 - only Guitar.mp3”. Changed levels do not
change the name.

While it works, the row's icon turns into the spinner after its first
second (B5), and its name is followed by “Mixing… 40%”. The other rows are
greyed. **Close** stops the mixing and nothing is saved. If it cannot be
made, the row says so in the line under its name, “Could not make the mix.
Try again.”, and the row can be pressed again.

### Tracks

Pressing **Tracks in MP3** or **Tracks in FLAC** turns the window into the
list of that kind:

> **Tracks of “Viasna 12” in FLAC**
> Each one is a file of its own.
>
> ☑ Drums
> ☑ Drums, notes (MIDI)
> ☑ Bass
> ☑ Guitar
> ☑ Vocals
>
> **Back** · **Cancel** · **Download 5 files**

- Every file is ticked at first. A track's notes are on the line under its
  sound; a track that recorded notes alone has its notes' line only.
- The .mid files are in both lists: they are the same small file either
  way, and in the MP3 list they are there before the FLAC files are.
- The button counts the ticked files, “Download 1 file”, and is greyed with
  none. **Back** goes back to the three choices; **Cancel** closes the
  window (C3).
- Each ticked file downloads on its own, one after another, from the link
  the old group used (`/files/{uid}/{gen}/{n}.{kind}?download=1`), which
  names it “Viasna 12 - Bass.flac”. The window closes as they start.
- The first time, a browser may ask whether the site may download several
  files. That is the browser's own question, and the page says nothing
  about it.

### Odd cases

- A take in the Trash keeps **Download**: you may want it before it goes.
- In a browser that cannot play the takes, the page shows no player, and
  **The mix** uses the levels alone, since there are no M and S to press.
- A take with no sound, only notes, has only **Tracks in MP3** and
  **Tracks in FLAC**, each with its .mid lines; **The mix** is not there.
- With every track muted, **The mix** makes nothing, and its line says
  “Every track is muted, so the mix would be silent.”
- The mix fetches the tracks' MP3s whole, about 5 MB a track for five
  minutes, so on a phone it costs that much of the mobile data. Measured in
  the cloud container, six 5-minute tracks took 4 s to fetch and decode and
  10 s to encode; a phone has not been measured.

## On reha.stream

`site/content/band-service.md`, Alex's pick of 10:27:

- «Hear your own part», after “or mute it and practise along with the band
  as it played that night.”: *Or mute it, press **Download**, then **The
  mix**: you get an MP3 of the band without you, to practise along
  anywhere.*
- «Take your track home»: the first paragraph says to press **Download**
  and pick **Tracks in FLAC**, ticking the tracks you need; the second
  paragraph says **Tracks in FLAC** has the notes as a .mid file, where it
  said **Download tracks**.
- The `downloads` picture is taken again with the window open over Kupalle
  2's page on a computer (`service/pictures/site.spec.ts`), and its words
  say what it shows: the mix, the tracks in MP3 and the tracks in FLAC.

## How it is built

All of it is in the pages; the Worker and РЭХА do not change.

- `service/src/takes/Download.tsx`: the button and the window, in place of
  `Downloads.tsx`. The rows are built like `ShareOption` in РЭХА's
  `ShareDialog.tsx`; the list uses the shared `Checkbox`.
- `service/src/takes/player/mix.ts`: makes the mix. It fetches each track's
  MP3 that is in the mix, one at a time, decodes it in the browser
  (`decodeAudioData` at the file's own sample rate), adds it at its level
  into one buffer, then turns it down if needed and encodes it.
- The encoder is LAME, the MP3 encoder РЭХА's libsndfile uses too, built
  for the browser by the `wasm-media-encoders` package (0.7.0, MIT; LAME
  itself is LGPL). It is about 66 KB and loaded only when **The mix** is
  pressed, as a file of its own. Browsers cannot make MP3 by themselves.
- What the page plays now (levels, M, S) comes from the take's sound
  (`useServiceSound`), the same state the desk and the lanes draw.
- The take page's answer (`TakePage.files`) already says which files each
  track has; it stays as it is.

### Tests

- Vitest: the mix's levels, M and S, turning down and never up, the file
  names, with small made-up tracks.
- Page tests (`service/e2e/takes.spec.ts`): the button and the window, the
  FLAC row greyed while the originals are coming, the list and its count,
  each ticked file's link, **The mix** saving a file called after what was
  muted. The old **Download tracks** tests go.

## Guide and CHANGELOG

- CHANGELOG, under Unreleased: **Download in the band service.** One
  button by the take's name: the take as one MP3, mixed as you hear it on
  the page, or the tracks you tick, in MP3 or FLAC. It takes the place of
  **Download tracks**.
- РЭХА's guide says nothing about the service's downloads, so it stays.

## Not in this change

- A zip of the tracks.
- **Download** in the take's panel, on a song's page or in the lists.
- Downloading several takes at once.

## Calls to review

Made by Claude, not asked:

1. On a phone **Download** is the ↓ icon alone.
2. Only the take's page has **Download**, not its panel.
3. **Master** is not in the mix.
4. The mix is turned down if it would clip, never up, as РЭХА's mixdown.
5. The mix is stereo, at the best variable bit rate, as РЭХА's.
6. The mix's file name says what was muted or soloed; levels do not.
7. **Close** stops the mixing.
8. The .mid files are in both lists, under their track.
9. The list's buttons are **Back**, **Cancel** and **Download N files**.
10. A take in the Trash keeps **Download**.
11. The encoder: `wasm-media-encoders` (LAME, LGPL inside an MIT wrapper),
    loaded as a file of its own only when the mix is made.
12. On the site, “take **The mix**” from the card became “then **The
    mix**”, since “take” is the word for a recorded attempt.
