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
import { api, type LastAttempt, type PendingTake, type PlacedTrack } from "@/lib/api"
import { CLIPS, demoApi } from "./demo"
import { button, fill, hasText, press, waitFor } from "./drive"

export const STORY = ["setup", "record", "review", "history", "song"] as const

type Scene =
  | { step: "setup" }
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
            await api().finish_rehearsal()
            show({ step: "history" })
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
  async record() {
    button("Stop checking")?.click()
    const bridge = demoApi()
    const t = (await bridge.load_default_tracks()) ?? {}
    await bridge.start_rehearsal(NAME, t.device_index ?? 0, t.samplerate ?? 44100, t.tracks ?? [], t.bit_depth ?? 24)
    const session = await api().session_state()
    if (!session.active) throw new Error("demo: the rehearsal did not start")
    rehearsalName = session.name
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
  async review() {
    await waitFor(() => performance.now() - takeStarted >= LEAST_TAKE_MS)
    await press("Stop", { exact: true })
    await waitFor(() => document.querySelector("#take-name"))
  },
  async history() {
    await press("Save take")
    await waitFor(() => hasText("New songs"))
  },
  // The same History, switched to its Songs view, on the band's Pałyn.
  async song() {
    await press("Songs", { exact: true })
    ;(await waitFor(() => document.querySelector<HTMLElement>('[data-song="Pałyn"]'))).click()
    await waitFor(() => document.querySelector('[data-rung][aria-expanded="true"]'))
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
