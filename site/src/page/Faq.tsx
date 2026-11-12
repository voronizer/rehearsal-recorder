import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { content } from "../content"
import { Paragraphs } from "./Md"

/** The questions. Every answer stays in the page while its question is
 *  closed (forceMount, hidden by page.css), for the readers that run no
 *  script and the ones that search the page. page.css draws it. */
export function Faq() {
  const { faq } = content
  return (
    <section className="section" id="faq">
      <div className="head">
        <h2 className="h2">{faq.title}</h2>
      </div>
      <Accordion type="multiple" className="qa">
        {faq.questions.map((q) => (
          <AccordionItem key={q.title} value={q.title}>
            <AccordionTrigger>{q.title}</AccordionTrigger>
            <AccordionContent forceMount>
              <Paragraphs text={q.body} />
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  )
}
