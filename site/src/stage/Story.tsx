// stage.html#story: the app going through the five steps the page tells,
// one screen at a time, each with the props App would give it, after the
// fake has been brought to where the app would have it.
//
// The story only goes forward: a take cannot be unrecorded. A step back
// starts the frame again (#story-<n>) and walks forward to the step.
import { useSyncExternalStore } from "react"
import { Setup } from "@/screens/Setup"
import { Recording } from "@/screens/Recording"
import { Review } from "@/screens/Review"
import { HistoryScreen } from "@/screens/HistoryScreen"
import {
  api,
  type LastAttempt,
  type PendingTake,
  type PlacedTrack,
  type SessionState,
} from "@/lib/api"
import { CLIPS, demoApi } from "./demo"
import { Hero } from "./Hero"
import { bringIntoView, button, dragTimeline, fill, hasText, press, sleep, waitFor } from "./drive"

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
  | { step: "review"; take: PendingTake; rehearsalName: string }
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
/** How long last week's go plays before Record is pressed. */
const LAST_WEEK_MS = 3000
/** How long every Went wrong is on show before a song in it is opened. */
const MARKS_MS = 1800
let takeStarted = 0
let rehearsalName = NAME

const nothing = () => {}

export function Story() {
  const now = useSyncExternalStore(subscribe, () => scene)
  if (!now) return null
  switch (now.step) {
    case "setup":
      return (
        <Setup
          onStarted={nothing}
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
          onStopped={(take) => show({ step: "review", take, rehearsalName })}
        />
      )
    case "review":
      return (
        <Review
          take={now.take}
          rehearsalName={now.rehearsalName}
          onKept={async () => {
            // Back on the rehearsal screen, with the take just kept on it.
            const session = await api().session_state()
            if (session.active) show({ step: "rehearsal", session })
          }}
          onDiscarded={nothing}
          onCropped={(take) => show({ step: "review", take, rehearsalName: now.rehearsalName })}
        />
      )
    case "history":
      return <HistoryScreen onBack={nothing} />
  }
}

/** Each step, from the one before it (or, for the first, from nothing). */
const FORWARD: Record<(typeof STORY)[number], () => Promise<void>> = {
  async setup() {
    show({ step: "setup" })
    fill(await waitFor(() => document.querySelector<HTMLInputElement>("#rehearsal-name")), NAME)
    await press("Check signal")
    await waitFor(() => button("Stop checking"))
  },
  // The rehearsal started, Pałyn picked under Next take, and its ★ go from
  // last week playing in the card beside it; a moment later, Record on the
  // song picked: the next take is Pałyn 3.
  async record() {
    button("Stop checking")?.click()
    const bridge = demoApi()
    const t = (await bridge.load_default_tracks()) ?? {}
    await bridge.start_rehearsal(NAME, t.device_index ?? 0, t.samplerate ?? 44100, t.tracks ?? [], t.bit_depth ?? 24)
    const before = await api().session_state()
    if (!before.active) throw new Error("demo: the rehearsal did not start")
    rehearsalName = before.name
    show({ step: "rehearsal", session: before })
    ;(await waitFor(() => document.querySelector<HTMLButtonElement>("[aria-label='Next take'] [data-song-choice='Pałyn']"))).click()
    ;(await waitFor(() => document.querySelector<HTMLButtonElement>("button[aria-label='Play Pałyn 7']"))).click()
    await waitFor(() => document.querySelector("button[aria-label='Pause Pałyn 7']"))
    await sleep(LAST_WEEK_MS)

    const session = await api().session_state()
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
  },
  // Stop, save it, and back on the rehearsal screen the take nobody named
  // gets its song with one click; the false start is grey, and the
  // evening's two buttons are over the takes.
  async keep() {
    await waitFor(() => performance.now() - takeStarted >= LEAST_TAKE_MS)
    await press("Stop", { exact: true })
    await waitFor(() => document.querySelector("#take-name"))
    await press("Save take")
    const pill = await waitFor(() =>
      document.querySelector<HTMLButtonElement>("[data-name-pills='4'] [data-song-choice='Sonca']")
    )
    bringIntoView(pill)
    await sleep(900)
    pill.click()
    const named = await waitFor(() =>
      document.querySelector<HTMLElement>("[role='group'][aria-label='Sonca'] [data-take='4']")
    )
    bringIntoView(named)
  },
  // Every rehearsal in History, then its Marks view: every Went wrong from
  // every rehearsal, and from the first of them, the band's Pałyn.
  async history() {
    await api().finish_rehearsal()
    show({ step: "history" })
    await waitFor(() => hasText("New songs"))
    await press("Marks", { exact: true })
    ;(
      await waitFor(() =>
        [...document.querySelectorAll<HTMLButtonElement>("button[data-label]")].find(
          (b) => b.querySelector("[data-name]")?.textContent === "Went wrong"
        )
      )
    ).click()
    await waitFor(() => document.querySelector('section[aria-label="Went wrong"] [data-mark]'))
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
  },
  // From the song's page, Pałyn 5 with its bridge on repeat, and on to the
  // next go from its column: it starts at the same bar, still looping.
  async compare() {
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
    await press("Songs", { exact: true })
    ;(await go("Take 3 Pałyn 6")).click()
    await waitFor(() =>
      document
        .querySelector("[data-tab][aria-current='true'] [data-tab-line]")
        ?.textContent?.startsWith("6")
    )
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
        await FORWARD[STORY[at + 1]]()
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
