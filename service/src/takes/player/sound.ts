import { useEffect, useMemo } from "react"
import type { PlayerState, TakeNotes, TrackFile, TrackMedia } from "@/lib/api"
import type { PlayerSound } from "@/lib/playerSound"
import {
  channelsQuery,
  keepLevels,
  levelsQuery,
  peaksQuery,
  queryClient,
  type TakePage,
  type Wave,
} from "../../api"
import { firstDesk, keepHeard } from "./backing"
import { levelOf } from "./levels"
import { withMute, withSolo } from "./desk"
import { keepMaster } from "./master"
import { readNotes } from "./notes"
import { useOne, type One, type Setup } from "./one"

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
  /** The repeat, M and S set while another take was in the player, and the levels turned and not kept yet. */
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
  const tracks: TrackFile[] = take.tracks.map((t) => ({
    name: t.name,
    file: t.mp3,
    ...(t.icon ? { icon: t.icon } : {}),
    // The take's Backing track, as РЭХА marked it: drawn and muted as РЭХА's player does.
    ...(t.kind === "backing" ? { kind: "backing" as const } : {}),
  }))
  let position = 0
  let loop: { a: number; b: number } | null = null
  // Backing muted, as every take starts until its page has opened it as you hear it (backing.ts).
  let { muted, solo } = firstDesk(take)
  /** Levels turned and not kept yet. */
  let moved: Record<string, number> = {}
  /** Levels sent to be kept, not answered yet: yours once they are. */
  let sent: Record<string, number> = {}
  /** The zoom whose wave is being decoded: a newer one stops it. */
  let zoom: AbortController | null = null

  const mine = () => one.playerOf(uid, gen)
  const levelHere = (name: string) => moved[name] ?? levelOf(yoursNow(), take, name)

  const state = async (): Promise<PlayerState> => {
    const p = mine()
    // Master is the device's, on every take: its meter is what the one player puts out,
    // whichever take that is. Its level comes with open() alone, so a poll never moves the
    // fader from under a hand that turned it before the take was open.
    const base = { ok: true, open: true, tracks, duration: take.duration_sec, master_level: one.mixLoudness() }
    if (p) {
      position = p.time()
      loop = p.repeat
      muted = names.flatMap((_, i) => (p.isMuted(i) ? [i] : []))
      solo = p.soloed
      const loud = p.loudness()
      return {
        ...base,
        // ⏸ at once; while the files come, the playhead waits with the sound.
        playing: p.playing,
        waiting: p.waiting,
        position,
        loop,
        muted: muted.map((i) => names[i]),
        soloed: solo === null ? null : names[solo],
        volumes: Object.fromEntries(names.map((n, i) => [n, p.gain(i)])),
        // A side each for a stereo file, left then right.
        levels: Object.fromEntries(names.map((n, i) => [n, loud[i]])),
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
    }
  }

  /** Each track's `.peaks` as this opening of the page read it. */
  const waves = new Map<string, Promise<Wave | null>>()

  /**
   * A track's wave from its `.peaks`: a row a side when РЭХА sent both,
   * else one. Asked of the service the first time the page opens the
   * take, so a wave РЭХА sent again since shows; the same for every zoom
   * after that.
   */
  const waveOf = (path: string): Promise<Wave | null> => {
    let wave = waves.get(path)
    if (!wave) {
      wave = queryClient.fetchQuery({ ...peaksQuery(path), staleTime: 0 })
      // A wave that did not come is asked for again next time.
      wave.catch(() => waves.delete(path))
      waves.set(path, wave)
    }
    return wave
  }

  /** The wave's rows, the whole take or the part from `from` to `to`. */
  const part = (rows: number[][], from?: number, to?: number): number[][] => {
    if (from === undefined || to === undefined || !take.duration_sec) return rows
    return rows.map((all) => {
      const per = all.length / take.duration_sec
      return all.slice(Math.floor(from * per), Math.max(Math.floor(from * per) + 1, Math.ceil(to * per)))
    })
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
    open: async () => ({ ...(await state()), master: one.master() }),
    state,

    // Each .mid read here in the page, as РЭХА's take_notes reads it, with
    // its words for a file that is not there or cannot be read.
    notes: (files) =>
      Promise.all(
        files.map(async (f): Promise<TakeNotes> => {
          const named = { name: f.name, ...(f.icon ? { icon: f.icon } : {}) }
          if (!f.file) return { ...named, error: "Notes file not found" }
          try {
            const res = await fetch(f.file)
            if (res.status === 404) return { ...named, error: "Notes file not found" }
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            return { ...named, ...readNotes(new Uint8Array(await res.arrayBuffer()), f.icon === "drums") }
          } catch {
            return { ...named, error: "Notes file not readable" }
          }
        })
      ),

    async media(_tracks, buckets = BUCKETS, from, to) {
      zoom?.abort()
      const wanted = (zoom = new AbortController())
      const zoomed = from !== undefined && to !== undefined
      // While `.peaks` has at least half the points it is drawn: decoding the MP3 would cost more than it shows.
      const fine = zoomed && (COARSE * (to - from)) / Math.max(take.duration_sec, 0.001) < buckets / 2
      const p = fine ? mine() : null
      const media = take.tracks.map(async (t, i): Promise<TrackMedia> => {
        // Both sides sent say stereo. Without them, the MP3's first frame
        // says: a mono file, or a stereo one in a take sent before РЭХА sent
        // both sides. A file that cannot be read has no rings, and the take
        // still opens.
        const wave = await waveOf(t.peaks)
        const rows = wave?.sides ?? [wave?.peaks ?? []]
        const channels = wave?.sides ? 2 : await queryClient.fetchQuery(channelsQuery(t.mp3)).catch(() => 0 as const)
        // Zoomed in, as many rows as the whole take's wave has.
        const peaks = (p && (await p.stretch(i, from!, to!, buckets, wanted.signal, rows.length))) || part(rows, from, to)
        return {
          name: t.name,
          // Backing has the backing track's icon, as РЭХА's take_media gives it.
          ...(t.kind === "backing" ? { icon: "backing", kind: "backing" as const } : t.icon ? { icon: t.icon } : {}),
          url: t.mp3,
          frames: 0,
          samplerate: 0,
          duration_sec: take.duration_sec,
          peaks,
          channels,
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
        else ({ muted, solo } = withMute({ muted, solo }, i, on))
      }
      return state()
    },
    async setSolo(name) {
      const i = name === null ? null : names.indexOf(name)
      if (i !== -1) {
        if (mine()) one.setSolo(uid, i)
        else ({ muted, solo } = withSolo({ muted, solo }, i))
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
    // How loud every take plays on this device, whichever is in the player.
    async setMaster(volume) {
      one.setMaster(volume)
      return { ok: true }
    },
    // Also on the one player: a level turned before the take was open never reached it.
    async keepMaster(volume) {
      one.setMaster(volume)
      keepMaster(volume)
      return { ok: true }
    },

    async keepLevels(volumes) {
      // Only what was turned: a track left alone plays at each take's own balance.
      // A level on its way counts as kept, so a turn back from it is sent too.
      const yours = yoursNow()
      const turned: Record<string, number> = {}
      for (const [n, v] of Object.entries(volumes)) {
        if (!names.includes(n)) continue
        if (Math.abs(v - (sent[n] ?? levelOf(yours, take, n))) > 1e-4) turned[n] = v
        else if (!(n in sent)) delete moved[n]
      }
      if (!Object.keys(turned).length) return { ok: true }
      Object.assign(sent, turned)
      try {
        await keepLevels(turned)
        for (const n of Object.keys(turned)) if (moved[n] === turned[n]) delete moved[n]
        return { ok: true }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      } finally {
        for (const n of Object.keys(turned)) if (sent[n] === turned[n]) delete sent[n]
      }
    },

    // M on the Backing track, kept for you and that song: every take of it opens so.
    async keepBackingHeard(songId, heard) {
      try {
        await keepHeard(songId, heard)
        return { ok: true }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },

    async backToReha() {
      moved = {}
      sent = {}
      await keepLevels(Object.fromEntries(names.map((n) => [n, null])))
    },

    setup: () => ({ loop, muted, solo, moved }),

    // The bar at the bottom plays on after the page is left, with no repeat:
    // it has no Repeat to stop one with.
    async close() {
      loop = null
      zoom?.abort()
      mine()?.setLoop(null, null)
      return { ok: true }
    },
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
