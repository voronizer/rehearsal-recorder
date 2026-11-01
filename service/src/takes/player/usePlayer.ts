import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { playLook, type PlayLook } from "@/lib/playLook"
import type { TakePage } from "../../api"
import { Player } from "./player"

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

/**
 * A take's player for a page: its tracks at the balance set in РЭХА, M and
 * S for each, the playhead, and the ▶'s look. The files are fetched only
 * once ▶ is pressed. `start` is where the playhead begins (?at=).
 */
export function usePlayer(take: TakePage | undefined, start = 0) {
  const supported = useSupported()
  const player = useRef<Player | null>(null)
  const [, redraw] = useState(0)
  const [time, setTime] = useState(start)
  const [muted, setMuted] = useState<number[]>([])
  const [solo, setSolo] = useState<number | null>(null)
  const [started, setStarted] = useState(false)
  const key = take ? `${take.uid}/${take.gen}` : ""

  useEffect(() => {
    if (!take || !supported) return
    const p = new Player(take.tracks.map((t) => ({ url: t.mp3, gain: take.balance[t.name] ?? 1 })))
    p.onChange = () => {
      setTime(p.time())
      redraw((n) => n + 1)
    }
    p.seek(start)
    player.current = p
    setMuted([])
    setSolo(null)
    setStarted(false)
    return () => {
      p.close()
      if (player.current === p) player.current = null
    }
    // A new take or generation is a new player; the rest is read when it is made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, supported])

  // The playhead moves on screen while the take plays.
  const playing = player.current?.playing ?? false
  useEffect(() => {
    if (!playing) return
    let frame = requestAnimationFrame(function tick() {
      if (player.current) setTime(player.current.time())
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [playing])

  const p = player.current
  const look: PlayLook = playLook({
    loaded: started,
    playing: !!p?.playing && !p.waiting,
    loading: !!p?.waiting,
    failed: !!p?.failed,
    missing: false,
  })

  const toggle = useCallback(() => {
    const p = player.current
    if (!p) return
    setStarted(true)
    if (p.playing) p.pause()
    else p.play()
  }, [])

  const seek = useCallback((at: number) => {
    setTime(at)
    player.current?.seek(at)
  }, [])

  const mute = useCallback((i: number) => {
    setMuted((m) => {
      const on = !m.includes(i)
      player.current?.setMute(i, on)
      return on ? [...m, i] : m.filter((x) => x !== i)
    })
  }, [])

  const soloOne = useCallback((i: number) => {
    setSolo((s) => {
      const on = s !== i
      player.current?.setSolo(i, on)
      return on ? i : null
    })
  }, [])

  const heard = (i: number) => (solo !== null ? solo === i : !muted.includes(i))

  return { supported, look, time, toggle, seek, muted, solo, mute, soloOne, heard, playing: look === "playing" }
}

export const CANNOT_PLAY = "This browser cannot play the takes. Try Chrome, Edge or Safari, updated."
