// stage.html#hero: the rehearsal screen before a take, Sonca next. The
// visitor can use it: Record, then Stop, and the take opens to listen to;
// Close take is back on the rehearsal. It makes no sound: the fake has none.
//
// stage.html#playing, for the picture a chat shows for a link
// (scripts/og.mjs): the same screen with a four-piece take open in the
// player, its bridge on repeat.
import { useCallback, useState } from "react"
import { Rehearsal } from "@/screens/Rehearsal"
import { Recording } from "@/screens/Recording"
import { api, type LastAttempt, type PlacedTrack, type SessionState } from "@/lib/api"
import { demoApi } from "./demo"
import { dragTimeline, sleep, waitFor } from "./drive"

type Song = { length(take: number): number; bridge: number; bar: number }

/** The band's rehearsal, started on the fake as the setup screen would.
 *  Finish would leave this screen, and there is nowhere for it to go: here
 *  it does nothing. */
async function startTheRehearsal(): Promise<SessionState> {
  const bridge = demoApi()
  const t = (await bridge.load_default_tracks()) ?? {}
  await bridge.start_rehearsal(
    "Tuesday jam",
    t.device_index ?? 0,
    t.samplerate ?? 44100,
    t.tracks ?? [],
    t.bit_depth ?? 24
  )
  bridge.finish_rehearsal = async () => ({ ok: true, folder: "/rec/Tuesday jam", take_count: 0 })
  return await api().session_state()
}

/** #hero: the rehearsal with Sonca as the next take. */
export async function startHeroRehearsal(): Promise<SessionState> {
  await startTheRehearsal()
  await demoApi().set_next_take_name("Sonca")
  return await api().session_state()
}

/** #playing: Record would leave this screen too, and does nothing here. */
export async function startPlayingRehearsal(): Promise<SessionState> {
  const session = await startTheRehearsal()
  demoApi().start_take = async () => ({ ok: true, take_number: session.active ? session.takes.length + 1 : 1 })
  return session
}

/** Opens Pałyn 2, draws its bridge as a region, and plays it on repeat. */
export async function playTheBridge(): Promise<void> {
  ;(await waitFor(() => document.querySelector<HTMLButtonElement>("button[aria-label='Pałyn #2'], button[aria-label^='Pałyn #2,']"))).click()
  await waitFor(() => document.querySelector('[aria-label="Take timeline"]'))
  await sleep(700)
  const song = (window as unknown as { __SONG__: Song }).__SONG__
  const length = song.length(2)
  await dragTimeline(song.bridge / length, (song.bridge + 8 * song.bar) / length)
  ;(await waitFor(() => document.querySelector<HTMLButtonElement>("button[aria-label='Repeat']"))).click()
  ;(await waitFor(() => document.querySelector<HTMLButtonElement>("button[aria-label='Play']"))).click()
  await waitFor(() => document.querySelector("button[aria-label='Pause']"))
  document.documentElement.dataset.scene = "playing"
}

/** The rehearsal screen, with `openTake` open for listening if there is one. */
export function RehearsalScreen({
  initial,
  openTake,
  onStartTake = () => {},
}: {
  initial: SessionState
  openTake?: number
  /** Record has started a take: what App would show for it. */
  onStartTake?: (takeName: string, takeGo: number | null) => void
}) {
  const [session, setSession] = useState(initial)
  // The screen awaits the fresh state: a crop's Undo finds the uncut take in it.
  const refresh = useCallback(async () => {
    const s = await api().session_state()
    setSession(s)
    return s
  }, [])
  if (!session.active) return null
  return (
    <Rehearsal
      session={session}
      openTake={openTake}
      onStartTake={onStartTake}
      onFinished={() => {}}
      onChanged={refresh}
    />
  )
}

type Scene =
  | { step: "rehearsal"; session: SessionState; open?: number }
  | {
      step: "record"
      takeName: string
      takeGo: number | null
      tracks: PlacedTrack[]
      lastAttempt: LastAttempt | null
    }

/** #hero: the rehearsal screen, and Record's screen while a take goes, as
 *  App switches between them. */
export function Hero({ initial }: { initial: SessionState }) {
  const [scene, setScene] = useState<Scene>({ step: "rehearsal", session: initial })
  if (scene.step === "record")
    return (
      <Recording
        takeName={scene.takeName}
        takeGo={scene.takeGo}
        tracks={scene.tracks}
        lastAttempt={scene.lastAttempt}
        onStopped={async (take) => {
          // Stop has saved it: back on the rehearsal screen, with it open.
          const session = await api().session_state()
          if (session.active) setScene({ step: "rehearsal", session, open: take?.take_number })
        }}
      />
    )
  return (
    <RehearsalScreen
      initial={scene.session}
      openTake={scene.open}
      onStartTake={async (takeName, takeGo) => {
        const session = await api().session_state()
        if (!session.active) return
        setScene({
          step: "record",
          takeName,
          takeGo,
          tracks: session.tracks,
          lastAttempt: session.last_attempt ?? null,
        })
      }}
    />
  )
}
