import { cardChat, readingMinutes, type StoryDoc } from "../content/stories"
import { Chat } from "./Chat"

/** A story's card: the band's first lines in it, over its title, its line
 *  and how long it takes to read. The whole card is the link. `wide`, at a
 *  story's end, puts the chat beside the words, with `eyebrow` over them. */
export function StoryCard({ story, wide = false, eyebrow }: { story: StoryDoc; wide?: boolean; eyebrow?: string }) {
  const lines = cardChat(story)
  return (
    <a className={wide ? "tale-card wide" : "tale-card"} href={`/stories/${story.slug}`}>
      {/* A taste of the story, which has these lines in it: a screen reader
          gets the card's title first, as its link's name. */}
      {lines.length > 0 && (
        <div className="card-chat" aria-hidden="true">
          <Chat lines={lines} />
        </div>
      )}
      <div className="card-copy">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2>{story.title}</h2>
        <p>{story.description}</p>
        <span className="card-foot">
          <span className="more">Read</span>
          <span className="fine">{readingMinutes(story)} min read</span>
        </span>
      </div>
    </a>
  )
}
