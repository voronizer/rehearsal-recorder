import { api, poll, type PlayerState, type TrackFile, type TrackMedia } from "@/lib/api"

/** What a call that changes something answers. */
type Ok = { ok: boolean; error?: string }

/**
 * What the player's screen asks of the sound behind it. In РЭХА that is
 * Python (pythonSound below); the band service plays a take in the browser
 * and gives a sound of its own (service/src/takes/player/sound.ts). Each
 * call answers in the shape РЭХА's bridge call does, so the screen's code
 * is the same for both.
 */
export type PlayerSound = {
  open(tracks: TrackFile[], reuse?: boolean): Promise<PlayerState>
  /** The tracks' waves, for the whole take or, zoomed in, a stretch of it. */
  media(tracks: TrackFile[], buckets?: number, from?: number, to?: number): Promise<TrackMedia[]>
  state(): Promise<PlayerState>
  play(): Promise<PlayerState>
  pause(): Promise<PlayerState>
  toggle(): Promise<PlayerState>
  seek(seconds: number): Promise<PlayerState>
  setLoop(a: number | null, b: number | null): Promise<PlayerState>
  setMuted(name: string, muted: boolean): Promise<PlayerState>
  setSolo(name: string | null): Promise<PlayerState>
  setVolume(name: string, volume: number): Promise<Ok>
  setMaster(volume: number): Promise<Ok>
  /** Keeps the faders where they are: РЭХА's settings, or the member's in the service. */
  keepLevels(volumes: Record<string, number>): Promise<Ok>
  close(): Promise<Ok>
}

/** РЭХА's sound: Python's player, through the bridge. */
export const pythonSound: PlayerSound = {
  open: (tracks, reuse) => api().player_open(tracks, reuse),
  media: (tracks, buckets, from, to) => api().take_media(tracks, buckets, from, to),
  // Over HTTP when the app serves it, as every poll is.
  state: () => poll("player_state"),
  play: () => api().player_play(),
  pause: () => api().player_pause(),
  toggle: () => api().player_toggle(),
  seek: (seconds) => api().player_seek(seconds),
  setLoop: (a, b) => api().player_set_loop(a, b),
  setMuted: (name, muted) => api().player_set_muted(name, muted),
  setSolo: (name) => api().player_set_solo(name),
  setVolume: (name, volume) => api().player_set_volume(name, volume),
  setMaster: (volume) => api().player_set_master(volume),
  keepLevels: (volumes) => api().save_mix(volumes),
  close: () => api().player_close(),
}
