import { useEffect, useLayoutEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { useKey } from "@/hooks/useSpacebar"
import { api, poll, type Signature } from "@/lib/api"
import { useKeysOn } from "@/lib/keys"
import { tapTempo } from "@/lib/metronome"

/** How long after the last tap or hit the pads keep counting, in ms: the
 *  pause that starts the count afresh (Part 11), and a little over. */
const PADS_FOR_MS = 2200

/** How often the pads' hits are asked for while they count, in ms. Each
 *  hit comes with when it was, so this only decides how soon it shows. */
const PADS_POLL_MS = 100

/** The taps kept: enough for the last four gaps and a pause before them. */
const KEPT = 16

/**
 * Tap, and the key T anywhere on its screen but in a text field (Part 11).
 * The tempo is the last four gaps between taps, a pause of two seconds
 * starting it afresh; in 6/8 a tap is an eighth. After a press, hits on the
 * band's MIDI pads count as taps too, until they pause: Python hears them
 * (`metronome_tap_listen`) and says when each was (`metronome_taps`).
 *
 * Should Python not open the pads, `onError` says why in the screen's
 * notice, and the taps on the button count all the same.
 *
 * T is one of the player's keys: with those off in Settings › Keys it does
 * nothing, and the button shows no chip (B9).
 */
export function TapButton({
  signature,
  onTempo,
  onError,
  disabled = false,
}: {
  signature: Signature
  onTempo: (tempo: number) => void
  /** Python could not open the band's pads for the tapping: its words. */
  onError?: (text: string) => void
  disabled?: boolean
}) {
  const keys = useKeysOn("player")
  const taps = useRef<number[]>([])
  const live = useRef({ signature, onTempo, onError })
  useLayoutEffect(() => {
    live.current = { signature, onTempo, onError }
  })
  // Until when the pads count, on the page's clock, and the asking for them.
  const padsUntil = useRef(0)
  const timer = useRef(0)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      window.clearTimeout(timer.current)
    }
  }, [])

  const count = (times: number[]) => {
    taps.current = [...taps.current, ...times].sort((a, b) => a - b).slice(-KEPT)
    const tempo = tapTempo(taps.current, live.current.signature)
    if (tempo !== null) live.current.onTempo(tempo)
  }

  const hearPads = async () => {
    timer.current = 0
    try {
      const { ms_ago } = await poll("metronome_taps")
      if (!alive.current) return
      if (ms_ago.length) {
        const now = performance.now()
        count(ms_ago.map((ms) => now - ms))
        padsUntil.current = now + PADS_FOR_MS
      }
    } catch {
      /* the bridge blinked: the next asking has the hits */
    }
    if (alive.current && performance.now() < padsUntil.current)
      timer.current = window.setTimeout(hearPads, PADS_POLL_MS)
  }

  const tap = () => {
    if (disabled) return
    const now = performance.now()
    count([now])
    padsUntil.current = now + PADS_FOR_MS
    let bridge: ReturnType<typeof api>
    try {
      bridge = api()
    } catch {
      /* no bridge (a still picture of the row): the taps count all the same */
      return
    }
    void bridge.metronome_tap_listen().then(
      (res) => {
        if (alive.current && !res.ok) live.current.onError?.(res.error ?? "The band's pads could not be opened")
      },
      () => {
        /* the bar across the top says why */
      }
    )
    if (!timer.current) timer.current = window.setTimeout(hearPads, PADS_POLL_MS)
  }

  useKey("t", tap, !disabled)

  return (
    <Button
      variant="outline"
      size="row"
      onClick={tap}
      disabled={disabled}
      aria-keyshortcuts={keys ? "T" : undefined}
    >
      Tap
      {keys && <Kbd aria-hidden>T</Kbd>}
    </Button>
  )
}
