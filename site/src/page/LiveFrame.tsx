import { useEffect, useRef, useState } from "react"
import { isFromStage, type ToStage } from "../frame"

// A whole screen of the app, laid out as in its window and scaled to fit.
const WIDTH = 1180
const HEIGHT = 960

/** A frame of stage.html at that hash. */
type Frame = { key: number; hash: string }

/**
 * A live piece of the app: a frame of stage.html, with its own fake Python
 * side. It holds still while it is off screen (spec D7) or while `hold`
 * says so, and is told so again whenever it starts afresh.
 *
 * When the frame asks to be started again at a place behind it
 * (rr-restart), a fresh one starts there under it, and takes its place once
 * it has got there (rr-there): until then the old one stays on show. Any
 * word from the page but a hold goes to the one on show, and drops a fresh
 * one still on its way: the one on show starts another if it needs to.
 */
export function LiveFrame({
  scene,
  title,
  interactive = false,
  lazy = false,
  hold = false,
  onReady,
  onBeat,
}: {
  scene: string
  title: string
  /** Whether a visitor can use it; on a phone none is. */
  interactive?: boolean
  lazy?: boolean
  /** Holds it still while true, as when something is shown over it. */
  hold?: boolean
  /** Called each time a frame comes on show, up and with a way to talk to it. */
  onReady?: (send: (message: ToStage) => void) => void
  /** Called as the story gets to each line of a step. */
  onBeat?: (step: number, beat: number) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [frames, setFrames] = useState<Frame[]>([{ key: 0, hash: scene }])
  const [scale, setScale] = useState(0)
  // The frames as they are about to be, for the messages that come before
  // React has drawn them.
  const shown = useRef(frames)
  const els = useRef(new Map<number, HTMLIFrameElement>())
  const made = useRef(1)
  const held = useRef(true)
  const asked = useRef(hold)
  asked.current = hold
  // Set once, below: how to tell every frame whether to hold.
  const tellHold = useRef<() => void>(() => {})

  useEffect(() => {
    const b = box.current!
    const post = (key: number, message: ToStage) =>
      els.current.get(key)?.contentWindow?.postMessage(message, location.origin)
    const change = (to: Frame[]) => {
      shown.current = to
      setFrames(to)
    }
    const send = (message: ToStage) => {
      const [on, fresh] = shown.current
      if (fresh) change([on])
      post(on.key, message)
    }

    const fit = () => setScale(b.clientWidth / WIDTH)
    fit()
    const resized = new ResizeObserver(fit)
    resized.observe(b)

    let seen = false
    tellHold.current = () => {
      held.current = !seen || asked.current
      for (const f of shown.current) post(f.key, { type: "rr-hold", hold: held.current })
    }
    const watched = new IntersectionObserver((entries) => {
      seen = entries[entries.length - 1].isIntersecting
      tellHold.current()
    })
    watched.observe(b)

    const onMessage = (e: MessageEvent) => {
      const at = shown.current.find((f) => els.current.get(f.key)?.contentWindow === e.source)
      if (!at || !isFromStage(e.data)) return
      const [on, fresh] = shown.current
      switch (e.data.type) {
        case "rr-beat":
          if (at === on) onBeat?.(e.data.step, e.data.beat)
          return
        case "rr-restart":
          if (at === on) change([on, { key: made.current++, hash: e.data.hash }])
          return
        case "rr-there":
          if (at === fresh) {
            change([fresh])
            onReady?.(send)
          }
          return
        case "rr-ready":
          post(at.key, { type: "rr-hold", hold: held.current })
          if (at === on) onReady?.(send)
      }
    }
    window.addEventListener("message", onMessage)

    return () => {
      resized.disconnect()
      watched.disconnect()
      window.removeEventListener("message", onMessage)
    }
  }, [onReady, onBeat])

  useEffect(() => tellHold.current(), [hold])

  return (
    <div className="screen">
      <div
        ref={box}
        className={interactive ? "live" : "live passive"}
        style={{ height: Math.round(HEIGHT * scale) || undefined }}
      >
        {frames.map((f, i) => (
          <iframe
            key={f.key}
            ref={(el) => void (el ? els.current.set(f.key, el) : els.current.delete(f.key))}
            src={`/stage.html#${f.hash}`}
            title={i === 0 ? title : `${title}, starting again`}
            tabIndex={interactive ? undefined : -1}
            loading={lazy && f.key === 0 ? "lazy" : undefined}
            aria-hidden={i === 0 ? undefined : true}
            data-shown={i === 0 ? "true" : "false"}
            style={{ width: WIDTH, height: HEIGHT, transform: `scale(${scale})`, zIndex: i === 0 ? 1 : 0 }}
          />
        ))}
      </div>
    </div>
  )
}
