import { useCallback, useEffect, useRef, useState } from "react"
import { poll, type MetronomeState } from "@/lib/api"
import { beatAt, type Click, type Heard } from "@/lib/metronome"

/** How often Python is asked where the metronome is, in ms. Each answer
 *  lists the clicks of the next 1.5 s, so the light is placed well ahead. */
const POLL_MS = 250

/** How far the count-in's end may move between answers, in ms, before the
 *  screen takes the new one: the answers' own jitter is less. */
const COUNT_IN_JITTER_MS = 20

export type Metronome = {
  /** Python's metronome, its count-in counted on to this frame: the phase
   *  turns from count to take, and `count` goes up, on the click. Null
   *  until it has answered once. */
  state: MetronomeState | null
  /** The click lit now, as its index in the bar, or null between clicks. */
  lit: number | null
  /** When the take's count-in ends, or ended, on the page's clock
   *  (performance.now()): the take's clock starts there. Null with no
   *  click. */
  countInEnd: number | null
  /** Asks again at once, after the screen has changed something; done once
   *  an answer asked after the change is on screen, with that answer (the
   *  last one heard should the asking fail, null after the screen has
   *  gone). */
  refresh: () => Promise<MetronomeState | null>
}

type View = Omit<Metronome, "refresh">

/** The two say the same, but for when the clicks fall. */
const same = (a: MetronomeState, b: MetronomeState) =>
  JSON.stringify({ ...a, upcoming: null, since_count_in_ms: null }) ===
  JSON.stringify({ ...b, upcoming: null, since_count_in_ms: null })

/**
 * The metronome as Python has it, asked four times a second through the
 * polling the levels use, and each click it lists lit at the moment it is
 * heard, with requestAnimationFrame. The screen keeps no clock of its own
 * that could drift from the click (spec Part 5): between answers it counts
 * on from the last one, and a frame is asked for only while a click is due,
 * lit or counted.
 */
export function useMetronome(): Metronome {
  const [view, setView] = useState<View>({ state: null, lit: null, countInEnd: null })
  const ask = useRef<() => Promise<MetronomeState | null>>(async () => null)

  useEffect(() => {
    let alive = true
    let timer = 0
    let frame = 0
    let asking = false
    let again = false
    let heard: Heard | null = null
    let last: Click | null = null
    // How many askings have started, and who waits for one started later.
    let started = 0
    const waiting: { after: number; done: (state: MetronomeState | null) => void }[] = []

    // What to show at this frame, and whether another is wanted.
    const draw = () => {
      frame = 0
      if (!alive || !heard) return
      const now = performance.now()
      const beat = beatAt(heard, last, now)
      last = beat.last
      const { state: answer, at } = heard
      const next = { ...answer, phase: beat.phase, count: beat.count }
      const since = answer.since_count_in_ms
      const end = since === null ? null : at - since
      setView((v) => {
        const state = v.state && same(v.state, next) ? v.state : next
        const countInEnd =
          end !== null && v.countInEnd !== null && Math.abs(end - v.countInEnd) < COUNT_IN_JITTER_MS
            ? v.countInEnd
            : end
        return state === v.state && beat.lit === v.lit && countInEnd === v.countInEnd
          ? v
          : { state, lit: beat.lit, countInEnd }
      })
      const due =
        beat.lit !== null || beat.phase === "count" || answer.upcoming.some(([ms]) => at + ms > now)
      if (due) frame = requestAnimationFrame(draw)
    }

    const listen = async () => {
      if (asking) {
        again = true
        return
      }
      asking = true
      window.clearTimeout(timer)
      const n = ++started
      try {
        const sent = performance.now()
        const state = await poll("metronome_state")
        if (!alive) return
        // The answer was made somewhere between the asking and its coming
        // back: the middle is the best guess at when its clicks count from.
        heard = { state, at: (sent + performance.now()) / 2 }
        cancelAnimationFrame(frame)
        draw()
      } catch {
        /* the bridge blinked: ask again next time */
      } finally {
        asking = false
      }
      if (!alive) return
      for (let i = waiting.length - 1; i >= 0; i--) {
        if (waiting[i].after < n) waiting.splice(i, 1)[0].done(heard?.state ?? null)
      }
      if (again) {
        again = false
        void listen()
      } else timer = window.setTimeout(listen, POLL_MS)
    }

    ask.current = () =>
      new Promise<MetronomeState | null>((done) => {
        waiting.push({ after: started, done })
        void listen()
      })
    void listen()
    return () => {
      alive = false
      window.clearTimeout(timer)
      cancelAnimationFrame(frame)
      for (const w of waiting.splice(0)) w.done(null)
    }
  }, [])

  const refresh = useCallback(() => ask.current(), [])
  return { ...view, refresh }
}
