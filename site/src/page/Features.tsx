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
  // A row of its own after the sets tile, whose songs bring their tempos
  // with them, its words beside the metronome's row: the row is one line,
  // too long to share a row of tiles and stay whole.
  metronome: "tile s6",
  // A row of its own on a desk; on two columns, beside the cloud tile, so
  // neither is left with a hole beside it.
  trash: "tile s6d word",
}

/** The tiles with their words beside the piece, not over it. */
const SPLIT = new Set<Id>(["health", "midi", "sets", "metronome"])

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
        {features.lede && <p className="lede">{features.lede}</p>}
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
          const under = s?.under && <div className="shot under">{s.under}</div>
          return (
            <article key={id} className={LAYOUT[id]}>
              {SPLIT.has(id) ? (
                <>
                  <div className="split">
                    {copy}
                    {pieces}
                  </div>
                  {under}
                </>
              ) : (
                <>
                  {copy}
                  {pieces}
                  {under}
                </>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}
