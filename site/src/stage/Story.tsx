// stage.html#story: the app going through the four steps of an evening the
// page tells, one screen at a time, each with the props App would give it,
// after the fake has been brought to where the app would have it.
//
// The page asks for a step, to run through, or for a moment of one (a
// line of it, `beat`), to go to and stay at; a tile or card on the page
// shows its moment (site/src/page/evening.ts). The story only goes
// forward: a take cannot be unrecorded. For a place behind it, a fresh
// frame is started there (#story-<step> or #story-<step>.<beat>) and walks
// forward to it, while this one keeps still on show.
import { useSyncExternalStore } from "react"
import { Setup } from "@/screens/Setup"
import { Recording } from "@/screens/Recording"
import { Review } from "@/screens/Review"
import { HistoryScreen } from "@/screens/HistoryScreen"
import type { FromStage } from "../frame"
import {
  api,
  type LastAttempt,
  type PendingTake,
  type PlacedTrack,
  type SessionState,
  type Take,
} from "@/lib/api"
import { bandCameIn, CLIPS } from "./demo"
import { Hero } from "./Hero"
import { bringIntoView, button, dragTimeline, fill, hasText, key, press, sleep, waitFor } from "./drive"

export const STORY = ["before", "during", "after", "later"] as const

/** How many lines (moments) each step has: the beats in FORWARD below. */
const BEATS = [5, 3, 3, 6]

/** Where the page wants the app: a step to run through (beat null), or a
 *  moment of one to stay at. */
export type Target = { step: number; beat: number | null }

type Scene =
  | { step: "setup" }
  | { step: "rehearsal"; session: SessionState }
  | {
      step: "record"
      takeNumber: number
      takeName: string
      takeGo: number | null
      tracks: PlacedTrack[]
      lastAttempt: LastAttempt | null
    }
  | { step: "review"; take: PendingTake; rehearsalName: string; takes: Take[] }
  | { step: "history" }

// The screen on show, outside React so the steps below can change it.
let scene: Scene | null = null
const listeners = new Set<() => void>()
function show(next: Scene) {
  scene = next
  for (const l of listeners) l()
}
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

const NAME = "Tuesday jam"
/** The least a take runs once the band has come in, before it is stopped:
 *  past the guitar's last clip, so whoever moves on quickly has still seen
 *  it clip all three times. */
const LEAST_TAKE_MS = (Math.max(...CLIPS) + 0.3) * 1000
/** How long last week's go plays before Start is pressed. */
const LAST_WEEK_MS = 3000
/** How long each song ↑ goes past stays picked, for the eye to follow. */
const ARROW_MS = 450
/** How long every Went wrong is on show before a song in it is opened. */
const MARKS_MS = 1800
/** The least a line of a step stays lit on the page, when nothing else
 *  keeps the app on it as long. */
const BEAT_MS = 1500
/** How long Pałyn 6 loops before ↓ steps on to Pałyn 7. */
const LOOPING_MS = 2500
let rehearsalName = NAME

const nothing = () => {}

/** What App does once Start has started the rehearsal: its screen. */
async function showRehearsal() {
  const session = await api().session_state()
  if (!session.active) throw new Error("demo: the rehearsal did not start")
  rehearsalName = session.name
  show({ step: "rehearsal", session })
}

export function Story() {
  const now = useSyncExternalStore(subscribe, () => scene)
  if (!now) return null
  switch (now.step) {
    case "setup":
      return (
        <Setup
          onStarted={() => void showRehearsal().catch((e) => console.warn(e))}
          onOpenHistory={nothing}
          onOpenRehearsal={nothing}
          onOpenSettings={nothing}
        />
      )
    // The rehearsal screen as the hero has it, with no take open.
    case "rehearsal":
      return <Hero initial={now.session} />
    case "record":
      return (
        <Recording
          takeNumber={now.takeNumber}
          takeName={now.takeName}
          takeGo={now.takeGo}
          tracks={now.tracks}
          lastAttempt={now.lastAttempt}
          onStopped={async (take) => {
            // The screen after a take draws the song's takes tonight as columns.
            const session = await api().session_state()
            show({ step: "review", take, rehearsalName, takes: session.active ? session.takes : [] })
          }}
        />
      )
    case "review":
      return (
        <Review
          take={now.take}
          rehearsalName={now.rehearsalName}
          takes={now.takes}
          onKept={async () => {
            // Back on the rehearsal screen, with the take just kept on it.
            const session = await api().session_state()
            if (session.active) show({ step: "rehearsal", session })
          }}
          onDiscarded={nothing}
          onCropped={(take) => show({ ...now, take })}
        />
      )
    case "history":
      return <HistoryScreen onBack={nothing} />
  }
}

/**
 * How a step tells the page where it has got to: `beat(n)` as the app gets
 * to the step's moment n, which keeps the app there while the page wants
 * that moment; and `linger(ms)`, a pause made only on a step the page wants
 * run through, not on one walked past to a later place.
 */
type Telling = { beat: (n: number) => Promise<void>; linger: (ms: number) => Promise<void> }

/** Each step, from the one before it (or, for the first, from nothing). */
const FORWARD: Record<(typeof STORY)[number], (tell: Telling) => Promise<void>> = {
  // The start screen: the rehearsal named, its tracks, Check signal; then
  // Pałyn's ★ take from last week, from Last time; Start, and ↑ up the songs
  // under Next take to Pałyn, its 128 bpm in the metronome's row.
  async before({ beat, linger }) {
    show({ step: "setup" })
    fill(await waitFor(() => document.querySelector<HTMLInputElement>("#rehearsal-name")), NAME)
    await beat(0)
    await linger(BEAT_MS)
    await beat(1)
    await linger(BEAT_MS)
    await press("Check signal")
    await waitFor(() => button("Stop checking"))
    await beat(2)
    await linger(BEAT_MS)

    button("Stop checking")?.click()
    ;(
      await waitFor(() =>
        document.querySelector<HTMLButtonElement>("[aria-label='Last time'] button[aria-label^='Play Pałyn 7']")
      )
    ).click()
    await waitFor(() => document.querySelector("[aria-label='Last time'] button[aria-label^='Pause Pałyn 7']"))
    await beat(3)
    await linger(LAST_WEEK_MS)

    await press("Start rehearsal")
    const field = await waitFor(() => document.querySelector<HTMLTextAreaElement>("#next-take-name"))
    // Pałyn is above the song the field names, first of tonight's songs.
    for (let i = 0; i < 10 && !field.value.startsWith("Pałyn"); i++) {
      const was = field.value
      key("ArrowUp")
      await waitFor(() => field.value !== was)
      await sleep(ARROW_MS)
    }
    if (!field.value.startsWith("Pałyn")) throw new Error("demo: ↑ did not get to Pałyn")
    await beat(4)
  },
  // Record on Pałyn: the next take is Pałyn 3, and it counts in; then the
  // band comes in, and the guitar clips three times.
  async during({ beat }) {
    // Record once Python has the name the field shows.
    let session = await api().session_state()
    for (let i = 0; i < 40 && session.active && !session.next_take_name.startsWith("Pałyn"); i++) {
      await sleep(50)
      session = await api().session_state()
    }
    if (!session.active) throw new Error("demo: the rehearsal is not going")
    const started = await api().start_take()
    if (!started.ok || started.take_number == null) throw new Error("demo: the take did not start")
    show({
      step: "record",
      takeNumber: started.take_number,
      takeName: session.next_take_name,
      takeGo: session.next_take_go ?? null,
      tracks: session.tracks,
      lastAttempt: session.last_attempt ?? null,
    })
    await waitFor(() => button("Stop", true))
    // The bar of clicks counting on screen, or Python saying the take is
    // not counting in, for a take with no count-in.
    while (!document.querySelector("[data-count-in]") && (await api().metronome_state()).phase === "count")
      await sleep(50)
    await beat(0)
    const since = () => {
      const cameIn = bandCameIn()
      return cameIn === null ? -Infinity : performance.now() - cameIn
    }
    await waitFor(() => since() >= 0)
    await beat(1)
    await waitFor(() => since() >= LEAST_TAKE_MS)
    await beat(2)
  },
  // Stop, save it, and back on the rehearsal screen the take nobody named
  // gets its song with one click; the false start is grey, and the
  // evening's two buttons are over the takes.
  async after({ beat, linger }) {
    await press("Stop", { exact: true })
    await waitFor(() => document.querySelector("[data-take-summary]"))
    await beat(0)
    await linger(BEAT_MS)
    await press("Save take")
    const pill = await waitFor(() =>
      document.querySelector<HTMLButtonElement>("[data-name-pills='4'] [data-song-choice='Sonca']")
    )
    bringIntoView(pill)
    await beat(1)
    await sleep(900)
    await linger(BEAT_MS - 900)
    pill.click()
    await waitFor(() => document.querySelector("[role='group'][aria-label='Sonca'] [data-take='4']"))
    const send = await waitFor(() => button("Send starred"))
    bringIntoView(send)
    await beat(2)
  },
  // Every rehearsal in History, then its Marks view: every Went wrong from
  // every rehearsal, and from the first of them, the band's Pałyn. From the
  // song's page, Pałyn 5 with its bridge on repeat, and on to the next take
  // from its column: it starts at the same bar, still looping; and ↓ to the
  // take after it, the way through every rehearsal.
  async later({ beat, linger }) {
    await api().finish_rehearsal()
    show({ step: "history" })
    await waitFor(() => hasText("New songs"))
    await beat(0)
    await linger(BEAT_MS)
    await press("Marks", { exact: true })
    ;(
      await waitFor(() =>
        [...document.querySelectorAll<HTMLButtonElement>("button[data-label]")].find(
          (b) => b.querySelector("[data-name]")?.textContent === "Went wrong"
        )
      )
    ).click()
    await waitFor(() => document.querySelector('section[aria-label="Went wrong"] [data-mark]'))
    await beat(1)
    await linger(MARKS_MS)
    ;(
      await waitFor(() =>
        [
          ...document.querySelectorAll<HTMLButtonElement>(
            'section[aria-label="Went wrong"] [data-mark] [data-line="take"] button'
          ),
        ].find((b) => b.textContent === "Pałyn")
      )
    ).click()
    await waitFor(() => document.querySelector('[data-rung][aria-expanded="true"]'))
    await beat(2)
    await linger(BEAT_MS)

    const take = (label: string) =>
      waitFor(() => document.querySelector<HTMLButtonElement>(`button[aria-label^="${label}"]`))
    const exactly = (label: string) =>
      waitFor(() => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`))
    ;(await take("Take 2 Pałyn 5")).click()
    await waitFor(() => document.querySelector('[aria-label="Take timeline"]'))
    await sleep(700)
    await dragTimeline(0.55, 0.7)
    ;(await exactly("Repeat")).click()
    ;(await exactly("Play")).click()
    await waitFor(() => document.querySelector("button[aria-label='Pause']"))
    await beat(3)
    await linger(BEAT_MS)
    const openTake = (n: string) =>
      waitFor(() =>
        document
          .querySelector("[data-tab][aria-current='true'] [data-tab-line]")
          ?.textContent?.startsWith(n)
      )
    await press("Songs", { exact: true })
    ;(await take("Take 3 Pałyn 6")).click()
    await openTake("6")
    await beat(4)
    await linger(LOOPING_MS)
    key("ArrowDown")
    await openTake("7")
    await beat(5)
  },
}

const same = (a: Target | null, b: Target | null) =>
  a !== null && b !== null && a.step === b.step && a.beat === b.beat

/**
 * Starts the story and returns how to move it. `from` is the place a fresh
 * frame walks forward to (#story-<step>, #story-<step>.<beat>), and tells
 * the page once it is there (rr-there); null to wait to be told.
 */
export function startStory(from: Target | null): (target: Target) => void {
  const root = document.documentElement
  /** The step the app is in, or last ran through; -1 before the first. */
  let step = -1
  /** The last of that step's lines the app got to; -1 before the first. */
  let last = -1
  /** Whether the app has run that step through to its end. */
  let through = false
  /** Whether it is keeping still at that line. */
  let staying = false
  let want: Target | null = from
  /** Asked for a place behind it: keeps still at the next line, on show
   *  until a fresh frame there takes its place. */
  let still = false
  let fresh = from
  /** Whether it is pausing after that line, on a step run through. */
  let lingering = false
  let wake: (() => void) | null = null
  let running = false

  const tell = (message: FromStage) => window.parent.postMessage(message, "*")
  const there = () => {
    if (fresh && same(fresh, want)) tell({ type: "rr-there" })
    fresh = null
  }

  /** Whether the app has gone past `target`. */
  function behind(target: Target): boolean {
    if (target.step !== step) return target.step < step
    if (target.beat === null) return true
    return target.beat < last || (target.beat === last && !staying && !lingering) || through
  }

  async function beat(at: number, n: number) {
    last = n
    // A fresh frame can be shown from the first line of a step it is to
    // run through, or at the line it was asked for: it says so before the
    // line, so that the page hears the line from the frame on show.
    if (!still && want?.step === at && (want.beat === null || want.beat === n)) there()
    tell({ type: "rr-beat", step: at, beat: n })
    while (still || (want?.step === at && want.beat === n)) {
      if (!still) root.dataset.moment = `${at}.${n}`
      staying = true
      await new Promise<void>((done) => (wake = done))
      wake = null
    }
    staying = false
    delete root.dataset.moment
  }

  /** The pause after line `n` of a step the page wants run through. Asked
   *  for that line meanwhile, the app keeps still at it, as on getting
   *  there; asked for anything else, the pause ends. */
  async function linger(at: number, n: number, ms: number) {
    if (!(want?.step === at && want.beat === null && !still)) return
    lingering = true
    await new Promise<void>((done) => {
      const timer = setTimeout(done, ms)
      wake = () => {
        clearTimeout(timer)
        done()
      }
    })
    wake = null
    lingering = false
    if (want?.step === at && want.beat === n && !still) await beat(at, n)
  }

  async function run() {
    if (running) return
    running = true
    try {
      while (want && !(want.step === step && through)) {
        const next = step + 1
        if (next > want.step) break
        step = next
        last = -1
        through = false
        await FORWARD[STORY[next]]({
          beat: (n) => beat(next, n),
          linger: (ms) => linger(next, last, ms),
        })
        through = true
        root.dataset.scene = STORY[next]
      }
    } catch (e) {
      console.warn(e)
    } finally {
      running = false
    }
  }

  void run()
  return (target) => {
    const { step: s, beat: b } = target
    if (!Number.isInteger(s) || s < 0 || s >= STORY.length) return
    if (b !== null && (!Number.isInteger(b) || b < 0 || b >= BEATS[s])) return
    if (same(target, want) && !still) return
    if (behind(target)) {
      still = true
      const hash = b === null ? `story-${s}` : `story-${s}.${b}`
      // On its own, as in its tests, the frame starts itself again there.
      if (window.parent === window) {
        location.replace(`${location.pathname}#${hash}`)
        location.reload()
      } else {
        tell({ type: "rr-restart", hash })
      }
      return
    }
    still = false
    want = target
    wake?.()
    void run()
  }
}
