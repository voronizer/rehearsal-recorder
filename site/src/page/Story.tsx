import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { content, type Item, type ItemId } from "../content"
import type { ToStage } from "../frame"
import { BEAT_FOCUS, KIND, SHOWS, type Focus } from "./evening"
import { LiveFrame } from "./LiveFrame"
import { Paragraphs } from "./Md"
import { itemPieces, type PieceData } from "./pieces"
import { titleParts } from "./title"

/** The step each item is in, and the item, by its id. */
const STEP_OF = new Map(content.story.steps.flatMap((s, i) => s.items.map((item) => [item.id, i])))
const ITEM = new Map(content.story.steps.flatMap((s) => s.items.map((item) => [item.id, item])))

/** Smooth, unless whoever is reading has asked for less motion. */
const scrolling = (): ScrollBehavior =>
  matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"

const same = (a: ToStage | null, b: ToStage) => JSON.stringify(a) === JSON.stringify(b)

/** A title, its short hyphenated words kept whole (see titleParts). */
function Title({ text }: { text: string }) {
  return titleParts(text).map((part, i) =>
    part.whole ? (
      <span key={i} className="whole">
        {part.text}
      </span>
    ) : (
      part.text
    )
  )
}

/** Where the steps are beside the window rather than under it (page.css). */
const beside = () => matchMedia("(min-width: 900px)").matches

/**
 * A piece of the app over the window, in its middle: made smaller to fit,
 * as the live app is, when it is bigger than the window.
 */
function Over({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useLayoutEffect(() => {
    const o = outer.current!
    const i = inner.current!
    // The piece itself: a piece as wide as a line of the app is wider than
    // the window on a phone, and goes past it on both sides.
    const piece = i.firstElementChild as HTMLElement | null
    if (!piece) return
    const fit = () => {
      const room = getComputedStyle(o)
      const w = o.clientWidth - parseFloat(room.paddingLeft) - parseFloat(room.paddingRight)
      const h = o.clientHeight - parseFloat(room.paddingTop) - parseFloat(room.paddingBottom)
      setScale(Math.min(1, w / piece.offsetWidth, h / piece.offsetHeight))
    }
    fit()
    const resized = new ResizeObserver(fit)
    resized.observe(o)
    resized.observe(piece)
    return () => resized.disconnect()
  }, [])
  return (
    <div ref={outer} className="over">
      <div ref={inner} className="fit" style={{ transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  )
}

/**
 * The four steps of an evening on the left, each with its tiles and, under
 * them, its cards as a list that opens the one picked; and on the right the app's window, near enough to read, with a few words
 * under it on what it shows. The step in the middle of the screen is the
 * one the app goes through, the window following it; the rail under the
 * window fills as the page scrolls, and jumps to a step. A click on a tile
 * or card shows its moment (evening.ts): the live app gets there and the
 * window looks at what the item is about, or a piece of the app shows over
 * it, at once, while the app waits underneath. Moving into another step
 * clears it.
 */
export function Story({ pieces }: { pieces: PieceData }) {
  const { story } = content
  const [active, setActive] = useState(0)
  const [picked, setPicked] = useState<ItemId | null>(null)
  // The story's step and line the app last got to, for where the window
  // looks while nothing is picked.
  const [beat, setBeat] = useState<[number, number] | null>(null)
  const activeRef = useRef(0)
  const pickedRef = useRef<ItemId | null>(null)
  const send = useRef<((message: ToStage) => void) | null>(null)
  const sent = useRef<ToStage | null>(null)
  const stage = useRef<HTMLDivElement>(null)
  const steps = useRef<(HTMLLIElement | null)[]>([])
  const rail = useRef<(HTMLElement | null)[]>([])
  const drawn = useMemo(() => itemPieces(pieces), [pieces])

  /** What the app should be at: the picked item's moment, or the step on
   *  screen to run through; the place it is at, for a piece over it. */
  const tell = useCallback((always = false) => {
    const shows = pickedRef.current && SHOWS[pickedRef.current]
    if (shows && "piece" in shows) return
    const message: ToStage =
      shows && "moment" in shows
        ? { type: "rr-moment", ...shows.moment }
        : { type: "rr-step", step: activeRef.current }
    if (!send.current || (!always && same(sent.current, message))) return
    sent.current = message
    send.current(message)
  }, [])

  useEffect(() => {
    let queued = false
    const sync = () => {
      queued = false
      // The middle of what is left of the screen for the steps: on a phone
      // the window is held over them, at the top.
      const top = beside() || !stage.current ? 0 : stage.current.getBoundingClientRect().bottom
      const focus = (Math.min(Math.max(0, top), window.innerHeight / 2) + window.innerHeight) / 2
      let at = steps.current.length - 1
      let part = 1
      for (let i = 0; i < steps.current.length; i++) {
        const r = steps.current[i]!.getBoundingClientRect()
        if (focus < r.bottom) {
          at = i
          part = Math.min(1, Math.max(0, (focus - r.top) / r.height))
          break
        }
      }
      rail.current.forEach((bar, i) =>
        bar?.style.setProperty("--p", i < at ? "1" : i === at ? part.toFixed(3) : "0")
      )
      if (at !== activeRef.current) {
        activeRef.current = at
        setActive(at)
        // Into another step, the item lit is put out: unless it is one of
        // this step's, picked as the step came up on screen.
        if (pickedRef.current === null || STEP_OF.get(pickedRef.current) !== at) {
          pickedRef.current = null
          setPicked(null)
        }
        tell()
      }
    }
    const onScroll = () => {
      if (queued) return
      queued = true
      requestAnimationFrame(sync)
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll)
    sync()
    return () => {
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
    }
  }, [tell])

  const onBeat = useCallback((step: number, n: number) => setBeat([step, n]), [])

  const onReady = useCallback(
    (to: (message: ToStage) => void) => {
      send.current = to
      tell(true)
    },
    [tell]
  )

  /** Scrolls a step's top to the top of the screen, or, on a phone, to just
   *  under the window held at the top. A step shorter than the room down to
   *  the middle of what is left (sync's focus line) has its middle put
   *  there instead, or the step after it would be the one on screen. */
  const goTo = (i: number) => {
    const step = steps.current[i]
    const held = stage.current
    if (!step || !held) return
    const above = beside() ? 24 : parseFloat(getComputedStyle(held).top) + held.offsetHeight + 16
    const box = step.getBoundingClientRect()
    const focus = (Math.min(beside() ? 0 : above, window.innerHeight / 2) + window.innerHeight) / 2
    const top = box.height < focus - above ? focus - box.height / 2 : above
    window.scrollTo({ top: window.scrollY + box.top - top, behavior: scrolling() })
  }

  const pick = (id: ItemId) => {
    if (pickedRef.current === id) return
    pickedRef.current = id
    setPicked(id)
    tell()
  }

  /** A tile, with its line; or a card, a row of the list under the tiles,
   *  its line showing only while the window shows it. */
  const itemOf = (item: Item) => {
    const id = item.id
    const on = picked === id
    return (
      <article key={id} className={`item ${KIND[id]}${on ? " on" : ""}`}>
        <h4>
          <button type="button" aria-pressed={on} onClick={() => pick(id)}>
            <Title text={item.title} />
          </button>
        </h4>
        {(KIND[id] === "tile" || on) && <Paragraphs text={item.line} />}
      </article>
    )
  }

  const shows = picked && SHOWS[picked]
  const piece = shows && "piece" in shows ? shows.piece : null
  // Where the window looks: at the picked moment's part of the screen, or
  // where the app is in its step (under a piece too, which hides it).
  const focus: Focus | null =
    shows && "focus" in shows ? shows.focus : ((beat && BEAT_FOCUS[beat[0]]?.[beat[1]]) ?? null)
  const about = picked ? ITEM.get(picked)! : null
  const step = story.steps[active]

  return (
    <section className="section" id="how">
      <div className="head">
        <h2 className="h2">{story.title}</h2>
      </div>
      <div className="story">
        <div ref={stage} className="stage">
          <div className="window">
            <div className="view">
              <LiveFrame
                scene="story"
                title="РЭХА, following the steps on this page"
                lazy
                hold={piece !== null}
                focus={focus}
                onReady={onReady}
                onBeat={onBeat}
              />
              {piece && <Over key={piece}>{drawn[piece]}</Over>}
            </div>
            {/* What the window shows: the picked item's own words, or the
                step's line while the app goes through it. */}
            <div className="about" aria-live="polite">
              <h4>{about ? about.title : step.title}</h4>
              <Paragraphs text={about ? about.more : step.body} />
            </div>
          </div>
          <div className="rail" role="group" aria-label="Steps">
            {story.steps.map((s, i) => (
              <button
                key={s.id}
                type="button"
                className={i === active ? "on" : undefined}
                aria-current={i === active ? "step" : undefined}
                onClick={() => goTo(i)}
              >
                <i ref={(el) => void (rail.current[i] = el)} />
                {s.title.replace(/\.$/, "")}
              </button>
            ))}
          </div>
        </div>
        <ol className="steps">
          {story.steps.map((s, i) => (
            <li key={s.id} ref={(el) => void (steps.current[i] = el)} className="step">
              <span className="n">{i + 1}</span>
              <h3>{s.title}</h3>
              <Paragraphs text={s.body} />
              <div className="items">
                {s.items.filter((item) => KIND[item.id] === "tile").map(itemOf)}
                {s.items.some((item) => KIND[item.id] === "card") && (
                  <div className="cards">{s.items.filter((item) => KIND[item.id] === "card").map(itemOf)}</div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
