import { useCallback, useEffect, useRef, useState } from "react"
import { api, type TrackFile, type TrackMedia, poll as pollPython } from "@/lib/api"
import {
  heard,
  keepListeningVolume,
  playerOpened,
  turnListeningVolume,
  useListeningVolume,
  useMixLevel,
} from "@/lib/listening"
import { MIN_VIEW_SEC } from "@/lib/timeline"

export type MultitrackPlayer = ReturnType<typeof useMultitrackPlayer>

/** How often the position is read back from Python while playing. */
const STATE_POLL_MS = 120

/** How long after the last wheel event the sharper peaks are fetched. Every
 *  tick would be a burst of calls into Python for a picture nobody has
 *  finished aiming yet. */
const PEAKS_SETTLE_MS = 150

/** The shortest loop kept when another go is shorter than the last: what
 *  is left of it past the go's end is no loop to listen to. */
const MIN_KEPT_REGION_SEC = 0.5

/**
 * Where a take was being listened to, in seconds from its start: what
 * another go at the same song opens at. Goes do not line up exactly, but
 * "about a minute in" finds the chorus by ear.
 */
export type Spot = {
  position: number
  region: { a: number; b: number } | null
  looping: boolean
  view: { from: number; to: number } | null
  playing: boolean
}

/**
 * The take player. The audio itself is mixed in Python (audio/player.py) —
 * that is where the output-device choice and the absence of a memory ceiling
 * come from; this hook only holds the state the interface needs.
 *
 * The position is polled ~8 times a second and advanced locally by the
 * browser clock in between, otherwise the cursor on the waveform would move
 * in visible steps.
 */
export function useMultitrackPlayer(
  tracks: TrackFile[] | null,
  fallbackDuration = 0
) {
  const [media, setMedia] = useState<TrackMedia[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  // An open of a take that has finished, opened or failed: a fresh object
  // each time, for the tracks it was for. Loading going on and off says as
  // much only when a render falls between the two, and none does when
  // Python answers at once.
  const [settled, setSettled] = useState<{ tracks: TrackFile[] } | null>(null)
  // Not a failure: the take plays, just not out of the chosen device.
  const [outputWarning, setOutputWarning] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(fallbackDuration)
  const [muted, setMuted] = useState<string[]>([])
  const [soloed, setSoloed] = useState<string | null>(null)
  const [volumes, setVolumes] = useState<Record<string, number>>({})
  // The whole mix, after the faders. Python says where it was left when the
  // take opens. Shared with the header's speaker: lib/listening.ts.
  const master = useListeningVolume()
  const masterLevel = useMixLevel()
  const [looping, setLooping] = useState(false)
  // How loud each track came out of the mix, 0..1, measured in Python while
  // it played. Empty whenever nothing is playing, which is what a meter at
  // rest should read.
  const [levels, setLevels] = useState<Record<string, number[]>>({})
  const [region, setRegionState] = useState<{ a: number | null; b: number | null }>(
    { a: null, b: null }
  )
  // What part of the take the timeline is showing. null is all of it — the
  // same state as never having zoomed, so there is only one way to be
  // zoomed out.
  const [view, setViewState] = useState<{ from: number; to: number } | null>(
    null
  )
  // The stretch of the take `media[].peaks` currently describe. It trails
  // `view` by a moment, and Waveform is given both so the gap is drawn
  // correctly — blurred, briefly — rather than drawn wrong.
  const [peaksWindow, setPeaksWindow] = useState({ from: 0, to: 0 })

  // Anchor for smoothing the position between answers from Python.
  const anchor = useRef<{ position: number; at: number } | null>(null)
  const openedRef = useRef(false)
  // Counts the takes opened, so a step waiting on Python's answer about one
  // take is not then sent to a take opened since.
  const opening = useRef(0)

  const applyState = useCallback(
    (s: {
      playing?: boolean
      position?: number
      duration?: number
      muted?: string[]
      soloed?: string | null
      volumes?: Record<string, number>
      master?: number
      master_level?: number
      levels?: Record<string, number[]>
      loop?: { a: number; b: number } | null
      problem?: string | null
      reopened?: boolean
      warning?: string
    }) => {
      // The output went quiet under the take, and Python paused it. Said
      // where the other word about the output is said: the next play tries
      // the card again, and replaces this with how that went.
      if (typeof s.problem === "string") setOutputWarning(s.problem)
      if (s.reopened) setOutputWarning(s.warning ?? null)
      if (typeof s.playing === "boolean") setPlaying(s.playing)
      if (typeof s.position === "number") {
        setPosition(s.position)
        anchor.current = { position: s.position, at: performance.now() }
      }
      if (typeof s.duration === "number" && s.duration > 0) setDuration(s.duration)
      if (s.muted) setMuted(s.muted)
      if (s.soloed !== undefined) setSoloed(s.soloed)
      if (s.volumes) setVolumes(s.volumes)
      heard({ volume: s.master, level: s.master_level })
      if (s.levels) setLevels(s.levels)
      if (s.loop !== undefined) setLooping(s.loop !== null)
    },
    []
  )

  // Opening a take
  useEffect(() => {
    let cancelled = false
    openedRef.current = false
    opening.current += 1
    setMedia([])
    setPlaying(false)
    setPosition(0)
    setRegionState({ a: null, b: null })
    setLevels({})
    heard({ level: 0 })
    setViewState(null)
    setPeaksWindow({ from: 0, to: 0 })
    setLooping(false)
    setLoadError(null)
    setDuration(fallbackDuration)
    anchor.current = null

    if (!tracks || tracks.length === 0) {
      void api().player_close()
      return
    }

    // A level turned anywhere, the header's speaker included, goes to this
    // take from the moment it is open until it closes.
    let release = () => {}
    setLoading(true)
    ;(async () => {
      try {
        // The waveform is computed in Python and does not depend on playback.
        const info = await api().take_media(tracks)
        if (cancelled) return
        const broken = info.find((m) => !m.url)
        if (broken) throw new Error(broken.error ?? `Missing file: ${broken.name}`)
        setMedia(info)

        const opened = await api().player_open(tracks)
        if (cancelled) return
        if (!opened.ok) throw new Error(opened.error ?? "Could not open the take")

        openedRef.current = true
        release = playerOpened((v) => void api().player_set_master(v))
        setOutputWarning(opened.warning ?? null)
        applyState(opened)
        setLoading(false)
        setSettled({ tracks })
      } catch (e) {
        if (cancelled) return
        setLoadError(e instanceof Error ? e.message : String(e))
        setLoading(false)
        setSettled({ tracks })
      }
    })()

    return () => {
      cancelled = true
      openedRef.current = false
      release()
      // Nothing of this take is coming out any more.
      heard({ level: 0 })
      void api().player_close()
    }
  }, [tracks, fallbackDuration, applyState])

  // Poll the state while playing
  useEffect(() => {
    if (!playing) return
    let alive = true
    let timer = 0

    const poll = async () => {
      if (!alive) return
      try {
        const s = await pollPython("player_state")
        if (!alive) return
        if (s.open) applyState(s)
      } catch {
        /* the bridge blinked — skip this tick */
      }
      if (alive) timer = window.setTimeout(poll, STATE_POLL_MS)
    }
    poll()

    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [playing, applyState])

  // Smooth cursor movement between answers from Python
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      const a = anchor.current
      if (a) {
        const elapsed = (performance.now() - a.at) / 1000
        setPosition(Math.min(duration, a.position + elapsed))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, duration])

  // Zoom redraws at once from the peaks already in hand; the ones that match
  // the window arrive a moment later.
  useEffect(() => {
    if (!tracks || tracks.length === 0 || duration <= 0) return
    const want = view ?? { from: 0, to: duration }
    const have = peaksWindow.to > 0 ? peaksWindow : { from: 0, to: duration }
    if (
      Math.abs(want.from - have.from) < 0.01 &&
      Math.abs(want.to - have.to) < 0.01
    ) {
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const info = await api().take_media(
            tracks,
            undefined,
            want.from,
            want.to
          )
          if (cancelled) return
          setMedia(info)
          setPeaksWindow(want)
        } catch {
          /* the picture stays as it is; the take still plays */
        }
      })()
    }, PEAKS_SETTLE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [tracks, view, duration, peaksWindow])

  const call = useCallback(
    async (fn: () => Promise<Record<string, unknown>>) => {
      if (!openedRef.current) return
      const s = await fn()
      applyState(s as Parameters<typeof applyState>[0])
    },
    [applyState]
  )

  const seek = useCallback(
    (seconds: number) => {
      const target = Math.max(0, Math.min(duration, seconds))
      setPosition(target)
      anchor.current = { position: target, at: performance.now() }
      return call(() => api().player_seek(target))
    },
    [call, duration]
  )

  const setView = useCallback(
    (from: number, to: number) => {
      if (duration <= 0) return
      const span = Math.min(duration, Math.max(MIN_VIEW_SEC, to - from))
      if (span >= duration) {
        setViewState(null)
        return
      }
      const start = Math.max(0, Math.min(duration - span, from))
      setViewState({ from: start, to: start + span })
    },
    [duration]
  )

  const resetView = useCallback(() => setViewState(null), [])

  /** Where this take is being listened to, to carry to another go. */
  const spot = (): Spot => ({
    position,
    // One end set reaches to the take's own start or end, as drawn.
    region:
      region.a !== null || region.b !== null
        ? { a: region.a ?? 0, b: region.b ?? duration }
        : null,
    looping,
    view,
    playing,
  })

  const applyLoop = useCallback(
    (next: { a: number | null; b: number | null }, enabled: boolean) => {
      if (!enabled) return call(() => api().player_set_loop(null, null))
      return call(() => api().player_set_loop(next.a ?? 0, next.b ?? duration))
    },
    [call, duration]
  )

  /**
   * Puts a place kept from another go on the take just opened, clamped to
   * its length. A loop left shorter than half a second is dropped, and
   * Repeat with it. The loop goes to Python before the seek, and the seek
   * before Play, so the first thing heard is the place. Each waits for the
   * answer to the one before: Python takes every call on a thread of its
   * own, and one sent at once could overtake it.
   */
  const restore = useCallback(
    async (kept: Spot) => {
      if (duration <= 0) return
      const take = opening.current
      const clamp = (t: number) => Math.max(0, Math.min(duration, t))
      let at = clamp(kept.position)
      const band = kept.region && { a: clamp(kept.region.a), b: clamp(kept.region.b) }
      let loop: Promise<void> | undefined
      if (band && band.b - band.a >= MIN_KEPT_REGION_SEC) {
        setRegionState(band)
        if (kept.looping) {
          setLooping(true)
          loop = applyLoop(band, true)
          if (at < band.a || at >= band.b) at = band.a
        }
      } else if (!kept.region && kept.looping) {
        // Repeat over the whole take.
        setLooping(true)
        loop = applyLoop({ a: null, b: null }, true)
      }
      if (kept.view) setView(kept.view.from, kept.view.to)
      await loop
      if (opening.current !== take) return
      await seek(at)
      if (opening.current !== take) return
      if (kept.playing) await call(() => api().player_play())
    },
    [duration, applyLoop, setView, seek, call]
  )

  return {
    media,
    loading,
    loadError,
    settled,
    outputWarning,
    playing,
    position,
    duration,
    region,
    looping,
    view,
    setView,
    resetView,
    // Never zero-width for a consumer: before the first fetch answers, the
    // peaks in hand are the whole take's.
    peaksWindow: peaksWindow.to > 0 ? peaksWindow : { from: 0, to: duration },

    toggle: () => void call(() => api().player_toggle()),
    play: () => void call(() => api().player_play()),
    pause: () => void call(() => api().player_pause()),
    restart: () => seek(region.a !== null && looping ? region.a : 0),
    skip: (delta: number) => seek(position + delta),
    seek,
    spot,
    restore,

    toggleLoop: () => {
      const next = !looping
      setLooping(next)
      applyLoop(region, next)
    },
    // Both ends at once, because that is how the region is made: dragged
    // across the timeline, or one edge of it moved. Setting them one at a
    // time would apply the loop twice, and in between would apply a region
    // nobody asked for — the old start with the new end.
    setRegion: (a: number, b: number) => {
      const next = { a: Math.min(a, b), b: Math.max(a, b) }
      setRegionState(next)
      if (looping) applyLoop(next, true)
    },
    clearRegion: () => {
      const next = { a: null, b: null }
      setRegionState(next)
      if (looping) applyLoop(next, true)
    },

    isMuted: (name: string) => muted.includes(name),
    isSoloed: (name: string) => soloed === name,
    hasSolo: soloed !== null,
    toggleMute: (name: string) =>
      void call(() => api().player_set_muted(name, !muted.includes(name))),
    toggleSolo: (name: string) =>
      void call(() => api().player_set_solo(soloed === name ? null : name)),
    getVolume: (name: string) => volumes[name] ?? 1,
    /** Each channel, 0..1, as it last came out of the mix; 0 while nothing
     *  plays. A stereo track's two sides are kept apart, as on the waveform:
     *  the loudest of them would hide one that went quiet. */
    getLevels: (name: string) => levels[name] ?? [0],
    setVolume: (name: string, v: number) => {
      setVolumes((prev) => ({ ...prev, [name]: v }))
      void api().player_set_volume(name, v)
    },
    persistVolumes: () => {
      void api().save_mix(volumes)
    },
    /** 0..1, how loud the whole take plays — for listening only. */
    master,
    /** 0..1, the whole mix as it last went out; 0 while nothing plays. */
    masterLevel,
    setMaster: turnListeningVolume,
    persistMaster: keepListeningVolume,
  }
}
