// Just enough Markdown for site/content/: a title, an intro, sections under
// `## ` headings with an optional `{#id}`, and inline bold, emphasis, code
// and links. The page's words are short; a full Markdown library would be
// most of what the page downloads.

export type Section = { title: string; id: string | null; body: string }
export type Doc = { title: string | null; intro: string; sections: Section[] }

/** The text without its <!-- comments -->, however they nest. */
function withoutComments(text: string): string {
  let before
  do {
    before = text
    text = text.replace(/<!--[\s\S]*?-->/g, "")
  } while (text !== before)
  return text
}

export function parseDoc(md: string): Doc {
  let title: string | null = null
  const intro: string[] = []
  const heads: Omit<Section, "body">[] = []
  const bodies: string[][] = []
  let lines = intro
  const text = withoutComments(md.replace(/\r\n/g, "\n"))
  for (const line of text.split("\n")) {
    const h1 = /^# (.+)$/.exec(line)
    const h2 = /^## (.+?)(?:\s+\{#([\w-]+)\})?\s*$/.exec(line)
    if (h1 && title === null && heads.length === 0) {
      title = h1[1].trim()
    } else if (h2) {
      heads.push({ title: h2[1].trim(), id: h2[2] ?? null })
      bodies.push((lines = []))
    } else {
      lines.push(line)
    }
  }
  const tidy = (ls: string[]) => ls.join("\n").replace(/\n{3,}/g, "\n\n").trim()
  return {
    title,
    intro: tidy(intro),
    sections: heads.map((h, i) => ({ ...h, body: tidy(bodies[i]) })),
  }
}

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** Where a link may go: a web page, mail, or a place on the site. */
const LINKABLE = /^(https?:|mailto:|#|\/)/i

/** One paragraph of Markdown as HTML: **bold**, *em*, `code`, [text](url). */
export function inline(md: string): string {
  const out: string[] = []
  const pattern = /`([^`]+)`|\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]+)\]\(([^)\s]+)\)/g
  let at = 0
  for (const m of md.matchAll(pattern)) {
    out.push(escape(md.slice(at, m.index)))
    if (m[1] !== undefined) out.push(`<code>${escape(m[1])}</code>`)
    else if (m[2] !== undefined) out.push(`<strong>${inline(m[2])}</strong>`)
    else if (m[3] !== undefined) out.push(`<em>${inline(m[3])}</em>`)
    else if (LINKABLE.test(m[5])) out.push(`<a href="${escape(m[5])}" rel="noopener">${inline(m[4])}</a>`)
    else out.push(inline(m[4]))
    at = m.index + m[0].length
  }
  out.push(escape(md.slice(at)))
  return out.join("")
}

/** A section's paragraphs, each as HTML. */
export function paragraphs(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean)
    .map(inline)
}

const where = (file: string) => `site/content/${file}`

/**
 * The sections of a file whose ids must be exactly `ids`, in that order: the
 * page puts a piece of the app beside each, by id, so a section misspelt or
 * moved fails the tests (index.test.ts), not a tile left blank.
 */
export function sectionsByIds(file: string, doc: Doc, ids: string[]): Section[] {
  const found = doc.sections.map((s) => s.id)
  for (const id of ids)
    if (!found.includes(id)) throw new Error(`${where(file)}: no section {#${id}}`)
  for (const id of found)
    if (id === null || !ids.includes(id))
      throw new Error(`${where(file)}: section {#${id}} is not one of ${ids.join(", ")}`)
  if (found.join() !== ids.join())
    throw new Error(`${where(file)}: sections go ${found.join(", ")}; they should go ${ids.join(", ")}`)
  return doc.sections
}

/** The bodies of the sections with these titles, by title. */
export function sectionsByTitles<T extends string>(
  file: string,
  doc: Doc,
  titles: T[]
): Record<T, string> {
  const out = {} as Record<T, string>
  for (const title of titles) {
    const section = doc.sections.find((s) => s.title === title)
    if (!section) throw new Error(`${where(file)}: no section ## ${title}`)
    out[title] = section.body
  }
  return out
}
