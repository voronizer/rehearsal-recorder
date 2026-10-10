import { content, TILES } from "../content"
import { Paragraphs } from "./Md"
import { shots, type PieceData } from "./pieces"
import { titleParts } from "./title"

type Id = (typeof TILES)[number]

/** How wide each tile is, of six columns, and how it is laid out. */
const LAYOUT: Record<Id, string> = {
  health: "tile s4",
  track: "tile s2",
  // A row of its own, its words beside the notes as the sets tile's are.
  midi: "tile s6",
  rehearsals: "tile s2",
  marks: "tile s4",
  names: "tile s4",
  cloud: "tile s2",
  // A row of its own, its words beside the panel as the health tile's are.
  sets: "tile s6",
  formats: "tile s2",
  // Wide, so the last row is as full as the others.
  trash: "tile s4 word",
}

/** The tiles with their words beside the piece, not over it. */
const SPLIT = new Set<Id>(["health", "midi", "sets"])

/** A tile's title, its short hyphenated words kept whole (see titleParts). */
function Title({ text }: { text: string }) {
  return titleParts(text).map((part, i) =>
    part.whole ? (
      <span key={i} className="whole">
        {part.text}
      </span>
    ) : (
      part.text
    )
  )
}

export function Features({ data }: { data: PieceData }) {
  const { features } = content
  const shot = shots(data)
  return (
    <section className="section" id="features">
      <div className="head">
        <h2 className="h2">{features.title}</h2>
        <p className="lede">{features.lede}</p>
      </div>
      <div className="bento">
        {features.tiles.map((tile) => {
          const id = tile.id as Id
          const s = shot[id]
          const copy = (
            <div className="copy">
              <h3>
                <Title text={tile.title} />
              </h3>
              <Paragraphs text={tile.body} />
            </div>
          )
          const pieces = s?.pieces && <div className={s.left ? "shot left" : "shot"}>{s.pieces}</div>
          return (
            <article key={id} className={LAYOUT[id]}>
              {SPLIT.has(id) ? (
                <div className="split">
                  {copy}
                  {pieces}
                </div>
              ) : (
                <>
                  {copy}
                  {pieces}
                </>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}
