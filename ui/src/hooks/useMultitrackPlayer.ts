import { useCallback, useEffect, useRef, useState } from "react"
import { api, type TrackFile, type TrackMedia, poll as pollPython } from "@/lib/api"
import { MIN_VIEW_SEC } from "@/lib/timeline"

export type MultitrackPlayer = ReturnType<typeof useMultitrackPlayer>

/** How often the position is read back from Python while playing. */
const STATE_POLL_MS = 120

/** How long after the last wheel event the sharper peaks are fetched. Every
 *  tick would be a burst of calls into Python for a picture nobody has
 *  finished aiming yet. */
const PEAKS_SETTLE_MS = 150

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
  // Not a failure: the take plays, just not out of the chosen device.
  const [outputWarning, setOutputWarning] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(fallbackDuration)
  const [muted, setMuted] = useState<string[]>([])
  const [soloed, setSoloed] = useState<string | null>(null)
  const [volumes, setVolumes] = useState<Record<string, number>>({})
  const [looping, setLooping] = useState(false)
  // How loud each track came out of the mix, 0..1, measured in Python while
  // it played. Empty whenever nothing is playing, which is what a meter at
  // rest should read.
  const [levels, setLevels] = useState<Record<string, number>>({})
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

  const applyState = useCallback(
    (s: {
      playing?: boolean
      position?: number
      duration?: number
      muted?: string[]
      soloed?: string | null
      volumes?: Record<string, number>
      levels?: Record<string, number>
      loop?: { a: number; b: number } | null
    }) => {
      if (typeof s.playing === "boolean") setPlaying(s.playing)
      if (typeof s.position === "number") {
        setPosition(s.position)
        anchor.current = { position: s.position, at: performance.now() }
      }
      if (typeof s.duration === "number" && s.duration > 0) setDuration(s.duration)
      if (s.muted) setMuted(s.muted)
      if (s.soloed !== undefined) setSoloed(s.soloed)
      if (s.volumes) setVolumes(s.volumes)
      if (s.levels) setLevels(s.levels)
      if (s.loop !== undefined) setLooping(s.loop !== null)
    },
    []
  )

  // Opening a take
  useEffect(() => {
    let cancelled = false
    openedRef.current = false
    setMedia([])
    setPlaying(false)
    setPosition(0)
    setRegionState({ a: null, b: null })
    setLevels({})
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
        setOutputWarning(opened.warning ?? null)
        applyState(opened)
        setLoading(false)
      } catch (e) {
        if (cancelled) return
        setLoadError(e instanceof Error ? e.message : String(e))
        setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      openedRef.current = false
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
      void call(() => api().player_seek(target))
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

  const applyLoop = useCallback(
    (next: { a: number | null; b: number | null }, enabled: boolean) => {
      if (!enabled) {
        void call(() => api().player_set_loop(null, null))
        return
      }
      void call(() => api().player_set_loop(next.a ?? 0, next.b ?? duration))
    },
    [call, duration]
  )

  return {
    media,
    loading,
    loadError,
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

    toggleLoop: () => {
      const next = !looping
      setLooping(next)
      applyLoop(region, next)
    },
    markA: () => {
      const next = { a: position, b: region.b }
      setRegionState(next)
      if (looping) applyLoop(next, true)
    },
    markB: () => {
      const next = { a: region.a, b: position }
      setRegionState(next)
      if (looping) applyLoop(next, true)
    },
    // A drag hands over both ends at once. Going through markA and then markB
    // would apply the loop twice, and in between would apply a region nobody
    // asked for — the old A with the new B.
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
    /** 0..1 as it last came out of the mix; 0 while nothing plays. */
    getLevel: (name: string) => levels[name] ?? 0,
    setVolume: (name: string, v: number) => {
      setVolumes((prev) => ({ ...prev, [name]: v }))
      void api().player_set_volume(name, v)
    },
    persistVolumes: () => {
      void api().save_mix(volumes)
    },
  }
}
