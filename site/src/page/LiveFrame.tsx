import { useEffect, useRef } from "react"
import { isFromStage, type ToStage } from "../frame"

// A whole screen of the app, laid out as in its window and scaled to fit.
const WIDTH = 1180
const HEIGHT = 960

/**
 * A live piece of the app: a frame of stage.html, with its own fake Python
 * side. It holds still while it is off screen (spec D7), and is told so
 * again whenever it starts afresh.
 */
export function LiveFrame({
  scene,
  title,
  interactive = false,
  lazy = false,
  onReady,
  onBeat,
}: {
  scene: string
  title: string
  /** Whether a visitor can use it; on a phone none is. */
  interactive?: boolean
  lazy?: boolean
  /** Called each time the frame is up, with a way to talk to it. */
  onReady?: (send: (message: ToStage) => void) => void
  /** Called as the story gets to each line of a step. */
  onBeat?: (step: number, beat: number) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const b = box.current!
    const f = frame.current!
    const send = (message: ToStage) => f.contentWindow?.postMessage(message, location.origin)

    const fit = () => {
      const scale = b.clientWidth / WIDTH
      f.style.width = `${WIDTH}px`
      f.style.height = `${HEIGHT}px`
      f.style.transform = `scale(${scale})`
      b.style.height = `${Math.round(HEIGHT * scale)}px`
    }
    fit()
    const resized = new ResizeObserver(fit)
    resized.observe(b)

    let seen = false
    const watched = new IntersectionObserver((entries) => {
      seen = entries[entries.length - 1].isIntersecting
      send({ type: "rr-hold", hold: !seen })
    })
    watched.observe(b)

    const onMessage = (e: MessageEvent) => {
      if (e.source !== f.contentWindow || !isFromStage(e.data)) return
      if (e.data.type === "rr-beat") {
        onBeat?.(e.data.step, e.data.beat)
        return
      }
      send({ type: "rr-hold", hold: !seen })
      onReady?.(send)
    }
    window.addEventListener("message", onMessage)

    return () => {
      resized.disconnect()
      watched.disconnect()
      window.removeEventListener("message", onMessage)
    }
  }, [onReady, onBeat])

  return (
    <div className="screen">
      <div ref={box} className={interactive ? "live" : "live passive"}>
        <iframe
          ref={frame}
          src={`/stage.html#${scene}`}
          title={title}
          tabIndex={interactive ? undefined : -1}
          loading={lazy ? "lazy" : undefined}
        />
      </div>
    </div>
  )
}
