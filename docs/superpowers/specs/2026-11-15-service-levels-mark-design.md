# The way back to РЭХА's levels, on the faders (band service)

On a take's page in the band service, **РЭХА's levels** sits on a row of its
own under Master's plate. On 15 November 2026 Alex left a comment on the
speed mockup, pinned to that button: «кстати эту кнопку нужно куда нибудь в
нормальное место поставить» (15:15Z). Asked what was wrong with the place,
he answered: «ничего не мешает. просто как будто ее просто влепили без
оценки того что она делает. UX херовый» (15:27:58Z). This change takes the
button away. A fader you moved shows a mark where РЭХА had it, and brings
the track back when it reaches the mark. **РЭХА's levels** moves to the
take's ⋯ menu, for every track at once. РЭХА does not change.

What Claude found (main at d850487):

1. The button is `Levels` in `service/src/takes/Take.tsx:104-145`. On a
   computer it is drawn through the shared player's `underMaster` row
   (`ui/src/components/Timeline.tsx:782-790`), inside the Master band that
   sticks to the foot of the screen (`:733-736`). On a phone it is under the
   desk, after Master (`Take.tsx:237`). It went under Master on Alex's
   comment of 4 November («эту кнопку по моему лучше вынести под уровни»,
   14:59Z, PR #140).
2. It forgets your levels for the take's tracks
   (`service/src/takes/player/sound.ts:296-300`). Master is kept apart
   (`player/master.ts`) and the button does not touch it, though it stood
   under Master.
3. Your level for a track acts in every take with a track of that name
   (`site/content/band-service.md:34`): what plays is yours, else the take's
   balance as РЭХА sent it, else 100% (`service/src/takes/player/levels.ts:4-5`).
   So it is a setting of the track, kept for you, not one of the take.
4. Every fader of the take page is the shared `LaneControls`
   (`ui/src/components/LaneControls.tsx`): in the lanes on a computer
   (`Timeline.tsx:661`) and in the desk on a phone
   (`service/src/takes/Desk.tsx:44`). РЭХА's own player draws the same
   faders, and there a track's level is the take's own: nothing to go back
   to.
5. When your levels are not kept, the reason is said beside the button
   ("Your levels were not kept: …", `Take.tsx:144`). The player keeps one
   line under the transport for what it has to say, one thing at a time
   (`ui/src/components/TakePlayer.tsx:282-302`, design system B4).
6. The take's ⋯ (`service/src/takes/TakeMenu.tsx`) has **Move to song** and
   **Delete take**. The same menu is by a take in a list (`row`).

## Alex's picks

Each with its mockup; the mockups' sources are in
`/mnt/project-files/band-service/levels-button/`.

- **What is wrong with the place**, 15:27:58Z: nothing in the way; the
  button looks stuck on without regard to what it does.
- **Q1, the way back**, 15:35:20Z card A
  (https://claude.ai/artifact/Jbss2TW12fxviA95AoCyct): a mark on the fader.
  On a fader you moved, a mark shows РЭХА's level; the fader stops on it,
  and a double-click brings it back. No button. (The others were an icon by
  the track's name, and a Mine / РЭХА's switch.)
- **Q2, every track at once**, 15:38:23Z card B
  (https://claude.ai/artifact/K2zUF6g6iXbCwpCASVmHim): **РЭХА's levels** in
  the take's ⋯ menu, off until you moved a fader. Claude had recommended
  marks only.
- **РЭХА**: Claude said (15:39Z) that nothing changes in РЭХА and nothing
  syncs: there a track's level is the take's own.
- **A tip**, 15:43:47Z, on call 6 of the spec as first sent: «лучше я
  думаю сделать - при наведении тултип например».
- **Q3, reha.stream**, 15:39:28Z card A: text only. The sentence about the
  button and the alt text of the "lanes" picture change, "lanes" is
  retaken, no new picture.
- **The spec**, 15:45:03Z «ок», with calls 1-11 below as listed.

## What a band member sees

### The mark

Ivan turns his guitar up on a take's page. As soon as the fader leaves
РЭХА's level, a thin upright mark shows on the fader's line where РЭХА had
it. The guitar plays louder for him in every take with a Guitar track, and
in each of those takes his fader shows the mark at that take's own РЭХА
level.

To go back he drags the fader to the mark: near it, the fader stops on it.
Let go there, and his level for the guitar is forgotten, so every take plays
the guitar as РЭХА sent it, and the mark goes. On a computer a double-click
on the fader does the same.

The same on a phone, in the desk's rows. Master has no mark: РЭХА sends no
Master, and Master is kept on each device.

### The menu

The take's ⋯ on its own page gets **РЭХА's levels**, between **Move to
song** and **Delete take**. It forgets your levels for this take's tracks,
as the button did, and every mark of the page goes. It is off while no
fader of the take shows a mark. The ⋯ of a take in a list does not have it.

### When your levels are not kept

"Your levels were not kept: …" goes to the player's line under the
transport on a computer, and to a line kept under the desk on a phone.

### Under Master

Nothing: the row under Master's plate goes, and the Master band is that
much lower.

## Words

- reha.stream, `site/content/band-service.md:34`, «Hear your own part»: the
  last sentence, "**РЭХА's levels** brings back the mix the take came
  with.", becomes: "A thin mark on the fader shows where РЭХА had it. Bring
  the fader back to the mark and it stops there; a double-click does the
  same. **РЭХА's levels** in the take's ⋯ menu brings every track back at
  once."
- The "lanes" picture's alt text (`:36`): "Viasna #12 on Ivan's phone: a
  row for each track with its level, M and S, and the guitar turned all the
  way up, past the mark where РЭХА had it".
- The guide, `docs/using-it.md:822-824`: "Under it, **РЭХА's levels** puts
  back the levels the take came with; it is faded until you move a fader."
  becomes: "A fader you moved shows a thin mark where РЭХА had it: bring the
  fader back to the mark, or double-click it, and the track plays as РЭХА
  sent it. **РЭХА's levels** in the take's ⋯ menu does that for every
  track."
- CHANGELOG, under "Unreleased": an item that starts "**The way back to
  РЭХА's levels is on the faders.**", then what a band member does, as
  above.
- The menu item reads "РЭХА's levels". The fader's tip reads "Your level:
  only you hear it. The mark is РЭХА's." No other new words in the app.

## Pictures

The site's band service pictures are retaken (`cd service && npm run
pictures`): "lanes" shows the mark on Ivan's guitar, and every picture with
a take's page on a computer loses the row under Master. Each changed picture
is shown to Alex before the merge. The guide's pictures are РЭХА's and do
not change.

## Claude's calls

1. The mark shows while the fader is more than 0.5% away from this take's
   РЭХА level, so it comes as soon as the fader leaves it, during the first
   drag, before the level is kept.
2. The mark is a line 2 px wide and 14 px tall, in the text colour at 45%,
   centred on РЭХА's level, under the knob. The same in both themes, on the
   plate's grey and in the phone's desk.
3. The fader stops on the mark within 3% of it, only when dragged. The
   arrow keys step past it, so a level just beside РЭХА's can still be set.
4. A fader let go on the mark forgets your level for that track (as the
   button did), rather than keeping one equal to РЭХА's: other takes, whose
   РЭХА levels differ, then follow РЭХА too.
5. Double-click on a computer only. On a phone the fader stopping on the
   mark does it.
6. A tip on a computer, at Alex's word (15:43:47Z, «лучше я думаю сделать
   - при наведении тултип например»): the pointer over a fader that shows
   its mark opens "Your level: only you hear it. The mark is РЭХА's." It
   does not open while the fader is dragged. A fader with no mark has no
   tip. A phone has no hover, so none there.
7. **РЭХА's levels** in the menu is on while at least one fader of the take
   shows a mark, and forgets only this take's tracks.
8. The menu item is on the take's own page only, not by a take in a list.
9. The failure line: on a computer the player's line, after a load error
   (one thing at a time, B4). On a phone a line kept under the desk, empty
   until something fails, so the marks below do not move (B4).
10. The shared player loses its `underMaster` row; nothing else uses it.
    The faders get РЭХА's level for each track as an optional input; РЭХА's
    screens give none, so they show no mark and nothing stops the fader.
11. A track with no level from РЭХА (a take from an older РЭХА) counts as
    100%, as it plays now (`levels.ts:4-5`): its mark is at the right end.

## Tests

- Service browser tests (`service/e2e/takes.spec.ts`): the tests of the
  button move to the mark and the menu. No mark at first; a fader moved
  shows its mark; dragged back near it, the fader stops on it and the mark
  goes, and the level is forgotten (a null sent); a double-click does the
  same; **РЭХА's levels** in ⋯ is off, then on after a move, and puts every
  track back; the failure line in the player's line and under the desk; no
  row under Master; on a phone the same in the desk.
- Interface browser tests (`ui/e2e`): РЭХА's player shows no mark.
- The pictures' script (`service/pictures/site.spec.ts:49`) waits for the
  mark in place of the button.

## Order

The speed thread (#105) changes the same files: `Take.tsx`, the shared
`TakePlayer.tsx`, the site's band service page and its pictures. The code
here is built on main after that merge, and the pictures are taken after it.

## Not in this change

- A Mine / РЭХА's switch to compare the two mixes.
- Anything in РЭХА.
