# S on several tracks at once: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In a take's player, **S** can be on for several tracks: each
**S** adds its track to the ones heard, and pressed again takes it away. The
same in РЭХА and in the band service, on a computer and on a phone. M and S
on one track still take each other off.

**Architecture:** The soloed track becomes a list of names everywhere it is
kept: the shared hook, РЭХА's Python player, the service's desk, and the
fakes. The sound is asked per track, as for M: `setSolo(name, on)` in the
shared `PlayerSound`, `player_set_solo(name, on)` in РЭХА's bridge, and the
state brings `soloed` as a list in the take's order. The lanes and the
phone's desk ask `isSoloed(name)` and `hasSolo` as now.

**Tech Stack:** Python (numpy player, `tests/test_engine.py`), React hook,
vitest, Playwright (РЭХА's interface tests, `ui/e2e/band.spec.ts`, the
service's e2e).

**Spec:** `docs/superpowers/specs/2026-11-15-several-solos-design.md`.

## Global Constraints

- Line numbers are main at 12f6b8d. The thread comparing two takes of a
  song in the service works on the service's take player at the same time
  (`one.tsx`, `sound.ts` most likely): whoever merges second rebases on
  main and settles the conflicts (CLAUDE.md).
- While developing, run only the tests a change touches, once each. Never
  two suites at once. Say so in every subagent brief.
- Test titles and check labels: cp1252 characters only (Windows CI), so
  РЭХА is "REHA" in a title and no ▶ or ⋯.
- M and S on one track take each other off: **S** on a muted track turns
  its M off, M on a track with **S** on turns its **S** off, **S** on
  another track leaves a muted one muted. One place for the rule in each
  part: `player.py` `set_muted`/`set_solo`, `desk.ts`, the fakes.
- `soloed` in a state is always a list of names in the take's order, `[]`
  for none; never null. An empty list is truthy in JS: test `.length`.
- Comments that speak of "the" soloed track or a track "heard alone" say
  "the tracks soloed", or "other tracks are soloed and it is not".
- Each commit ends with the line `Co-Authored-By: Claude Opus 5.5
  <noreply@anthropic.com>` and has no session link. The PR body ends with
  “🤖 Generated with [Claude Code](https://claude.com/claude-code)”.

---

## Task 1: РЭХА and the shared player

**Files:**
- Modify: `src/rehearsal_recorder/audio/player.py` (`:129`, `:309-315`, `:686-700`, `:832`)
- Modify: `src/rehearsal_recorder/api.py` (`:212`, `:5387-5391`, `:5475-5476`)
- Modify: `ui/src/lib/api.ts` (`:767`, `:1680`)
- Modify: `ui/src/lib/playerSound.ts` (`:30`, `:58`), with `playerSound.test.ts` (`:62`, `:71`)
- Modify: `ui/src/hooks/useMultitrackPlayer.ts` (`:100`, `:153`, `:177`, `:549-563`)
- Modify: `ui/src/components/Timeline.tsx` (`:681`, `data-dimmed` on the audio lane)
- Modify: `ui/src/components/LaneControls.tsx` (`:255`, comment)
- Modify: `ui/e2e/fake-bridge.js` (`:157-162`, `:2316`, `:2358-2370`), `ui/e2e/band.js` (`:310`)
- Test: `tests/test_engine.py` (`:249-270`), `ui/e2e/player.spec.ts` (`:578-620`), `ui/e2e/band.spec.ts`

- [ ] **Step 1: Python's player, test first.** In `tests/test_engine.py`
  section [2], the calls become `set_solo(name, True/False)` and the checks
  read lists: "S on a muted track takes its M off, and it plays alone"
  expects `soloed == ["B"]`; "M on the soloed track takes its S off"
  expects `[]`; "S on another track leaves a muted one muted" expects
  `["A"]`. Add, from the start again with nothing muted: `set_solo("A",
  True)`, `set_solo("B", True)`: "S on two tracks plays both" (`soloed ==
  ["A", "B"]`, the mean of both tracks together, as with no S); then
  `set_solo("A", False)`: "S off on one leaves the other alone" (`["B"]`,
  B's level); then `set_solo("Z", True)`: "S on a track the take lacks
  changes nothing" (`["B"]`). End with every S off. Add the bridge's
  checks: `_LostPlayer({}).state()["soloed"] == []`, and `_mix_as_seen`
  with `seen = {"soloed": ["A", "B"]}` on a stand-in player that records
  its calls makes `set_solo("A", True)` and `set_solo("B", True)` (set
  `_open_tracks` as the method reads it). Run `python tests/test_engine.py`
  alone (about two minutes): the new checks fail.
- [ ] **Step 2: `player.py`.** `self._soloed = frozenset()` (`:129`): a new
  frozenset is put in place under the lock each time, so the sound's
  callback (`:413`) never reads one being changed. `_effective_gain`:
  silent when `self._soloed and track.name not in self._soloed`.
  `set_muted`: muted takes the name out of `_soloed`. `set_solo(self, name,
  on)`, `on` required: on adds the name only if one of `self.tracks` has
  it, and unmutes that track; off takes it out. `state()`: `"soloed":
  [t.name for t in self.tracks if t.name in self._soloed]`.
- [ ] **Step 3: the bridge.** `api.py:5387`: `player_set_solo(self, name,
  on)`, no default, calls `set_solo(name, bool(on))`. The stand-in's state
  (`:212`): `"soloed": []`. `_mix_as_seen` (`:5475`): `for name in
  seen.get("soloed") or []: player.set_solo(name, True)`. Run the file
  again: pass.
- [ ] **Step 4: the shared screen.** `ui/src/lib/api.ts`: `soloed?:
  string[]` (`:767`), `player_set_solo(name: string, on: boolean)`
  (`:1680`). `playerSound.ts`: `setSolo(name: string, on: boolean)` and
  `api().player_set_solo(name, on)`; `playerSound.test.ts` calls
  `setSolo("Bass", true)` and expects `player_set_solo("Bass", true)`.
  The hook: `useState<string[]>([])`, `soloed?: string[]` in
  `applyState`, `isSoloed: soloed.includes(name)`, `hasSolo:
  soloed.length > 0`, and `toggleSolo`: `const on =
  !soloed.includes(name)`, `sound.setSolo(name, on)`, then the `keepHeard`
  line as now. Its comment: "M and S on one track take each other off: S
  on a muted track turns its M off, as M on a soloed track turns its S off
  (the sound does it). Each S adds its track to the ones heard; pressed
  again, it takes it away (Alex, 2026-11-15 17:41:12Z)."
  `LaneControls.tsx:255`: "Muted, or other tracks are soloed and this one
  is not: either way, silent." `Timeline.tsx:681`: the audio lane's
  `[data-lane]` div gets `data-dimmed={dimmed || undefined}`, as
  `NotesLane` has it. Run `npx tsc -b` and `npx vitest run
  src/lib/playerSound.test.ts` in `ui/`.
- [ ] **Step 5: the fakes.** `fake-bridge.js`: `soloed: []` (`:2316`);
  `player_set_muted` takes `n` out of `P.soloed`; `player_set_solo(n, on)`
  adds `n` (a track of `P.tracks` only) and unmutes it, or takes it out;
  `playerState()` sends `P.soloed` in the take's order; `levels()` (`:162`)
  silent when `P.soloed.length && !P.soloed.includes(n)`, its comment
  "when other tracks are soloed and it is not". `band.js:310` the same
  test. Run `ui/e2e/band.spec.ts` "the band's drums are a stereo file…"
  alone: it plays the take and reads the meters.
- [ ] **Step 6: interface tests.** `ui/e2e/player.spec.ts`: the calls'
  args become `["Vocals", true]` and `["Guitar", true]`. New test "S on two
  tracks: both lit, the third greyed, and S again takes one away", with
  `window.__SESSION_TRACKS__` set to Guitar, Bass and Vocals before the
  app opens: press **S** on Guitar and on Vocals; both `aria-pressed`
  true, the calls `["Guitar", true]` then `["Vocals", true]`, Bass's
  `[data-lane]` has `data-dimmed`, Guitar's and Vocals' not; press **S**
  on Guitar: it is off, Vocals on, the call `["Guitar", false]`, Guitar's
  lane dimmed. Run these two tests alone, then
  `ui/e2e/midi-player.spec.ts` "a track's notes go pale…" alone (it
  presses **S** on two tracks and still holds).
- [ ] **Step 7: commit.** `git commit -m "РЭХА's player: S on several
  tracks at once, each S adds its track"`.

## Task 2: The band service

**Files:**
- Modify: `service/src/takes/player/desk.ts`, with `desk.test.ts`
- Modify: `service/src/takes/player/player.ts` (`:181`, `:283-286`, `:354-368`, `:543`)
- Modify: `service/src/takes/player/one.tsx` (`:69`, `:82-95`, `:116`, `:255`, `:268`, `:364-373`, `:399-406`)
- Modify: `service/src/takes/player/sound.ts` (`:65`, `:95`, `:107`, `:120`, `:256-262`), with `sound.test.ts`
- Modify: `service/src/takes/player/backing.ts` (`:33`), with `backing.test.ts`
- Modify: `service/src/takes/player/mix.ts` (`:6-7`, `:24-37`), with `mix.test.ts`
- Modify: `service/src/takes/Download.tsx` (`:125`), `service/src/takes/Desk.tsx` (`:21-22`, comment)
- Test: `service/e2e/takes.spec.ts` (`:40-65`)

- [ ] **Step 1: the desk, test first.** `desk.ts`: `Desk = { muted:
  number[]; solo: number[] }`, its comment "the muted ones and the soloed
  ones, by their index"; `withMute` on takes `i` out of `solo`;
  `withSolo(d, i, on)`: on adds `i` and takes it out of `muted`, off takes
  it out of `solo`; `heard(d, i)`: `d.solo.length ? d.solo.includes(i) :
  !d.muted.includes(i)`. `desk.test.ts`: the existing cases with lists,
  and "S on a second track adds it; S again takes one away".
  `backing.test.ts`: `solo: []` and lists. Run `cd service && npx vitest
  run src/takes/player/desk.test.ts src/takes/player/backing.test.ts`:
  fail, write, pass.
- [ ] **Step 2: the Player.** `private solo: number[] = []`; `get soloed():
  number[]`, its comment "The tracks soloed."; `setSolo(i, on)` →
  `this.desk(withSolo(this.deskNow(), i, on))`, its comment "Track `i`'s
  S on or off."; `deskNow` copies the list; `mix()` uses `heard`.
- [ ] **Step 3: the one player.** `Setup.solo: number[]`; `NO_DESK` with
  `solo: []` and its comment "the tracks muted, the ones soloed";
  `ready`: `for (const i of setup.solo) p.setSolo(i, true)`;
  `One.setSolo(uid, i, on)` → `now.setSolo(i, on)` and `setDesk(u, (d) =>
  withSolo(d, i, on))`; `soloOne` toggles `i`; `sounds` uses `heard`.
- [ ] **Step 4: the page's sound.** `sound.ts`: `setSolo(name, on)` finds
  the index, does nothing for a name the take lacks, and calls
  `one.setSolo(uid, i, on)`, or, with no Player yet, `withSolo({ muted,
  solo }, i, on)`; both states send the soloed names in the take's order.
  `firstDesk`: `solo: []`. `sound.test.ts`: the stand-in's `soloed: []`,
  the calls `setSolo("Guitar", true)`, the setups with lists (`solo: [1]`,
  `solo: [0]`, `solo: []`), and a case "S on two tracks before the take
  plays: both kept for when it plays". Run `sound.test.ts`.
- [ ] **Step 5: The mix.** `mix.ts`: `Heard.soloed: string[]`; `gainsOf`
  silent when `soloed.length && !soloed.includes(name)`; `mixName`: the
  soloed names of the take in its order; none, or every one of the take's
  tracks, gives the name as with no S; else "Viasna 12 - only Drums,
  Guitar.mp3" (spec call 2). Its doc comment gains that example, and the
  comment at `:6-7` reads "with tracks on S only those tracks".
  `Download.tsx:125`: `soloed: state.soloed ?? []`. `Desk.tsx:21-22`:
  "while other tracks are soloed". `mix.test.ts`: `soloed: []` by default,
  the existing cases with one-name lists, the two-track name, and S on
  every track giving "Viasna 12.mp3". Run it.
- [ ] **Step 6: e2e.** `service/e2e/takes.spec.ts`, in the test at
  `:40-65`, the lines at `:53-55` (S on Bass again) are replaced by: press
  **S** on Drums: Bass and Drums on, the kit's notes not dimmed (Drums is
  soloed), Guitar greyed; press **S** on Bass: off, Drums still on; press
  **S** on Drums: off; the kit's notes not dimmed and Vocals' M still
  pressed. The rest of the test as now. `npx tsc -b` in `service/`, `npm
  run design-check` in `ui/`, then run that test alone with the service's
  own server (`playwright.config.ts`).
- [ ] **Step 7: commit.** `git commit -m "Band service: S on several
  tracks at once, the mix named after them"`.

## Task 3: Words

**Files:**
- Modify: `site/content/band-service.md` (`:32`)
- Modify: `docs/using-it.md` (`:414-418`, `:1143-1144`)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: the site.** `:32`: "Play yours alone to hear what you
  really did, or mute it and practise along with the band as it played that
  night." becomes "Play yours alone, or with the drums, to hear what you
  really did. Or mute it and practise along with the band as it played that
  night." Run `cd site && npx vitest run src/content/bandService.test.ts`.
- [ ] **Step 2: the guide.** `:414-415`: after "plays it on its own." add
  "Press **S** on more tracks to hear them together, and again to take one
  away." `:417`: "**M** on the soloed track" becomes "**M** on a soloed
  track". `:1143-1144`: "when the track is muted or another is soloed"
  becomes "when the track is muted, or other tracks are soloed and it is
  not".
- [ ] **Step 3: CHANGELOG.** Under "Unreleased", first: "- **S on several
  tracks at once.** Press **S** on more than one track to hear them
  together, and press it again to take that track away. In РЭХА's player
  and in the band service, on a phone too." Run `cd site && npx vitest run
  src/content/index.test.ts` (it reads CHANGELOG). Check the three texts
  with the humanizer skill.
- [ ] **Step 4: commit.** `git commit -m "S on several tracks: reha.stream,
  the guide and CHANGELOG"`.

## Before the PR

Review the whole branch against the spec and fix every finding, minors
too. Show Alex the changed site sentence. Push once and open the PR with
the attribution lines: `reha.yml`, `interface.yml`, `service.yml`,
`site.yml` and `bridge.yml` start on it for their paths, and nothing runs
by hand. Ask Alex before the merge.
