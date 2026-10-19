import { content } from "../content"
import { leadAndBeats } from "../content/markdown"
import photo from "./controller.webp"
import { Paragraphs } from "./Md"
import { CONTROLLER } from "./links"

/** Viktor Baikov's controller: its words beside its photo. */
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
      {/* 1000 px wide: sharp at twice the size it is shown. */}
      <img src={photo} width={1000} height={734} alt={controller.photo} />
    </section>
  )
}
