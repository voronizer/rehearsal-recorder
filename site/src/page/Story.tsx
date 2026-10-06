import { useCallback, useEffect, useRef, useState } from "react"
import { content } from "../content"
import type { ToStage } from "../frame"
import { LiveFrame } from "./LiveFrame"
import { Paragraphs } from "./Md"

/**
 * The four steps on the left, and on the right the app going through them:
 * the step in the middle of the screen is the one it shows. The rail under
 * it fills as the page scrolls, and jumps to a step.
 */
export function Story() {
  const { story } = content
  const [active, setActive] = useState(0)
  const activeRef = useRef(0)
  const send = useRef<((message: ToStage) => void) | null>(null)
  const steps = useRef<(HTMLLIElement | null)[]>([])
  const rail = useRef<(HTMLElement | null)[]>([])

  useEffect(() => {
    let queued = false
    const sync = () => {
      queued = false
      const focus = window.innerHeight * 0.5
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
        send.current?.({ type: "rr-step", step: at })
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
  }, [])

  const onReady = useCallback((to: (message: ToStage) => void) => {
    send.current = to
    to({ type: "rr-step", step: activeRef.current })
  }, [])

  return (
    <section className="section" id="how">
      <div className="head">
        <h2 className="h2">{story.title}</h2>
      </div>
      <div className="story">
        <div className="stage">
          <LiveFrame scene="story" title="Rehearsal Recorder, following the steps on this page" lazy onReady={onReady} />
          <div className="rail" aria-label="Steps">
            {story.steps.map((s, i) => (
              <button
                key={s.id}
                type="button"
                className={i === active ? "on" : undefined}
                aria-current={i === active ? "step" : undefined}
                onClick={() => steps.current[i]?.scrollIntoView({ behavior: "smooth", block: "center" })}
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
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
