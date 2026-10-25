import { useEffect, useRef, useState } from "react"
import block from "virtual:stories-block"
import { Chat } from "../stories/Chat"

/**
 * Right after the first screen: the band arguing, the first two chats of a
 * story, beside a few words and the way to the story. The lines come in one
 * at a time once the chat is in view, as messages do; with Reduce motion
 * they are all there (page.css).
 */
export function StoriesBlock() {
  const { slug, heading, line, link, chats } = block
  // Each chat's first line, counted through both: they come in that order.
  const starts = chats.map((_, i) => chats.slice(0, i).reduce((n, lines) => n + lines.length, 0))
  const side = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    // Once a third of the chat is on the screen. The chat, as the whole
    // block is taller than a phone on its side.
    const seen = new IntersectionObserver(
      ([entry]) => {
        if (entry.intersectionRatio < 0.3) return
        setShown(true)
        seen.disconnect()
      },
      { threshold: 0.3 }
    )
    if (side.current) seen.observe(side.current)
    return () => seen.disconnect()
  }, [])
  return (
    <section className="stories-block" id="stories">
      <div className="copy">
        <p className="eyebrow">Stories</p>
        <h2>{heading}</h2>
        <p>{line}</p>
        <p>
          <a className="more" href={`/stories/${slug}`}>
            {link}
          </a>
        </p>
      </div>
      <div ref={side} className={shown ? "chat-side shown" : "chat-side"}>
        {chats.map((lines, i) => (
          <Chat key={i} lines={lines} from={starts[i]} />
        ))}
      </div>
    </section>
  )
}
