import type { StoriesContent } from "../content/stories"
import { Closing } from "../page/Closing"
import { Footer } from "../page/Footer"
import { Nav } from "../page/Nav"
import { REPO } from "../page/links"
import { StoryCard } from "./StoryCard"

/** Every story, a card each, in the order they were written (StoryCard). */
export function StoriesPage({ stories }: { stories: StoriesContent }) {
  return (
    <>
      <Nav repo={REPO} home="/" />
      <main>
        <section className="section">
          <header className="tale-head">
            <p className="eyebrow">Stories</p>
            <h1 className="h2">{stories.title}</h1>
            <p className="lede">{stories.lede}</p>
          </header>
          <div className="tales">
            {stories.list.map((story) => (
              <StoryCard key={story.slug} story={story} />
            ))}
          </div>
        </section>
      </main>
      <Closing />
      <Footer />
    </>
  )
}
