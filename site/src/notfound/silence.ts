// The 404 page's take, on the fake Python side: a take like any other, but
// with nothing on it, and as long as the joke wants.
import type { DemoApi } from "../stage/demo"

type Track = { name: string; file: string }

/**
 * Makes the fake answer for the takes whose files are under `prefix` as for
 * `seconds` of silence: flat peaks in take_media, and that length from
 * player_open and player_state while such a take is open. Every other take
 * is answered as the fake has it.
 */
export function silence(api: DemoApi, prefix: string, seconds: number): void {
  const silent = (tracks: Track[]) => tracks.length > 0 && tracks.every((t) => t.file.startsWith(prefix))
  let open = false

  const mediaOf = api.take_media
  api.take_media = async (tracks: Track[], ...rest) => {
    const media = await mediaOf(tracks, ...rest)
    if (!silent(tracks)) return media
    return media.map((m: { samplerate: number; peaks: number[][] }) => ({
      ...m,
      duration_sec: seconds,
      frames: m.samplerate * seconds,
      peaks: m.peaks.map((channel) => channel.map(() => 0)),
    }))
  }

  const openOf = api.player_open
  api.player_open = async (tracks: Track[], ...rest) => {
    const answer = await openOf(tracks, ...rest)
    open = silent(tracks) && answer?.ok
    return open ? { ...answer, duration: seconds } : answer
  }

  const stateOf = api.player_state
  api.player_state = async (...args) => {
    const state = await stateOf(...args)
    return open && state?.open ? { ...state, duration: seconds } : state
  }

  const closeOf = api.player_close
  api.player_close = async (...args) => {
    open = false
    return closeOf(...args)
  }
}
