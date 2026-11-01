import type { BandServiceDoc, ServiceBlock } from "../content/bandService"
import { Closing } from "../page/Closing"
import { Footer } from "../page/Footer"
import { Inline } from "../page/Md"
import { Nav } from "../page/Nav"
import { REPO } from "../page/links"
import { picture } from "./service"

/**
 * reha.stream/band-service, the page a band member is sent: what the
 * service does for them, a numbered chapter for each thing with a picture
 * of the service on a phone or a computer, then how to start, and a link to the setup
 * steps on GitHub (service/README.md). Laid out as a story is, each
 * chapter with its name beside it, and written whole at build time
 * (render.tsx). No downloads at the end: the page is for a band that has
 * РЭХА already, and the closing block has them.
 */
export function BandServicePage({ page }: { page: BandServiceDoc }) {
  const last = page.chapters.length - 1
  return (
    <>
      <Nav repo={REPO} home="/" />
      <main>
        <article className="section tale-section">
          <header className="tale-head">
            <p className="eyebrow">Band service</p>
            <h1 className="h2">{page.title}</h1>
          </header>
          <div className="tale">
            <div className="chap lead">
              <div className="chap-body">
                {page.lead.map((text, i) => (
                  <p key={i}>
                    <Inline text={text} />
                  </p>
                ))}
              </div>
            </div>
            {page.chapters.map((chapter, i) => (
              <section key={chapter.id} id={chapter.id} className="chap">
                <div className="chap-head">
                  {i < last && <span className="n">{i + 1}</span>}
                  <h2>{chapter.title}</h2>
                </div>
                <div className="chap-body">
                  {chapter.blocks.map((block, k) => (
                    <Block key={k} block={block} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </article>
      </main>
      <Closing />
      <Footer />
    </>
  )
}

function Block({ block }: { block: ServiceBlock }) {
  if (block.kind === "text")
    return (
      <p>
        <Inline text={block.text} />
      </p>
    )
  if (block.kind === "steps")
    return (
      <ol className="chap-steps">
        {block.steps.map((step, i) => (
          <li key={i}>
            <Inline text={step} />
          </li>
        ))}
      </ol>
    )
  // The service on a phone or a computer, in the visitor's theme. Its size
  // is set, so the words under it do not jump when it comes in. The caption
  // says what to look at; a screen reader reads it once, as its name.
  const shot = picture(block.name)
  return (
    <figure className={`${shot.on}-shot`}>
      <picture>
        <source media="(prefers-color-scheme: dark)" srcSet={shot.dark} />
        <img src={shot.light} alt={block.caption} width={shot.width} height={shot.height} loading="lazy" decoding="async" />
      </picture>
      <figcaption aria-hidden="true">{block.caption}</figcaption>
    </figure>
  )
}
