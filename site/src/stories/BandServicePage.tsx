import type { StoryDoc } from "../content/stories"
import { Closing } from "../page/Closing"
import { Footer } from "../page/Footer"
import { Nav } from "../page/Nav"
import { REPO } from "../page/links"
import { Blocks } from "./StoryPage"

/**
 * reha.stream/band-service: what a band service is, how our band uses one,
 * what it does for each of us, and a link to the setup steps on GitHub
 * (service/README.md). Laid out as a story is, each
 * chapter with its number and name beside it, and written whole at build
 * time (render.tsx). No downloads at the end: the page is for a band that
 * has РЭХА already, and the closing block has them.
 */
export function BandServicePage({ page, byline }: { page: StoryDoc; byline: string }) {
  return (
    <>
      <Nav repo={REPO} home="/" />
      <main>
        <article className="section tale-section">
          <header className="tale-head">
            <p className="eyebrow">Band service</p>
            <h1 className="h2">{page.title}</h1>
            <p className="fine">{byline}</p>
          </header>
          <div className="tale">
            {page.chapters.map((chapter, n) =>
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
          </div>
        </article>
      </main>
      <Closing />
      <Footer />
    </>
  )
}
