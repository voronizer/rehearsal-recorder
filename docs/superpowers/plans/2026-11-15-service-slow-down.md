# Slower or faster takes in the band service: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A speed button, 50 to 150%, beside **Repeat** in the service's
take player and in its bars. The take keeps its key at every speed. Another
take starts at 100%. РЭХА, **Download** and the files do not change.

**Architecture:** Every piece of every track plays at `playbackRate` = the
speed on the one AudioContext clock, so the tracks stay together. One
Signalsmith Stretch node (live input) between Master and the speakers
shifts the key back by −12·log2(speed) semitones; at 100% it is out of
the way. The one player (`one.tsx`) holds the speed of the take in it and
sets it back to 1 when another take comes in. The shared `TakePlayer`
draws a shared `SpeedButton` only when given a `speed` prop, which only the
service passes.

**Tech Stack:** React, Web Audio, WebCodecs (the service's page);
signalsmith-stretch 1.3.2 (MIT, WASM AudioWorklet); vitest; Playwright
(the service's e2e and РЭХА's interface tests).

**Spec:** `docs/superpowers/specs/2026-11-15-service-slow-down-design.md`
(Alex's «ок» 2026-11-15 14:43:32Z).

## Global Constraints

- While developing, run only the tests a change touches, once each; the full
  suites run once, on CI, started by hand after the push. Never two suites at
  once. Say so in every subagent brief.
- Test titles and check labels: cp1252 characters only (Windows CI).
- Build every piece of interface from `ui/src/components/ui/`; `npm run
  design-check` in `ui/` covers `ui/src`, `service/src` and `site/src`.
- Percentages are written as the app writes them: “75%”, no space.
- No session link in commits or the PR; the PR body ends with the line
  “🤖 Generated with [Claude Code](https://claude.com/claude-code)”.
- After the last task: review the whole branch, fix every finding (minors
  too), then push and start `service.yml` and `site.yml` by hand.
  `interface.yml` and `bridge.yml` (its paths hold `ui/src/lib/api.ts`)
  have no manual start: they run when the PR opens.

---

## Task 1: The sound plays at a speed, in its key

**Files:**
- Create: `service/src/takes/player/stretch.ts`
- Modify: `service/cloudflare/_headers` (the comment only)
- Create: `service/src/signalsmith-stretch.d.ts`
- Modify: `service/package.json` (+ lock): dependency `signalsmith-stretch` `1.3.2`
- Modify: `service/src/takes/player/player.ts`
- Test: `service/src/takes/player/player.test.ts`

- [ ] **Step 1: the dependency.** `cd service && npm install --save-exact signalsmith-stretch@1.3.2`.
  Its `.mjs` has `export default` and no types. Add
  `service/src/signalsmith-stretch.d.ts`:

  ```ts
  declare module "signalsmith-stretch" {
    /** The node the library makes: live input once started; `schedule` changes it at a clock time, or now. */
    export type StretchNode = AudioWorkletNode & {
      start(when?: number): Promise<void>
      schedule(change: { output?: number; semitones?: number; active?: boolean }): Promise<void>
      /** Its own delay on live input, in seconds. */
      latency(): Promise<number>
    }
    function SignalsmithStretch(context: BaseAudioContext, options?: AudioWorkletNodeOptions): Promise<StretchNode>
    namespace SignalsmithStretch {
      /** Where the sound thread loads the library from; by default a `blob:` made from its text. */
      let moduleUrl: string | undefined
    }
    export default SignalsmithStretch
  }
  ```

- [ ] **Step 2: `stretch.ts`.** One node per AudioContext, made on first
  use, loaded by `import()` so the page does not carry the library until a
  speed other than 100% is picked. The sound-thread module must come from
  the band's own address: the service's Content-Security-Policy
  (`service/cloudflare/_headers:14`, `script-src 'self' 'wasm-unsafe-eval'`)
  refuses the library's default `blob:` module. So `stretch.ts` imports the
  file's URL (`import workletUrl from "signalsmith-stretch?url"`, which
  Vite emits as an asset) and sets `make.moduleUrl = workletUrl` before
  `make(context)`. The `.d.ts` declares `moduleUrl?: string` on the default
  function. Update the `_headers` comment (lines 7-8): the speed's sound
  thread is a script from the band's own address too, and its WebAssembly
  runs under `'wasm-unsafe-eval'`. Check that `npm run e2e:serve` sends the
  header (`curl -sI http://localhost:8799/ | grep -i content-security`); if
  it does not, the e2e test cannot prove the module loads under it, and the
  PR says so.

  ```ts
  /*
    The take at another speed keeps its key (Alex's pick, 2026-11-15
    13:33Z, after hearing both on his iPhone): the tracks play faster or
    slower on the clock, which moves the key with them, and this one node
    on the whole mix moves it back. Signalsmith Stretch (MIT), on live input.
  */
  export type Stretch = {
    node: AudioNode
    /** Its own delay, in seconds of the clock. */
    latency: number
    /** The key moved back for a take played at `rate`. */
    setRate(rate: number): void
  }

  const made = new WeakMap<BaseAudioContext, Promise<Stretch>>()

  export function stretchOf(context: BaseAudioContext): Promise<Stretch> {
    let s = made.get(context)
    if (!s) {
      s = (async () => {
        const [{ default: make }, { default: workletUrl }] = await Promise.all([
          import("signalsmith-stretch"),
          import("signalsmith-stretch?url"),
        ])
        make.moduleUrl = workletUrl
        const node = await make(context)
        await node.start()
        const latency = await node.latency()
        return { node, latency, setRate: (rate) => void node.schedule({ semitones: -12 * Math.log2(rate) }) }
      })()
      // One that failed is tried again next time.
      s.catch(() => made.delete(context))
      made.set(context, s)
    }
    return s
  }
  ```

- [ ] **Step 3: failing tests in `player.test.ts`.** Extend the fakes:
  `createBufferSource()` returns a node with `playbackRate: { value: 1 }`
  that records `start(when, offset)` into a list on `FakeSound`
  (`FakeSound.started: { when: number; offset: number; rate: number }[]`);
  `FakeSound.currentTime` is set by the tests. A fake stretch:
  `{ node: new FakeNode(), latency: 0.05, setRate: vi.fn() }`. Tests (titles
  in cp1252):
  - "at half speed each piece plays at half its rate, twice as far apart on the clock, and the playhead runs at half"
    (play `t1.mp3` with `setRate(0.5, stretch)`, run the timer, check every
    started node's `rate` is 0.5, successive `when`s differ by twice the
    piece's length, and `time()` after the clock moves 2 s past `t0` plus the
    latency is `from + 1`);
  - "at 1.5 the playhead runs half as fast again";
  - "at 1 Master goes straight out and the stretch is not joined" (Master's
    `to` holds `destination`, not the stretch node);
  - "at another speed Master goes through the stretch, which is told the speed" (`setRate` called with 0.75; Master's `to` holds the stretch node, the
    stretch node's `to` holds `destination`; the mix meter still on Master);
  - "a speed changed while playing goes on from the same moment";
  - "a repeat goes round at the speed" (`setLoop(2, 4)` at 0.5: the second
    pass's pieces are placed 4 s of clock after the first's).
  Run: `cd service && npx vitest run src/takes/player/player.test.ts` → FAIL.

- [ ] **Step 4: `player.ts`.** Fields `private rate = 1`,
  `private stretch: Stretch | null = null`. Changes:
  - `get speed(): number` returns `rate`.
  - `setRate(rate: number, stretch: Stretch | null)`: `at = this.time()`;
    `this.rate = rate`; `this.stretch = rate === 1 ? null : stretch`;
    `this.route()`; `stretch?.setRate(rate)` when not 1; then
    `if (this.wanted) this.play(at)` else `this.changed()`.
  - `route()`: with a context, `master.disconnect()`, then
    `master.connect(this.stretch?.node ?? context.destination)`,
    `this.stretch?.node.connect(context.destination)` (joining twice is
    harmless in Web Audio), and `master.connect(this.mixMeter)` again.
    Called from `open()` in place of the two `connect`s there.
  - `raw()`: `this.from + Math.max(0, this.context.currentTime - this.t0 - this.delay()) * this.rate`,
    where `delay()` is `this.stretch?.latency ?? 0`.
  - `place()`: `when = t0 + (at / sampleRate + shift(pass) - from) / rate`;
    if `when < soonest`, `offset = (soonest - when) * rate`; the node's
    `playbackRate.value = rate`.
  - `pump()`: decode while `ahead(frame) < AHEAD_SEC * this.rate`; the
    wait-for-file check compares with `0.15 * this.rate`.
  - `close()` disconnects Master as now; the stretch node stays, for the
    next take.
  Update the file's header comment with a paragraph on the speed.
  Run the tests → PASS. `npx tsc --noEmit` in `service/` → clean.

- [ ] **Step 5: commit.** `git commit -m "Service player: a take plays at a speed, in its own key (#105)"`.

## Task 2: The one player holds the speed; the playhead follows it

**Files:**
- Create: `service/src/takes/player/speed.ts`, `service/src/takes/player/speed.test.ts`
- Modify: `service/src/takes/player/one.tsx`
- Modify: `service/src/takes/player/sound.ts`
- Modify: `ui/src/lib/api.ts` (`PlayerState.rate`)
- Modify: `ui/src/hooks/useMultitrackPlayer.ts` (`anchorOf`, the tick)
- Test: `ui/src/hooks/useMultitrackPlayer.test.ts`, `service/src/takes/player/sound.test.ts`

- [ ] **Step 1: failing tests.**
  - `useMultitrackPlayer.test.ts`: `anchorOf(12, false, 500, 0.5)` is
    `{ position: 12, at: 500, rate: 0.5 }`; without a rate, `rate: 1`
    (update the two existing expectations).
  - `sound.test.ts`: the state of a take in the player carries
    `rate: p.speed`; a take not in the player, none.
  - `service/src/takes/player/speed.test.ts`, for a new
    `speed.ts` holding the rule (Alex's pick C, 14:34:29Z):
    `speedFor(inPlayer, coming, rate)` is `rate` when `coming.uid` is the
    take in the player (a new generation keeps it) and 1 for another take.
    `one.tsx` calls it in `load()` and in the effect that makes a Player.
  Run each file once → FAIL.

- [ ] **Step 2: the shared hook.** `PlayerState` gets
  `rate?: number` (“How fast the take plays, 1 as recorded (the band
  service). The playhead moves on at that pace between answers. Python
  never says it.”). `anchorOf(position, waiting, now, rate = 1)` returns
  `{ position, at: now, rate }`; `applyState` passes `s.rate ?? 1`; the
  tick adds `elapsed * a.rate`. РЭХА's Python sends no rate, so РЭХА is
  unchanged.

- [ ] **Step 3: `sound.ts`.** `state()` adds `rate: p.speed` when the take
  is in the player.

- [ ] **Step 4: `one.tsx`.** In `PlayerApi`: `speed: number` (1 as
  recorded) and `setSpeed(uid: string, rate: number)`. In `PlayerProvider`:
  - `const [speed, setSpeedState] = useState(1)` and `speedNow = useRef(1)`.
  - `applySpeed(p, r)`: at 1, `p.setRate(1, null)`; else
    `stretchOf(wakeSound())` then, if `speedNow.current === r` and
    `player.current === p`, `p.setRate(r, s)`; on failure
    `console.error`, and if still wanted, back to 1 (state, ref, player).
  - `setSpeed(u, r)`: when `u` is not the take in the player (a speed
    picked on a take's page while another take plays), `load(u, its
    playhead, false)` first: that take goes in, paused, and the other
    stops. Then set the ref and state, and `applySpeed` on
    `player.current` if it holds `u`; a player still on its way picks the
    speed up when it is made.
  - `load(u, …)`: when `u !== uid`, the speed goes back to 1 (ref and
    state) before the new take is set (Alex's pick C, 14:34Z).
  - In the effect that makes a take's `Player`, after its setup:
    `if (speedNow.current !== 1) applySpeed(p, speedNow.current)`, so a new
    generation of the same take keeps the speed.
  - `speedLoading: boolean`, true while `stretchOf` is on its way for the
    speed asked; the button shows it (B5).
  - Pass `speed`, `setSpeed` and `speedLoading` in the provider's value.
  Run `cd service && npx tsc --noEmit` and the two test files once → PASS.

- [ ] **Step 5: commit.** `git commit -m "Service: the one player holds the take's speed, another take starts at 100% (#105)"`.

## Task 3: The button, on the take page and in the bars

**Files:**
- Create: `ui/src/components/SpeedButton.tsx`, `ui/src/components/SpeedButton.stories.tsx`
- Modify: `ui/src/lib/format.ts` (`formatPercent`, with its test in `ui/src/lib/format.test.ts`)
- Modify: `docs/design-system.md` (Shared components: SpeedButton)
- Modify: `ui/src/components/TakePlayer.tsx` (prop `speed`)
- Modify: `service/src/takes/Take.tsx` (`Full`)
- Modify: `service/src/shell/PlayerBar.tsx` (`PlayerBar`, `PhoneBar`)
- Test: `service/e2e/takes.spec.ts`, `ui/e2e/player.spec.ts`

- [ ] **Step 1: `SpeedButton`.**

  ```tsx
  /** The speeds in the list (Alex's pick, 2026-11-15 14:09Z: faster too, to 150%). */
  export const SPEEDS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5]
  // formatPercent(0.75) is "75%", in ui/src/lib/format.ts with a test, as B8 asks of every kind of figure.

  /**
   * How fast the take plays, in its own key: a press opens the speeds.
   * Lit while not 100% (Alex's pick A, 2026-11-15 14:14Z). `bare`, in the
   * phone's bar: the number alone.
   */
  export function SpeedButton({ value, onChange, bare = false, busy = false, disabled = false }: { value: number; onChange: (rate: number) => void; bare?: boolean; busy?: boolean; disabled?: boolean })
  ```

  A `DropdownMenu`: trigger a `Button` `variant="outline" size="row"`
  with `Gauge` (unless bare), `formatPercent(value)`, `ChevronDown`
  `size-3.5 opacity-60` (unless bare); `tnum gap-1 px-2.5`; lit with
  `border-primary bg-primary/10 text-primary hover:bg-primary/15` when
  `value !== 1`; `aria-label={\`Speed ${formatPercent(value)}\`}`. `busy`:
  from 1 s (`SPINNER_AFTER_MS`, as `PlayButton` waits) a `Spinner` from
  `ui/src/components/ui/spinner.tsx` in place of the gauge (B5).
  `disabled` as ▶'s. Not bare, a
  `Tooltip` “Speed, in the same key”. Content `align="end" className="w-32"`,
  a `DropdownMenuRadioGroup` over `SPEEDS`, each item `tnum`. As on the
  mockups (`/mnt/project-files/band-service/slow-down/q2-mock/Speed.tsx`).
  Stories: 100%, 75% (lit), bare at 75%, busy, in both themes by the
  toolbar. Add SpeedButton's line to `docs/design-system.md`, “Shared
  components” (U5): what it is, where it is used, the service only.

- [ ] **Step 2: `TakePlayer`.** Prop
  `speed?: { value: number; onChange: (rate: number) => void }`
  (“How fast the take plays, in its key: the band service's. РЭХА has
  none.”). Drawn right after **Repeat**'s tooltip, only when given.

- [ ] **Step 3: the service.** `Full` in `Take.tsx` passes
  `speed={{ value: p.uid === take.uid ? p.speed : 1, onChange: (r) => p.setSpeed(take.uid, r) }}`
  from `usePlayer()`. `PlayerBar`:
  `{take && <SpeedButton value={p.speed} onChange={(r) => p.setSpeed(take.uid, r)} busy={p.speedLoading} disabled={p.supported === false} />}`
  before `MarkHere`. `PhoneBar`: the same with `bare`, before `MarkHere`.
  Update the two components' doc comments.

- [ ] **Step 4: e2e, failing first.** `service/e2e/takes.spec.ts`, new
  tests:
  - "Speed beside Repeat: 75% plays the take slower, lit, and the bar shows it on another page"
    (open a take, press `Speed 100%`, pick `75%`; the button reads `75%` and
    is lit; press Play, wait, the clock moved less than the wall clock;
    go to the song page: the bar's button reads `75%`);
  - "another take in the player starts at speed 100%" (from the song page,
    Play on another take: the bar's button reads `100%`; and, paused at
    75%, opening another take's page puts that take in at `100%`);
  - "on a phone the bar has the speed as a number, between the time and Mark".
  `ui/e2e/player.spec.ts`: "REHA's player has no speed button".
  Run only these tests, once (`npx playwright test -g "Speed|speed"` in
  `service/` with `npm run e2e:serve` running; РЭХА's one test in `ui/`).

- [ ] **Step 5: checks and commit.** `cd ui && npm run design-check`,
  `npx tsc --noEmit` in `ui/` and `service/`.
  `git commit -m "Speed button beside Repeat and in the bars, the band service only (#105)"`.

## Task 4: Words, pictures, CHANGELOG

**Files:**
- Modify: `site/content/band-service.md` («Hear your own part»)
- Modify: `CHANGELOG.md`
- Modify: `site/src/stories/band-service/*.webp` (retaken)

- [ ] **Step 1: the site.** After the chapter's first paragraph, two
  sentences, as in the spec's “Words”: where the button is on a computer
  (**100%** beside **Repeat**, the two arrows in a loop) and on a phone (the
  bar at the bottom, by **Mark**), the range (half to one and a half), the
  same key, and that the next take starts at 100%. Check them with the humanizer skill. Facts only from
  the spec.
- [ ] **Step 2: CHANGELOG.** First item under “Unreleased”:
  “**Slower or faster takes in the band service.**” then what a band member
  does and sees: the button beside **Repeat** and in the bar, 50 to 150%,
  the same key, another take at 100%, **Download** as recorded, РЭХА
  unchanged. Humanizer check.
- [ ] **Step 3: pictures.** `cd service && npm run pictures` (with its own
  server as `playwright.pictures.config.ts` says); look at each changed
  picture; commit `downloads`, `lanes`, `mark` and `three-weeks-ago`, and
  any other that shows the new button.
- [ ] **Step 4: commit.** `git commit -m "Speed on reha.stream, CHANGELOG, pictures retaken (#105)"`.

## Task 5: Review, push, CI, PR

- [ ] Review the whole branch against the spec (`git diff origin/main...HEAD`),
  fix every finding, minors too, in this branch.
- [ ] `git push -u origin claude/project-thread-syxdgt`; start
  `service.yml` and `site.yml` by hand on the branch; `interface.yml` and
  `bridge.yml` run when the PR opens.
- [ ] Open the PR (PR template headings if any), body ending with the
  Claude Code line. Before asking Alex about the merge, show him as
  screenshots (an artifact): «Hear your own part» with its two sentences,
  and the retaken `downloads`, `lanes`, `mark` and `three-weeks-ago`.
