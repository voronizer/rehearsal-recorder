import { useEffect, useMemo } from "react"
import type { PlayerState, TrackFile, TrackMedia } from "@/lib/api"
import type { PlayerSound } from "@/lib/playerSound"
import { keepLevels, levelsQuery, peaksQuery, queryClient, type TakePage } from "../../api"
import { levelOf, useOne, type One, type Setup } from "./one"

/** As many points as РЭХА's take_media gives a zoomed wave (audio/waveform.py). */
const BUCKETS = 900
/** How many points a track's `.peaks` holds over the whole take (sending/service_files.py). */
const COARSE = 1200

/** The take page's sound, with what only the service has. */
export type ServiceSound = PlayerSound & {
  /** The tracks as РЭХА's player takes them; the same list for the page's life. */
  tracks: TrackFile[]
  /** Forgets your levels for this take's tracks: they play at РЭХА's balance again. */
  backToReha(): Promise<void>
  /** The repeat, M and S set while another take was in the player. */
  setup(): Setup
}

const yoursNow = () => queryClient.getQueryData(levelsQuery.queryKey)?.levels

/**
 * РЭХА's player screen on the service's one player (one.tsx). While the
 * take is the one in the player, every call goes to its Player; while
 * another take plays, the page keeps its own playhead, repeat, M and S,
 * and the take starts with them once its ▶ is pressed.
 */
export function serviceSound(take: TakePage, one: One): ServiceSound {
  const { uid, gen } = take
  const names = take.tracks.map((t) => t.name)
  const tracks: TrackFile[] = take.tracks.map((t) => ({ name: t.name, file: t.mp3, ...(t.icon ? { icon: t.icon } : {}) }))
  let position = 0
  let loop: { a: number; b: number } | null = null
  let muted: number[] = []
  let solo: number | null = null
  /** Levels turned and not kept yet. */
  let moved: Record<string, number> = {}

  const mine = () => one.playerOf(uid, gen)
  const levelHere = (name: string) => moved[name] ?? levelOf(yoursNow(), take, name)

  const state = async (): Promise<PlayerState> => {
    const p = mine()
    const base = { ok: true, open: true, tracks, duration: take.duration_sec, master: 1 }
    if (p) {
      position = p.time()
      loop = p.repeat
      muted = names.flatMap((_, i) => (p.isMuted(i) ? [i] : []))
      solo = p.soloed
      const loud = p.loudness()
      return {
        ...base,
        // Not yet sounding while the files come: the playhead would run ahead and jump back.
        playing: p.playing && !p.waiting,
        position,
        loop,
        muted: muted.map((i) => names[i]),
        soloed: solo === null ? null : names[solo],
        volumes: Object.fromEntries(names.map((n, i) => [n, p.gain(i)])),
        levels: Object.fromEntries(names.map((n, i) => [n, [loud[i]]])),
        master_level: Math.max(0, ...loud),
      }
    }
    const coming = one.comingOf(uid)
    return {
      ...base,
      playing: false,
      position: coming?.at ?? position,
      loop,
      muted: muted.map((i) => names[i]),
      soloed: solo === null ? null : names[solo],
      volumes: Object.fromEntries(names.map((n) => [n, levelHere(n)])),
      levels: {},
      master_level: 0,
    }
  }

  /** The take's wave from its `.peaks`, the whole of it or the part from `from` to `to`. */
  const coarse = async (path: string, from?: number, to?: number): Promise<number[]> => {
    const all = (await queryClient.fetchQuery(peaksQuery(path))) ?? []
    if (from === undefined || to === undefined || !take.duration_sec) return all
    const per = all.length / take.duration_sec
    return all.slice(Math.floor(from * per), Math.max(Math.floor(from * per) + 1, Math.ceil(to * per)))
  }

  const play = () => {
    const p = mine()
    if (p) {
      if (!p.playing) one.play(uid, p.time())
    } else one.play(uid, one.comingOf(uid)?.at ?? position)
  }
  const pause = () => one.pause(uid)

  return {
    tracks,
    open: () => state(),
    state,

    async media(_tracks, buckets = BUCKETS, from, to) {
      const zoomed = from !== undefined && to !== undefined
      // Wide enough that `.peaks` has the points: no need to decode the MP3.
      const fine = zoomed && (COARSE * (to - from)) / Math.max(take.duration_sec, 0.001) < buckets
      const p = fine ? mine() : null
      const media = take.tracks.map(async (t, i): Promise<TrackMedia> => {
        const peaks = (p && (await p.stretch(i, from!, to!, buckets))) || (await coarse(t.peaks, from, to))
        return {
          name: t.name,
          ...(t.icon ? { icon: t.icon } : {}),
          url: t.mp3,
          frames: 0,
          samplerate: 0,
          duration_sec: take.duration_sec,
          peaks: [peaks],
        }
      })
      return Promise.all(media)
    },

    async play() {
      play()
      return state()
    },
    async pause() {
      pause()
      return state()
    },
    async toggle() {
      const p = mine()
      if (p ? p.playing : one.comingOf(uid)?.play) pause()
      else play()
      return state()
    },
    async seek(seconds) {
      position = Math.max(0, seconds)
      const p = mine()
      if (p) p.seek(position)
      else one.cue(uid, position)
      return state()
    },
    async setLoop(a, b) {
      const p = mine()
      if (p) p.setLoop(a, b)
      else {
        loop = a !== null && b !== null && b - a >= 0.2 ? { a, b } : null
        if (loop && (position < loop.a || position >= loop.b)) position = loop.a
      }
      return state()
    },
    async setMuted(name, on) {
      const i = names.indexOf(name)
      if (i >= 0) {
        if (mine()) one.setMute(uid, i, on)
        else muted = on ? [...new Set([...muted, i])] : muted.filter((x) => x !== i)
      }
      return state()
    },
    async setSolo(name) {
      const i = name === null ? null : names.indexOf(name)
      if (i !== -1) {
        if (mine()) one.setSolo(uid, i)
        else solo = i
      }
      return state()
    },
    async setVolume(name, volume) {
      const i = names.indexOf(name)
      if (i < 0) return { ok: false, error: `No track called “${name}”` }
      moved[name] = volume
      mine()?.setGain(i, volume)
      return { ok: true }
    },
    // The service has no master level: the phone's or computer's own volume is it.
    setMaster: async () => ({ ok: true }),

    async keepLevels(volumes) {
      // Only what was turned: a track left alone plays at each take's own balance.
      const yours = yoursNow()
      const turned = Object.fromEntries(
        Object.entries(volumes).filter(([n, v]) => names.includes(n) && Math.abs(v - levelOf(yours, take, n)) > 1e-4)
      )
      if (!Object.keys(turned).length) return { ok: true }
      try {
        await keepLevels(turned)
        for (const n of Object.keys(turned)) if (moved[n] === turned[n]) delete moved[n]
        return { ok: true }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },

    async backToReha() {
      moved = {}
      await keepLevels(Object.fromEntries(names.map((n) => [n, null])))
    },

    setup: () => ({ loop, muted, solo }),

    // The bar at the bottom plays on after the page is left.
    close: async () => ({ ok: true }),
  }
}

/** The take page's sound: one for each take and generation, so РЭХА's player opens it once. */
export function useServiceSound(take: TakePage): ServiceSound {
  const one = useOne()
  // A new generation is new files; the rest of the take is read when it is made.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sound = useMemo(() => serviceSound(take, one), [take.uid, take.gen, one])
  useEffect(() => one.ready(take.uid, sound.setup), [one, take.uid, sound])
  return sound
}
