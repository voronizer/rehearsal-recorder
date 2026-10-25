import { useEffect, useRef, useState } from "react"
import { content } from "../content"
import { Chat } from "../stories/Chat"

/**
 * Right after the first screen: the band arguing, the first two chats of a
 * story, beside a few words and the way to the story. The lines come in one
 * at a time once the chat is in view, as messages do; with Reduce motion
 * they are all there (page.css).
 */
export function StoriesBlock() {
  const { story, heading, line, link } = content.stories.block
  const chats = story.chapters[0].blocks.flatMap((b) => (b.kind === "chat" ? [b.lines] : [])).slice(0, 2)
  // Each chat's first line, counted through both: they come in that order.
  const starts = chats.map((_, i) => chats.slice(0, i).reduce((n, lines) => n + lines.length, 0))
  const side = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    // The chat itself, not the whole block: on a phone on its side 40% of
    // the stacked block never fits on the screen at once.
    const seen = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
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
          <a className="more" href={`/stories/${story.slug}`}>
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
