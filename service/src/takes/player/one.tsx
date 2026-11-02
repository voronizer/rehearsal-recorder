import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import { playLook, type PlayLook } from "@/lib/playLook"
import { useLevels, useSeen, useTake, type TakePage } from "../../api"
import { levelOf } from "./levels"
import { Player, wakeSound } from "./player"

/*
  The service's one player: ▶ in a list, the take's panel and page, and the
  bar at the bottom all play through it, so one take sounds at a time. A
  take pressed in a list plays once its page has come; its files are
  fetched only then.
*/

let canPlay: boolean | null = null
const asked = Player.supported().then((yes) => {
  canPlay = yes
})

/** Whether this browser can play the takes: null until it has said. */
function useSupported(): boolean | null {
  return useSyncExternalStore(
    (change) => {
      void asked.then(change)
      return () => {}
    },
    () => canPlay
  )
}

// Where the playhead is, kept apart, so only what shows it redraws as it moves.
const clock = { uid: "", time: 0, subs: new Set<() => void>() }
const tick = (uid: string, time: number) => {
  if (clock.uid === uid && clock.time === time) return
  clock.uid = uid
  clock.time = time
  clock.subs.forEach((f) => f())
}
const subscribe = (f: () => void) => {
  clock.subs.add(f)
  return () => clock.subs.delete(f)
}

/** Where the player is in this take: its playhead if it is the take in the player, else 0. */
export const useTime = (uid: string) => useSyncExternalStore(subscribe, () => (clock.uid === uid ? clock.time : 0))

type PlayerApi = {
  /** The take in the player, or "" before any. */
  uid: string
  take: TakePage | undefined
  supported: boolean | null
  look: PlayLook
  /** ▶: plays the take from `at`, or from where it was; pressed again on the take that plays, it pauses. */
  play: (uid: string, at?: number) => void
  /** Moves the playhead; a take not in the player starts playing there. */
  seek: (uid: string, at: number) => void
  /** Puts a take in the player at `at` without playing, unless one plays. */
  cue: (uid: string, at: number) => void
  /** The take is heard or opened: it is no longer new for you. Told once a page load, unless `again`. */
  heard: (uid: string, again?: boolean) => void
  muted: number[]
  solo: number | null
  mute: (i: number) => void
  soloOne: (i: number) => void
  /** Whether track `i` of the take in the player is heard. */
  sounds: (i: number) => boolean
}

const PlayerCtx = createContext<PlayerApi | null>(null)
export const usePlayer = () => useContext(PlayerCtx)!

/** What a take's page set on its player before the take was in the one player. */
export type Setup = { loop: { a: number; b: number } | null; muted: number[]; solo: number | null }

/**
 * The one player as the take page's РЭХА player reaches it (sound.ts). Each
 * call reads the player as it is at that moment, not as of a render, and
 * the object itself never changes, so the page's player is opened once.
 */
export type One = {
  /** The take's Player, while it is the take in the player. */
  playerOf: (uid: string, gen: number) => Player | null
  /** The take is on its way into the player: where it will be, and whether it will play. */
  comingOf: (uid: string) => { at: number; play: boolean } | null
  /** Plays the take from `at`, putting it in the player first if it is not. */
  play: (uid: string, at: number) => void
  pause: (uid: string) => void
  cue: (uid: string, at: number) => void
  setMute: (uid: string, i: number, on: boolean) => void
  setSolo: (uid: string, i: number | null) => void
  /** What a new Player of the take starts with; returns the way to stop. */
  ready: (uid: string, setup: () => Setup) => () => void
}

const OneCtx = createContext<One | null>(null)
export const useOne = () => useContext(OneCtx)!


/** The look of a take's ▶ in a list: the player's own for the take in it. */
export function useLookOf(uid: string): PlayLook {
  const p = usePlayer()
  return p.uid === uid ? p.look : "idle"
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const supported = useSupported()
  const [uid, setUid] = useState("")
  const take = useTake(uid)
  const player = useRef<Player | null>(null)
  const pending = useRef<{ at: number; play: boolean } | null>(null)
  const [, redraw] = useState(0)
  const [muted, setMuted] = useState<number[]>([])
  const [solo, setSolo] = useState<number | null>(null)
  const [started, setStarted] = useState(false)
  const seen = useSeen()
  const once = useRef(new Set<string>())
  const key = take.data ? `${take.data.uid}/${take.data.gen}` : ""
  const yours = useLevels().data?.levels
  const yoursNow = useRef(yours)
  yoursNow.current = yours
  /** The take and generation of player.current. */
  const held = useRef<{ uid: string; gen: number } | null>(null)
  const setups = useRef(new Map<string, () => Setup>())

  const heard = useCallback(
    (u: string, again = false) => {
      if (once.current.has(u) && !again) return
      once.current.add(u)
      seen.mutate(u)
    },
    [seen]
  )

  useEffect(() => {
    const t = take.data
    if (!t || !supported) return
    const p = new Player(t.tracks.map((k) => ({ url: k.mp3, gain: levelOf(yoursNow.current, t, k.name) })))
    p.onChange = () => {
      tick(t.uid, p.time())
      redraw((n) => n + 1)
    }
    p.onEnd = () => redraw((n) => n + 1)
    // As the take's page left it: its repeat, M and S.
    const setup = setups.current.get(t.uid)?.()
    if (setup?.loop) p.setLoop(setup.loop.a, setup.loop.b)
    for (const i of setup?.muted ?? []) p.setMute(i, true)
    if (setup && setup.solo !== null) p.setSolo(setup.solo, true)
    const go = pending.current
    pending.current = null
    const at = go?.at ?? (clock.uid === t.uid ? clock.time : 0)
    p.seek(at)
    tick(t.uid, at)
    if (go?.play) {
      p.play(at)
      setStarted(true)
    } else setStarted(false)
    player.current = p
    held.current = { uid: t.uid, gen: t.gen }
    setMuted(setup?.muted ?? [])
    setSolo(setup?.solo ?? null)
    redraw((n) => n + 1)
    return () => {
      p.close()
      if (player.current === p) {
        player.current = null
        held.current = null
      }
    }
    // A new take or generation is a new player; the rest is read when it is made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, supported])

  // Your levels, as they come or change, on the take in the player.
  useEffect(() => {
    const now = player.current
    const t = take.data
    if (!now || !t || held.current?.uid !== t.uid) return
    t.tracks.forEach((k, i) => now.setGain(i, levelOf(yours, t, k.name)))
  }, [yours, key, take.data])

  // The playhead moves on screen while the take plays.
  const p = player.current
  const playing = p?.playing ?? false
  useEffect(() => {
    if (!playing) return
    let frame = requestAnimationFrame(function step() {
      if (player.current) tick(clock.uid, player.current.time())
      frame = requestAnimationFrame(step)
    })
    return () => cancelAnimationFrame(frame)
  }, [playing])

  const look = playLook({
    loaded: started,
    playing: !!p?.playing && !p.waiting,
    loading: pending.current?.play === true || !!p?.waiting,
    failed: !!p?.failed || (uid !== "" && !!take.error),
    missing: false,
  })

  /** Another take into the player, at `at`; `play` starts it once its page has come. */
  const load = (u: string, at: number, play: boolean) => {
    if (play) wakeSound()
    pending.current = { at, play }
    tick(u, at)
    setUid(u)
    redraw((n) => n + 1)
  }

  const play = (u: string, at?: number) => {
    heard(u)
    const now = player.current
    if (u !== uid || !now) return load(u, at ?? 0, true)
    setStarted(true)
    if (at !== undefined) now.play(at)
    else if (now.playing) now.pause()
    else now.play()
  }

  const seek = (u: string, at: number) => {
    heard(u)
    const now = player.current
    if (u !== uid || !now) return load(u, at, true)
    tick(u, at)
    now.seek(at)
  }

  const cue = (u: string, at: number) => {
    if (player.current?.playing) return
    if (u === uid && player.current) {
      tick(u, at)
      player.current.seek(at)
    } else load(u, at, false)
  }

  const mute = (i: number) =>
    setMuted((m) => {
      const on = !m.includes(i)
      player.current?.setMute(i, on)
      return on ? [...m, i] : m.filter((x) => x !== i)
    })

  const soloOne = (i: number) =>
    setSolo((s) => {
      const on = s !== i
      player.current?.setSolo(i, on)
      return on ? i : null
    })

  const sounds = (i: number) => (solo !== null ? solo === i : !muted.includes(i))

  // The latest of everything above, for the take page's sound to call at any time.
  const latest = useRef({ uid, play, cue })
  latest.current = { uid, play, cue }
  const one = useMemo<One>(() => {
    const mine = (u: string) => (held.current?.uid === u ? player.current : null)
    return {
      playerOf: (u, gen) => (held.current?.uid === u && held.current.gen === gen ? player.current : null),
      comingOf: (u) => (pending.current && latest.current.uid === u && held.current?.uid !== u ? { ...pending.current } : null),
      play: (u, at) => latest.current.play(u, at),
      pause: (u) => {
        const now = mine(u)
        if (now) now.pause()
        else if (pending.current && latest.current.uid === u) {
          pending.current = { ...pending.current, play: false }
          redraw((n) => n + 1)
        }
      },
      cue: (u, at) => latest.current.cue(u, at),
      setMute: (u, i, on) => {
        const now = mine(u)
        if (!now) return
        now.setMute(i, on)
        setMuted((m) => (on ? (m.includes(i) ? m : [...m, i]) : m.filter((x) => x !== i)))
      },
      setSolo: (u, i) => {
        const now = mine(u)
        if (!now) return
        const was = now.soloed
        if (i !== null) now.setSolo(i, true)
        else if (was !== null) now.setSolo(was, false)
        setSolo(i)
      },
      ready: (u, setup) => {
        setups.current.set(u, setup)
        return () => {
          if (setups.current.get(u) === setup) setups.current.delete(u)
        }
      },
    }
  }, [])

  return (
    <PlayerCtx.Provider value={{ uid, take: take.data, supported, look, play, seek, cue, heard, muted, solo, mute, soloOne, sounds }}>
      <OneCtx.Provider value={one}>{children}</OneCtx.Provider>
    </PlayerCtx.Provider>
  )
}

export const CANNOT_PLAY = "This browser cannot play the takes. Try Chrome, Edge or Safari, updated."

/**
 * A take's page or panel that shows marks new for you hears the take again,
 * so they stop being new without a reload: a mark set after you heard it.
 */
export function useHeardAgain(take: { uid: string; marks: { is_new: boolean }[] } | undefined) {
  const p = usePlayer()
  const fresh = !!take?.marks.some((m) => m.is_new)
  useEffect(() => {
    if (take && fresh) p.heard(take.uid, true)
    // Once each time something new shows up on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [take?.uid, fresh])
}
