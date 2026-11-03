// Just enough Markdown for site/content/: a title, an intro, sections under
// `## ` headings with an optional `{#id}`, items under `### ` headings in a
// section, a `- ` list, and inline bold, emphasis, code and links. The
// page's words are short; a full Markdown library would be most of what the
// page downloads.
//
// A block can wait for a version: a heading that ends in `{from 0.22.0}`, or
// `{#id from 0.22.0}` where it has an id, is left out of a build for an
// older release. A feature's block is then merged with the feature, and
// reha.stream shows it from the day that release comes out, since the
// release puts the site up again. Only a story item or a question can wait:
// the page needs the rest.

/** A `##` section: its words before its first `###`, and its `###` items,
 *  each a section of its own (with no items). `from` is the version it
 *  waits for. */
export type Section = { title: string; id: string | null; from: string | null; body: string; items: Section[] }
/** A section or item a build left out, as it waits for a newer version. */
export type Waiting = { id: string | null; title: string; from: string }
export type Doc = { title: string | null; intro: string; sections: Section[]; waiting: Waiting[] }

const VERSION = /^\d+\.\d+\.\d+$/
const MARKS = "a heading ends in {#id}, {from 0.22.0} or {#id from 0.22.0}"

/** Whether version a comes after b, both as 0.22.0. */
export function isNewer(a: string, b: string): boolean {
  for (const v of [a, b]) if (!VERSION.test(v)) throw new Error(`${v} is not a version like 0.22.0`)
  const [x, y] = [a, b].map((v) => v.split(".").map(Number))
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}

/** The text without its <!-- comments -->, however they nest. */
function withoutComments(text: string): string {
  let before
  do {
    before = text
    text = text.replace(/<!--[\s\S]*?-->/g, "")
  } while (text !== before)
  return text
}

/**
 * A file as its title, intro and sections. With a release, the sections and
 * items that wait for a newer version are left out and listed in `waiting`;
 * without one, every block stays. With the file's name, an error names it.
 */
export function parseDoc(md: string, { release = null, file }: { release?: string | null; file?: string } = {}): Doc {
  const at = file ? `${where(file)}: ` : ""
  let title: string | null = null
  const intro: string[] = []
  type Open = { title: string; id: string | null; from: string | null; lines: string[]; items: Open[] }
  const sections: Open[] = []
  let lines = intro
  const text = withoutComments(md.replace(/\r\n/g, "\n"))
  for (const line of text.split("\n")) {
    const h1 = /^# (.+)$/.exec(line)
    const h = /^(##|###) (.+?)(?:\s*\{([^{}]*)\})?\s*$/.exec(line)
    const section = sections[sections.length - 1]
    // Braces left in a title are a mark the page would show as words, and
    // whose block would not wait.
    const braces = (title: string) => {
      if (/[{}]/.test(title))
        throw new Error(`${at}the heading "${line.trim()}" has braces in its title; ${MARKS}`)
    }
    if (h1 && title === null && sections.length === 0) {
      braces(h1[1])
      title = h1[1].trim()
    } else if (h && (h[1] === "##" || section)) {
      braces(h[2])
      const mark = h[3] === undefined ? null : /^(?:#([\w-]+))?(?:\s*\bfrom (\d+\.\d+\.\d+))?$/.exec(h[3].trim())
      if (h[3] !== undefined && (!mark || (!mark[1] && !mark[2])))
        throw new Error(
          `${at}the heading "${line.trim()}" ends in {${h[3]}}; ${MARKS}`
        )
      const open: Open = { title: h[2].trim(), id: mark?.[1] ?? null, from: mark?.[2] ?? null, lines: [], items: [] }
      if (h[1] === "##") sections.push(open)
      else section.items.push(open)
      lines = open.lines
    } else {
      lines.push(line)
    }
  }
  const tidy = (ls: string[]) => ls.join("\n").replace(/\n{3,}/g, "\n\n").trim()
  const waiting: Waiting[] = []
  const shown = (open: Open) => {
    if (release === null || open.from === null || !isNewer(open.from, release)) return true
    waiting.push({ id: open.id, title: open.title, from: open.from })
    return false
  }
  const close = ({ title, id, from, lines, items }: Open): Section => ({
    title,
    id,
    from,
    body: tidy(lines),
    items: items.filter(shown).map(close),
  })
  return { title, intro: tidy(intro), sections: sections.filter(shown).map(close), waiting }
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

/**
 * A story step's body: its paragraphs before the list, and each `- ` line of
 * the list, both as HTML. A list line may wrap onto the lines under it.
 */
export function leadAndBeats(body: string): { lead: string[]; beats: string[] } {
  const start = body.search(/^- /m)
  if (start < 0) return { lead: paragraphs(body), beats: [] }
  const beats = body
    .slice(start)
    .split(/^- /m)
    .map((b) => b.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean)
    .map(inline)
  return { lead: paragraphs(body.slice(0, start)), beats }
}

const where = (file: string) => `site/content/${file}`

/**
 * The sections of a file whose ids must be exactly `ids`, in that order: the
 * page puts a piece of the app beside each, by id, so a section misspelt or
 * moved fails the tests (index.test.ts), not a tile left blank.
 */
export function sectionsByIds(file: string, doc: Doc, ids: readonly string[]): Section[] {
  for (const id of ids) needed(file, doc, (w) => w.id === id, `{#${id}}`)
  return byIds(`${where(file)}:`, "section", doc.sections, ids)
}

/** A block the page needs cannot wait: say so, rather than that it is missing. */
function needed(file: string, doc: Doc, is: (w: Waiting) => boolean, name: string) {
  const w = doc.waiting.find(is)
  if (w)
    throw new Error(
      `${where(file)}: ${name} waits for ${w.from}, but the page needs it; only a story item or a question can wait`
    )
}

/** The same for a section's `###` items. */
export function itemsByIds(file: string, section: Section, ids: readonly string[]): Section[] {
  return byIds(`${where(file)}, {#${section.id}}:`, "item", section.items, ids)
}

function byIds(at: string, what: string, sections: Section[], ids: readonly string[]): Section[] {
  const found = sections.map((s) => s.id)
  for (const id of ids) if (!found.includes(id)) throw new Error(`${at} no ${what} {#${id}}`)
  for (const id of found)
    if (id === null || !ids.includes(id))
      throw new Error(`${at} ${what} {#${id}} is not one of ${ids.join(", ")}`)
  if (found.join() !== ids.join())
    throw new Error(`${at} ${what}s go ${found.join(", ")}; they should go ${ids.join(", ")}`)
  return sections
}

/** The bodies of the sections with these titles, by title. */
export function sectionsByTitles<T extends string>(
  file: string,
  doc: Doc,
  titles: T[]
): Record<T, string> {
  const out = {} as Record<T, string>
  for (const title of titles) {
    needed(file, doc, (w) => w.title === title, `## ${title}`)
    const section = doc.sections.find((s) => s.title === title)
    if (!section) throw new Error(`${where(file)}: no section ## ${title}`)
    out[title] = section.body
  }
  return out
}
