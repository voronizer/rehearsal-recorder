// stage.html#hero: the rehearsal screen, a four-piece take open in the
// player with its bridge on repeat. The visitor can use it: pick a take,
// drag a region, press keys. It makes no sound: the fake has none.
import { useCallback, useState } from "react"
import { Rehearsal } from "@/screens/Rehearsal"
import { api, type SessionState } from "@/lib/api"
import { demoApi } from "./demo"
import { dragTimeline, sleep, waitFor } from "./drive"

type Song = { length(take: number): number; bridge: number; bar: number }

/** The band's rehearsal, started on the fake as the setup screen would. */
export async function startHeroRehearsal(): Promise<SessionState> {
  const bridge = demoApi()
  const t = (await bridge.load_default_tracks()) ?? {}
  await bridge.start_rehearsal(
    "Tuesday jam",
    t.device_index ?? 0,
    t.samplerate ?? 44100,
    t.tracks ?? [],
    t.bit_depth ?? 24
  )
  const session: SessionState = await api().session_state()
  // Record and Finish would leave this screen, and there is nowhere for it to
  // go: here they do nothing.
  bridge.start_take = async () => ({ ok: true, take_number: session.active ? session.takes.length + 1 : 1 })
  bridge.finish_rehearsal = async () => ({ ok: true, folder: "/rec/Tuesday jam", take_count: 0 })
  return session
}

/** Opens Pałyn 2, draws its bridge as a region, and plays it on repeat. */
export async function playTheBridge(): Promise<void> {
  ;(await waitFor(() => document.querySelector<HTMLButtonElement>("button[aria-label^='Take 2 Pałyn 2']"))).click()
  await waitFor(() => document.querySelector('[aria-label="Take timeline"]'))
  await sleep(700)
  const song = (window as unknown as { __SONG__: Song }).__SONG__
  const length = song.length(2)
  await dragTimeline(song.bridge / length, (song.bridge + 8 * song.bar) / length)
  ;(await waitFor(() => document.querySelector<HTMLButtonElement>("button[aria-label='Repeat']"))).click()
  ;(await waitFor(() => document.querySelector<HTMLButtonElement>("button[aria-label='Play']"))).click()
  await waitFor(() => document.querySelector("button[aria-label='Pause']"))
  document.documentElement.dataset.scene = "hero"
}

export function Hero({ initial }: { initial: SessionState }) {
  const [session, setSession] = useState(initial)
  const refresh = useCallback(() => void api().session_state().then(setSession), [])
  if (!session.active) return null
  return (
    <Rehearsal session={session} onStartTake={() => {}} onFinished={() => {}} onChanged={refresh} />
  )
}
