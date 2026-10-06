import { content } from "../content"
import { Paragraphs } from "./Md"

export function Faq() {
  const { faq } = content
  return (
    <section className="section" id="faq">
      <div className="head">
        <h2 className="h2">{faq.title}</h2>
      </div>
      <div className="qa">
        {faq.questions.map((q) => (
          <details key={q.title}>
            <summary>{q.title}</summary>
            <Paragraphs text={q.body} />
          </details>
        ))}
      </div>
    </section>
  )
}
