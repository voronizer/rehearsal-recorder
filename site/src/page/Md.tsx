import { inline, paragraphs } from "../content/markdown"

// The page's words are Markdown from site/content/, written in this repo
// and turned to HTML at build time, escaped but for the few marks inline()
// knows.

/** One line of it, inside whatever holds it. */
export function Inline({ text }: { text: string }) {
  return <span dangerouslySetInnerHTML={{ __html: inline(text) }} />
}

/** A section's body, a paragraph each. */
export function Paragraphs({ text }: { text: string }) {
  return (
    <>
      {paragraphs(text).map((html, i) => (
        <p key={i} dangerouslySetInnerHTML={{ __html: html }} />
      ))}
    </>
  )
}
