// stage.html#story: the app going through the five steps the page tells,
// one screen at a time, each with the props App would give it, after the
// fake has been brought to where the app would have it.
//
// The story only goes forward: a take cannot be unrecorded. A step back
// starts the frame again (#story-<n>) and walks forward to the step. As it
// gets to each of a step's three lines it tells the page (rr-beat), which
// lights that line.
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
import { CLIPS } from "./demo"
import { Hero } from "./Hero"
import { bringIntoView, button, dragTimeline, fill, hasText, key, press, sleep, waitFor } from "./drive"

export const STORY = ["setup", "record", "keep", "history", "compare"] as const

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
/** The least a take runs before it is stopped: past the guitar's last clip,
 *  so whoever moves on quickly has still seen it clip all three times. */
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
let takeStarted = 0
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
            // The screen after a take shows the song's goes before it.
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
 * to the step's line n (site/content/story.md), and `linger(ms)`, a pause
 * that keeps a line lit, made only on the step the page has on screen.
 */
type Telling = { beat: (n: number) => void; linger: (ms: number) => Promise<void> }

/** Each step, from the one before it (or, for the first, from nothing). */
const FORWARD: Record<(typeof STORY)[number], (tell: Telling) => Promise<void>> = {
  async setup({ beat, linger }) {
    show({ step: "setup" })
    fill(await waitFor(() => document.querySelector<HTMLInputElement>("#rehearsal-name")), NAME)
    beat(0)
    await linger(BEAT_MS)
    beat(1)
    await linger(BEAT_MS)
    await press("Check signal")
    beat(2)
    await waitFor(() => button("Stop checking"))
  },
  // Pałyn's ★ go from last week, from Last time on the start screen; then
  // Start, and ↑ up the songs under Next take to Pałyn; a moment later,
  // Record on it: the next take is Pałyn 3.
  async record({ beat, linger }) {
    button("Stop checking")?.click()
    ;(
      await waitFor(() =>
        document.querySelector<HTMLButtonElement>("[aria-label='Last time'] button[aria-label^='Play Pałyn 7']")
      )
    ).click()
    await waitFor(() => document.querySelector("[aria-label='Last time'] button[aria-label^='Pause Pałyn 7']"))
    beat(0)
    await sleep(LAST_WEEK_MS)

    await press("Start rehearsal")
    const field = await waitFor(() => document.querySelector<HTMLInputElement>("#next-take-name"))
    // Pałyn is above the song the field names, first of tonight's songs.
    for (let i = 0; i < 10 && !field.value.startsWith("Pałyn"); i++) {
      const was = field.value
      key("ArrowUp")
      await waitFor(() => field.value !== was)
      await sleep(ARROW_MS)
    }
    if (!field.value.startsWith("Pałyn")) throw new Error("demo: ↑ did not get to Pałyn")
    beat(1)
    await linger(BEAT_MS)

    // Record once Python has the name the field shows.
    let session = await api().session_state()
    for (let i = 0; i < 40 && session.active && !session.next_take_name.startsWith("Pałyn"); i++) {
      await sleep(50)
      session = await api().session_state()
    }
    if (!session.active) throw new Error("demo: the rehearsal is not going")
    const started = await api().start_take()
    if (!started.ok || started.take_number == null) throw new Error("demo: the take did not start")
    takeStarted = performance.now()
    show({
      step: "record",
      takeNumber: started.take_number,
      takeName: session.next_take_name,
      takeGo: session.next_take_go ?? null,
      tracks: session.tracks,
      lastAttempt: session.last_attempt ?? null,
    })
    await waitFor(() => button("Stop", true))
    beat(2)
  },
  // Stop, save it, and back on the rehearsal screen the take nobody named
  // gets its song with one click; the false start is grey, and the
  // evening's two buttons are over the takes.
  async keep({ beat, linger }) {
    await waitFor(() => performance.now() - takeStarted >= LEAST_TAKE_MS)
    await press("Stop", { exact: true })
    await waitFor(() => document.querySelector("[data-take-summary]"))
    beat(0)
    await linger(BEAT_MS)
    await press("Save take")
    const pill = await waitFor(() =>
      document.querySelector<HTMLButtonElement>("[data-name-pills='4'] [data-song-choice='Sonca']")
    )
    bringIntoView(pill)
    beat(1)
    await sleep(900)
    await linger(BEAT_MS - 900)
    pill.click()
    await waitFor(() => document.querySelector("[role='group'][aria-label='Sonca'] [data-take='4']"))
    const send = await waitFor(() => button("Send starred"))
    bringIntoView(send)
    beat(2)
  },
  // Every rehearsal in History, then its Marks view: every Went wrong from
  // every rehearsal, and from the first of them, the band's Pałyn.
  async history({ beat, linger }) {
    await api().finish_rehearsal()
    show({ step: "history" })
    await waitFor(() => hasText("New songs"))
    beat(0)
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
    beat(1)
    await sleep(MARKS_MS)
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
    beat(2)
  },
  // From the song's page, Pałyn 5 with its bridge on repeat, and on to the
  // next go from its column: it starts at the same bar, still looping; and
  // ↓ to the go after it, the way through every rehearsal.
  async compare({ beat, linger }) {
    const go = (label: string) =>
      waitFor(() => document.querySelector<HTMLButtonElement>(`button[aria-label^="${label}"]`))
    const exactly = (label: string) =>
      waitFor(() => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`))
    ;(await go("Take 2 Pałyn 5")).click()
    await waitFor(() => document.querySelector('[aria-label="Take timeline"]'))
    await sleep(700)
    await dragTimeline(0.55, 0.7)
    ;(await exactly("Repeat")).click()
    ;(await exactly("Play")).click()
    await waitFor(() => document.querySelector("button[aria-label='Pause']"))
    beat(0)
    await linger(BEAT_MS)
    const openGo = (n: string) =>
      waitFor(() =>
        document
          .querySelector("[data-tab][aria-current='true'] [data-tab-line]")
          ?.textContent?.startsWith(n)
      )
    await press("Songs", { exact: true })
    ;(await go("Take 3 Pałyn 6")).click()
    await openGo("6")
    beat(1)
    await sleep(LOOPING_MS)
    key("ArrowDown")
    await openGo("7")
    beat(2)
  },
}

/**
 * Starts the story and returns how to move it. `from` is the step a fresh
 * frame walks forward to (#story-<n>), or null to wait to be told.
 */
export function startStory(from: number | null): (step: number) => void {
  let at = -1
  let want = from ?? -1
  let running = false

  async function run() {
    if (running) return
    running = true
    try {
      while (at !== want) {
        if (want < at) {
          location.replace(`${location.pathname}#story-${want}`)
          location.reload()
          return
        }
        const step = at + 1
        await FORWARD[STORY[step]]({
          beat: (n) => {
            const told: FromStage = { type: "rr-beat", step, beat: n }
            window.parent.postMessage(told, "*")
          },
          linger: (ms) => (want === step ? sleep(ms) : Promise.resolve()),
        })
        at += 1
        document.documentElement.dataset.scene = STORY[at]
      }
    } catch (e) {
      console.warn(e)
    } finally {
      running = false
    }
  }

  void run()
  return (step) => {
    if (!Number.isInteger(step) || step < 0 || step >= STORY.length) return
    want = step
    void run()
  }
}
