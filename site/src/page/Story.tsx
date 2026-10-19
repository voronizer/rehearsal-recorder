import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { content, type ItemId } from "../content"
import type { ToStage } from "../frame"
import { KIND, SHOWS } from "./evening"
import { LiveFrame } from "./LiveFrame"
import { Paragraphs } from "./Md"
import { itemPieces, type PieceData } from "./pieces"
import { titleParts } from "./title"

/** The step each item is in, by its id. */
const STEP_OF = new Map(content.story.steps.flatMap((s, i) => s.items.map((item) => [item.id as ItemId, i])))

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
 * The four steps of an evening on the left, each with its tiles and cards,
 * and on the right the app's window. The step in the middle of the screen
 * is the one the app goes through; the rail under it fills as the page
 * scrolls, and jumps to a step. A click on a tile or card shows its moment
 * (evening.ts): the live app gets there, or a piece of it shows over it, at
 * once, while the app waits underneath. Moving into another step clears it.
 */
export function Story({ pieces }: { pieces: PieceData }) {
  const { story } = content
  const [active, setActive] = useState(0)
  const [picked, setPicked] = useState<ItemId | null>(null)
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

  const onReady = useCallback(
    (to: (message: ToStage) => void) => {
      send.current = to
      tell(true)
    },
    [tell]
  )

  /** Scrolls a step's top to the top of the screen, or, on a phone, to just
   *  under the window held at the top. */
  const goTo = (i: number) => {
    const step = steps.current[i]
    const held = stage.current
    if (!step || !held) return
    const above = beside() ? 24 : parseFloat(getComputedStyle(held).top) + held.offsetHeight + 16
    window.scrollTo({ top: window.scrollY + step.getBoundingClientRect().top - above, behavior: scrolling() })
  }

  const pick = (id: ItemId) => {
    if (pickedRef.current === id) return
    pickedRef.current = id
    setPicked(id)
    tell()
  }

  const shows = picked && SHOWS[picked]
  const piece = shows && "piece" in shows ? shows.piece : null

  return (
    <section className="section" id="how">
      <div className="head">
        <h2 className="h2">{story.title}</h2>
      </div>
      <div className="story">
        <div ref={stage} className="stage">
          <div className="window">
            <LiveFrame
              scene="story"
              title="РЭХА, following the steps on this page"
              lazy
              hold={piece !== null}
              onReady={onReady}
            />
            {piece && <Over key={piece}>{drawn[piece]}</Over>}
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
            <li key={s.id} ref={(el) => void (steps.current[i] = el)} className={i === active ? "step on" : "step"}>
              <span className="n">{i + 1}</span>
              <h3>{s.title}</h3>
              <Paragraphs text={s.body} />
              <div className="items">
                {s.items.map((item) => {
                  const id = item.id as ItemId
                  const on = picked === id
                  return (
                    <article key={id} className={`item ${KIND[id]}${on ? " on" : ""}`}>
                      <h4>
                        <button type="button" aria-pressed={on} onClick={() => pick(id)}>
                          <Title text={item.title} />
                        </button>
                      </h4>
                      <Paragraphs text={item.body} />
                    </article>
                  )
                })}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
