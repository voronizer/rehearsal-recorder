import { content } from "../content"
import { leadAndBeats } from "../content/markdown"
import { Paragraphs } from "./Md"
import { CONTROLLER } from "./links"

/**
 * What the controller's 16 × 2 screen shows during a take, as its firmware
 * lays out the home screen (reha-controller, docs/menu-reference.md,
 * "home-rec"): the take and the song, then the state and the volume.
 */
const SCREEN = ["T03-Viasna", "REC        V:080"].map((row) => [...row.padEnd(16)])

/** Viktor Baikov's controller: its words beside its screen. */
export function Controller() {
  const { controller } = content
  const { lead, beats } = leadAndBeats(controller.body)
  return (
    <section className="remote" id="controller">
      <div className="copy">
        <h2>{controller.title}</h2>
        {lead.map((html, i) => (
          <p key={i} dangerouslySetInnerHTML={{ __html: html }} />
        ))}
        <ul>
          {beats.map((html, i) => (
            <li key={i} dangerouslySetInnerHTML={{ __html: html }} />
          ))}
        </ul>
        <div className="fine">
          <Paragraphs text={controller.finePrint} />
        </div>
        <p>
          <a className="more" href={CONTROLLER}>
            {controller.link}
          </a>
        </p>
      </div>
      <figure>
        {/* Each character in a cell of its own, as on the screen, the
            unlit ones faint. The caption says what is on it. */}
        <div className="lcd" aria-hidden="true">
          {SCREEN.map((row, r) => (
            <div key={r}>
              {row.map((c, i) => (
                <span key={i}>{c === " " ? " " : c}</span>
              ))}
            </div>
          ))}
        </div>
        <figcaption className="caption">{controller.screen}</figcaption>
      </figure>
    </section>
  )
}
