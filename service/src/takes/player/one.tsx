import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import { playLook, type PlayLook } from "@/lib/playLook"
import { useLevels, useTake, type TakePage } from "../../api"
import { firstDesk, whenHeard, withBacking } from "./backing"
import { withMute, withSolo, type Desk } from "./desk"
import { levelOf } from "./levels"
import { keptMaster } from "./master"
import { Player, wakeSound } from "./player"

/*
  The service's one player: ▶ in a list, the take's panel and page, and the
  bar at the bottom all play through it, so one take sounds at a time. A
  take pressed in a list plays once its page has come; its files are
  fetched only then. A take with a Backing track and a song waits for the
  service to say whether you hear Backing, so Backing is never heard
  where you have it muted (backing.ts).
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
  /** A take's M and S. They work whether the take plays or not: a take not in the player keeps them for its first ▶. */
  deskOf: (uid: string) => Desk
  mute: (uid: string, i: number) => void
  soloOne: (uid: string, i: number) => void
  /** Whether track `i` of the take is heard. */
  sounds: (uid: string, i: number) => boolean
}

/** A take's M and S: the tracks muted, the one soloed. */
const NO_DESK: Desk = { muted: [], solo: null }

const PlayerCtx = createContext<PlayerApi | null>(null)
export const usePlayer = () => useContext(PlayerCtx)!

/**
 * What a take's page set on its player: the repeat, M and S set before the
 * take was in the one player, and the levels turned there and not kept yet.
 */
export type Setup = {
  loop: { a: number; b: number } | null
  muted: number[]
  solo: number | null
  moved: Record<string, number>
}

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
  /** Master's level, 0 to 1: how loud every take plays on this device. */
  master: () => number
  /** Master's level, heard at once on the take in the player and on every take after it. */
  setMaster: (volume: number) => void
  /** How loud the take in the player comes out, 0 to 1, after its amount and Master; 0 while none plays. */
  mixLoudness: () => number
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
  // Each take's M and S, kept while the service is open (Alex, 2026-11-02).
  const [desks, setDesks] = useState<Record<string, Desk>>({})
  const desksNow = useRef(desks)
  desksNow.current = desks
  const setDesk = (u: string, change: (d: Desk) => Desk) => setDesks((all) => ({ ...all, [u]: change(all[u] ?? NO_DESK) }))
  const [started, setStarted] = useState(false)
  const key = take.data ? `${take.data.uid}/${take.data.gen}` : ""
  const yours = useLevels().data?.levels
  const yoursNow = useRef(yours)
  yoursNow.current = yours
  /** The take and generation of player.current. */
  const held = useRef<{ uid: string; gen: number } | null>(null)
  const setups = useRef(new Map<string, () => Setup>())
  // Read from the browser's storage once, not on every render.
  const [kept] = useState(keptMaster)
  const master = useRef(kept)

  useEffect(() => {
    const t = take.data
    if (!t || !supported) return
    let gone = false
    let made: Player | null = null
    // Backing as the member hears it for the take's song: a take played
    // from a list, or before its page has opened, waits for the answer.
    whenHeard(t, (heard) => {
      if (gone) return
      // As the take's page left it: its repeat, M and S, and the levels turned
      // there and not kept yet; else the M and S it had in the player before.
      const kept: Setup = setups.current.get(t.uid)?.() ?? { loop: null, ...(desksNow.current[t.uid] ?? firstDesk(t)), moved: {} }
      const setup = { ...kept, ...withBacking(t, kept, heard) }
      const p = Player.of(t, (name) => setup.moved[name] ?? levelOf(yoursNow.current, t, name))
      p.setMaster(master.current)
      p.onChange = () => {
        tick(t.uid, p.time())
        redraw((n) => n + 1)
      }
      p.onEnd = () => redraw((n) => n + 1)
      if (setup.loop) p.setLoop(setup.loop.a, setup.loop.b)
      for (const i of setup.muted) p.setMute(i, true)
      if (setup.solo !== null) p.setSolo(setup.solo, true)
      const go = pending.current
      pending.current = null
      const at = go?.at ?? (clock.uid === t.uid ? clock.time : 0)
      p.seek(at)
      tick(t.uid, at)
      if (go?.play) {
        p.play(at)
        setStarted(true)
      } else setStarted(false)
      made = p
      player.current = p
      held.current = { uid: t.uid, gen: t.gen }
      setDesk(t.uid, () => ({ muted: setup.muted, solo: setup.solo }))
      redraw((n) => n + 1)
    })
    return () => {
      gone = true
      if (!made) return
      made.close()
      if (player.current === made) {
        player.current = null
        held.current = null
      }
    }
    // A new take or generation is a new player; the rest is read when it is made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, supported])

  // Your levels, as they come or change, on the take in the player. A level
  // turned on the take's page and not kept yet stays as the hand left it:
  // the answer to an earlier turn, come late, would put the fader back (#117).
  useEffect(() => {
    const now = player.current
    const t = take.data
    if (!now || !t || held.current?.uid !== t.uid) return
    const inHand = setups.current.get(t.uid)?.().moved ?? {}
    t.tracks.forEach((k, i) => {
      if (!(k.name in inHand)) now.setGain(i, levelOf(yours, t, k.name))
    })
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
    const now = player.current
    if (u !== uid || !now) return load(u, at ?? 0, true)
    setStarted(true)
    if (at !== undefined) now.play(at)
    else if (now.playing) now.pause()
    else now.play()
  }

  const seek = (u: string, at: number) => {
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

  /** The take's Player, while it is the take in the player. */
  const heldOf = (u: string) => (held.current?.uid === u ? player.current : null)
  const deskOf = (u: string) => desks[u] ?? NO_DESK

  const mute = (u: string, i: number) => {
    const on = !deskOf(u).muted.includes(i)
    heldOf(u)?.setMute(i, on)
    setDesk(u, (d) => withMute(d, i, on))
  }

  const soloOne = (u: string, i: number) => {
    const on = deskOf(u).solo !== i
    heldOf(u)?.setSolo(i, on)
    setDesk(u, (d) => withSolo(d, on ? i : null))
  }

  const sounds = (u: string, i: number) => {
    const d = deskOf(u)
    return d.solo !== null ? d.solo === i : !d.muted.includes(i)
  }

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
        setDesk(u, (d) => withMute(d, i, on))
      },
      setSolo: (u, i) => {
        const now = mine(u)
        if (!now) return
        const was = now.soloed
        if (i !== null) now.setSolo(i, true)
        else if (was !== null) now.setSolo(was, false)
        setDesk(u, (d) => withSolo(d, i))
      },
      master: () => master.current,
      mixLoudness: () => player.current?.mixLoudness() ?? 0,
      setMaster: (v) => {
        master.current = Math.min(1, Math.max(0, v))
        player.current?.setMaster(master.current)
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
    <PlayerCtx.Provider value={{ uid, take: take.data, supported, look, play, seek, cue, deskOf, mute, soloOne, sounds }}>
      <OneCtx.Provider value={one}>{children}</OneCtx.Provider>
    </PlayerCtx.Provider>
  )
}

export const CANNOT_PLAY = "This browser cannot play the takes. Try Chrome, Edge or Safari, updated."
