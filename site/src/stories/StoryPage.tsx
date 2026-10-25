import type { StoryBlock, StoryDoc } from "../content/stories"
import { Closing } from "../page/Closing"
import { Downloads } from "../page/Downloads"
import { Footer } from "../page/Footer"
import { Inline } from "../page/Md"
import { Nav } from "../page/Nav"
import { REPO } from "../page/links"
import { Chat } from "./Chat"

function Blocks({ blocks }: { blocks: StoryBlock[] }) {
  return blocks.map((block, i) => {
    if (block.kind === "chat") return <Chat key={i} lines={block.lines} />
    return (
      <p key={i} className={block.kind === "joke" ? "joke" : undefined}>
        <Inline text={block.text} />
      </p>
    )
  })
}

/**
 * A story, whole: its head, the opening, the chapters, each with its name
 * beside it, and the downloads. Written at build time (render.tsx), so the
 * downloads are there for both systems, and main.ts shows the visitor's.
 */
export function StoryPage({ story, byline }: { story: StoryDoc; byline: string }) {
  return (
    <>
      <Nav repo={REPO} home="/" />
      <main>
        <article className="section tale-section">
          <header className="tale-head">
            <p className="eyebrow">Stories</p>
            <h1 className="h2">{story.title}</h1>
            <p className="fine">{byline}</p>
          </header>
          <div className="tale">
            {story.chapters.map((chapter, n) =>
              chapter.id === null ? (
                <div key={n} className="chap lead">
                  <div className="chap-body">
                    <Blocks blocks={chapter.blocks} />
                  </div>
                </div>
              ) : (
                <section key={n} id={chapter.id} className="chap">
                  <div className="chap-head">
                    <span className="n">{n}</span>
                    <h2>{chapter.title}</h2>
                  </div>
                  <div className="chap-body">
                    <Blocks blocks={chapter.blocks} />
                  </div>
                </section>
              )
            )}
            <div className="tale-get">
              <div data-os="mac">
                <Downloads windows={false} />
              </div>
              <div data-os="windows" hidden>
                <Downloads windows />
              </div>
            </div>
          </div>
        </article>
      </main>
      <Closing />
      <Footer />
    </>
  )
}
