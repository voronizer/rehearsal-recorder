# Slower or faster takes in the band service (#105)

Issue #105 asks for a take to play slower without its key going down, to
learn a fast part. On 15 November 2026 Alex took it up (12:39Z, «Давай»)
and asked whether it could go faster too (14:09Z). This change adds a speed
button to the band service's player, from 50 to 150%. The take keeps its
key at every speed. РЭХА does not change.

What Claude found (main at d850487):

1. Nothing in the service changes a take's speed: no `playbackRate`,
   `preservesPitch` or time stretching anywhere in `service/` or `ui/src`.
2. The service plays a take as decoded pieces of each track, every piece
   started at its own sample on one AudioContext's clock
   (`service/src/takes/player/player.ts:6-29`, `place()` at `:778`). An
   `<audio>` element's `preservesPitch` therefore does not apply.
3. Pieces can play slower or faster with `AudioBufferSourceNode.playbackRate`,
   which lowers or raises the key with the speed. One pitch-correcting node
   on the whole mix puts the key back. All tracks go through the same node,
   so they stay together, and the levels, M and S work as they do now.
4. Two engines were tried on Alex's iPhone (iOS 18.7) and in this
   container's Chromium, playing five tracks of a take:
   Signalsmith Stretch 1.3.2 (MIT, WASM in an AudioWorklet) and
   @soundtouchjs/audio-worklet 2.1.1 (MPL-2.0). Rubber Band's web build is
   GPL and was not tried. Alex: «Способ А звучит чище без треска»
   (Signalsmith, 13:33Z), and at 125 and 150% «вроде да, без треска»
   (14:12Z).
5. The take page's player is РЭХА's own (`ui/src/components/TakePlayer.tsx`),
   used by РЭХА too (`ui/src/screens/HistoryScreen.tsx:1076`,
   `ui/src/screens/Rehearsal.tsx:781`). Between answers from the sound
   it moves the playhead on by itself, a second per second
   (`ui/src/hooks/useMultitrackPlayer.ts:313-327`). At another speed that
   would run ahead and jump back.
6. **Download** › **The mix** is made in the page from the files
   (`service/src/takes/player/mix.ts`), not from what plays.
7. The bottom bar hides on the take's own page
   (`service/src/shell/PlayerBar.tsx`, `useOnItsPage`); the phone's bar is
   on every page (`service/src/shell/Shell.tsx:262`).

## Alex's picks

Each with its mockup; the mockups' sources are in
`/mnt/project-files/band-service/slow-down/`.

- **Engine**, 15 November 13:33:24Z, after the phone test
  (https://claude.ai/artifact/GhPqoFqT71SMAhERG2hcYX): way A, Signalsmith
  Stretch, «звучит чище без треска».
- **Faster too**, 14:09:24Z «а увеличить скорость нельзя?», and 14:12:26Z
  on 125 and 150%: «вроде да, без треска». The range is 50 to 150%.
- **Q1, the control**, 14:14:05Z «согласен» to A
  (https://claude.ai/artifact/3ZGEUbiHQgzNJg9N7dR5Jo): one button that
  shows the speed, “100%”, beside **Repeat**. A press opens a list from
  50 to 150%. The button is lit while the speed is not 100%.
- **Q2, where else**, 14:20:50Z card A
  (https://claude.ai/artifact/BeYMSPiGZnfhscMZNQ5ZU5): the button is
  wherever the player is. On a computer, in the take page's player and in
  the bottom bar (which hides on the take's own page, so never twice). On a
  phone, in the phone's bar only, on every page.
- **Q3, the next take**, 14:34:29Z card C
  (https://claude.ai/artifact/Fti4mcDKy3X6x1kJNwVmCP): another take in the
  player starts at 100%. Nothing is kept on the device: after reloading
  the page the player is at 100% too.
- **Q4, Download**, 14:37:14Z card B
  (https://claude.ai/artifact/JA9Gqcch8bg4jBTFJ3vpjp): **The mix** is
  always as recorded. The speed is for listening in the service only.
- **Q5, РЭХА**, 14:38:26Z card A: service only. РЭХА's player shows no
  speed button, and РЭХА's sound process is not touched. Nothing syncs,
  since the speed is kept nowhere.
- **Q6, reha.stream**, 14:39:20Z card B: two sentences in the band service
  page's chapter «Hear your own part», no new picture.
- **The spec**, 14:43:32Z «ок», with calls 1-12 below as listed; calls 13
  and 14 came after it and go to him with the plan.

## What a band member sees

- On a take's page on a computer, beside **Repeat**: a button with a gauge
  icon, “100%” and a small arrow. A press opens the list 50, 60, 70, 75,
  80, 90, 100, 110, 125 and 150%, the speed now ticked. Picking one plays
  the take at that speed at once, in the same key.
- While the speed is not 100%, the button is lit in the accent colour, as
  on the mockup. Its tooltip: “Speed, in the same key”.
- The bottom bar on a computer has the same button, between the line and
  **Mark**, while a take is in it. The phone's bar has it between the time
  and **Mark**, with the number alone (“75%”), no icon or arrow.
- Times stay the take's own everywhere: the clock, the wave and its
  playhead, the bar's line, the marks, **Mark** at this moment, **Repeat**.
  At 50% a 4:05 take still reads 4:05; it takes twice as long to get
  there.
- Changing the speed while the take plays goes on from the same moment,
  after a short stop, as after a jump to another place in the take.
- Pausing, playing on, jumping, **Repeat** and the take's end keep the
  speed. ▶ on another take, anywhere, puts that take in the player at
  100%. Opening another take's page while nothing plays puts that take in
  the player too (`Take.tsx` cues it), so it opens at 100%. Reloading the
  page starts at 100%.
- **Download** is unchanged at every speed.
- At 100% the take plays exactly as now: the pitch-correcting node is not
  in the way.

## How it is built

### The sound (`service/src/takes/player/`)

- A new module `stretch.ts`: one Signalsmith Stretch node per
  AudioContext, made the first time a speed other than 100% is picked.
  The library comes from npm (`signalsmith-stretch@1.3.2`, MIT) and is
  loaded by a dynamic `import()`, so the page does not grow until someone
  picks a speed. Its sound-thread module is served from the band's own
  address (the build's own file, `moduleUrl`): the service's
  Content-Security-Policy (`service/cloudflare/_headers:14`) runs scripts
  only from there, so the library's default `blob:` module would be
  refused. Its WebAssembly runs under the `'wasm-unsafe-eval'` already
  there for the MP3 encoder. It runs on live input: `start()`, then
  `schedule({ semitones: -12 × log2(rate) })` for each speed.
- `Player` gets `rate` (1 by default) and `setRate(rate)`:
  - every piece's node plays at `playbackRate = rate`, placed at
    `t0 + (its time in the take − from) / rate` on the clock;
  - `time()` counts the take's seconds as `(clock − t0) × rate`, less the
    node's own delay (`latency()`), so the playhead is where the sound is;
  - decoding stays five seconds of real time ahead, so at 50% it is two
    and a half seconds of the take;
  - at 1, Master goes straight out as now; otherwise through the stretch
    node;
  - while playing, `setRate` starts the tracks again from `time()`, as a
    jump does.
- `one.tsx` keeps the speed of the take in the player (`speed`,
  `setSpeed`). A different take in the player sets it back to 1. A new
  generation of the same take (РЭХА sent its files again) keeps it. If the
  stretch cannot be made, the speed goes back to 1 and the error goes to
  the console.

### The button

- `ui/src/components/SpeedButton.tsx`, shared: a `DropdownMenu` with a
  `Button` (outline, size `row`) as its trigger and a radio group of the
  ten speeds, from `ui/src/components/ui/`. A `bare` prop drops the icon
  and the arrow for the phone's bar. It gets a story beside it
  (`SpeedButton.stories.tsx`), as the shared components have.
- `TakePlayer` gets an optional `speed` prop (`{ value, onChange }`) and
  draws the button after **Repeat** only when given. РЭХА passes none.
- The take page (`service/src/takes/Take.tsx`, `Full`) passes the one
  player's speed. `PlayerBar` and `PhoneBar` draw the button while a take
  is in the player.
- `useMultitrackPlayer` reads an optional `rate` from the sound's state
  and moves the playhead between answers at that pace. The service's sound
  (`service/src/takes/player/sound.ts`) sends it; РЭХА's Python sends none,
  so 1.

## Stress cases

- A long take name in the phone's bar: the name shrinks first, as now;
  the speed and **Mark** keep their size.
- The bar at 960 px with a take: fits on one line (checked on the Q2
  mockup).
- Picking a speed before the files have come: the speed applies when the
  take starts.
- A speed picked twice quickly while the stretch loads: the last one wins.
- **Repeat** on a short piece at 50%: the piece goes round at half speed,
  without a gap, as at 100%.
- A take that ends at 150%: it stops at its end and goes back to 0:00,
  as now; the speed stays.
- The tab hidden while playing slowly: the sound goes on, as now.
- A browser that cannot run the stretch: the take stays at 100%.
- A browser that cannot play the takes at all (`supported === false`): the
  bars keep the take with ▶ turned off; the speed button is turned off
  with it.
- The first speed other than 100%: the stretch loads (about 110 KB, from
  the band's own address). Until it is ready the button shows the picked
  speed and the take plays on as it was; from 1 s a Spinner takes the
  place of the button's icon (design-system B5).
- A take's page at 960×680 and 1180×820 with a mark's panel open: the
  transport row already wraps today, **Mark** and the keys going under
  it. The speed button goes under with them, at the left; the first row
  is as before (measured on the Q1 mockup).
- On a take's page while another take plays: the page's button reads
  100%; picking a speed puts this take in the player, paused, at that
  speed, and the other take stops.

## Words

- The button: “100%”, written as the app writes a percentage everywhere
  else (Master's level, Appearance's text size), with no space; the
  mockups had one. Aria label “Speed 75%”, tooltip “Speed, in the same
  key”.
- reha.stream, «Hear your own part», two sentences after its first
  paragraph, roughly: “On a computer, press **100%** beside **Repeat**,
  the two arrows in a loop; on a phone it is in the bar at the bottom, by
  **Mark**. Pick a speed from half to one and a half: the take keeps its
  key, and the next take you play starts at 100% again.” The wording is
  checked with the humanizer skill and shown to Alex before merge.
- CHANGELOG, at the top of Unreleased: “**Slower or faster takes in the
  band service.**” and what a band member does, in a few sentences.

## Pictures, the guide and the site

- No new picture (Q6). The service pictures that show the player are
  taken again by `npm run pictures` in `service/`, so they show the new
  button: `downloads` (the take page on a computer) and `lanes`, `mark`
  and `three-weeks-ago` (a take's page on a phone, with the phone's bar).
  They and the two sentences are shown to Alex as screenshots before
  merge.
- reha.stream: the two sentences above.
- The guide (`docs/using-it.md`) and the READMEs do not change: the speed
  is in the service only, and the guide sends readers to reha.stream for
  what the service does (`docs/using-it.md:810`).

## Tests

- `player.test.ts`: at rate 0.5 and 1.5, pieces are placed at the right
  clock times with the right `playbackRate`; `time()` runs at the rate;
  a repeat goes round at the rate; `setRate` while playing goes on from
  the same moment; at 1 nothing passes through the stretch.
- `one.tsx` behaviour: another take resets to 1; the same take's new
  generation keeps the speed.
- `useMultitrackPlayer.test.ts`: the playhead moves at `rate` between
  answers.
- The service's browser tests (Playwright): the button beside **Repeat**,
  the list, the lit state, the bars on a computer and a phone, another
  take at 100%.
- РЭХА's interface tests: no speed button in РЭХА's player.

## Calls Claude made

1. The ten steps of the list: 50, 60, 70, 75, 80, 90, 100, 110, 125, 150.
2. The stretch is loaded only when a speed other than 100% is picked,
   and is out of the way at 100%.
3. A speed changed while playing restarts the tracks from the same moment
   (a short stop), as a jump does, instead of changing on the fly.
4. Every time shown stays in the take's own seconds, and the playhead
   allows for the stretch's delay.
5. A new generation of the same take keeps the speed; only another take
   resets it.
6. No key for the speed.
7. The lit look is the mockup's accent tint, not **Repeat**'s grey "on".
8. The phone's bar shows the number alone.
9. If the stretch cannot load, the speed goes back to 100% with no
   message.
10. The shared playhead hook learns the rate, so РЭХА's player code
    changes a little, with no change in what РЭХА does.
11. The guide and READMEs stay as they are.
12. The CHANGELOG item goes first under Unreleased, so the site's news
    line names it.
13. “75%” with no space, as the app writes percentages, where the mockups
    showed a space before the % sign (found after the spec's OK, told to
    Alex with the plan).
14. A speed picked on a take's page while another take plays puts this
    take in the player, paused, at the speed, and the other one stops
    (found while writing the plan, told to Alex with it).

## Not in this

- Speed in РЭХА (Q5).
- A slower **Download** (Q4).
- Keeping the speed across takes or on the device (Q3).
- Changing the key on purpose (transposing).
