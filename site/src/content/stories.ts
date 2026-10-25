// The stories: site/content/stories/*.md, one a file, told by Alex, and
// site/content/stories.md, the words of their page and of the block on the
// main page. A story is plainer Markdown than the rest of the site's words,
// and stricter: what the page cannot draw fails the tests, naming the file
// and its line.
import { parseDoc, sectionsByTitles } from "./markdown.ts"

/** Who talks in a story's chats. "Me" is Alex, who tells it. */
export const WHO = ["Singer", "Guitarist", "Drummer", "Me"] as const
export type Who = (typeof WHO)[number]

/** A line of a chat, its words inline Markdown. */
export type ChatLine = { who: Who; text: string }
/** A paragraph, a joke said big (without its **), or the band arguing. */
export type StoryBlock =
  | { kind: "text"; text: string }
  | { kind: "joke"; text: string }
  | { kind: "chat"; lines: ChatLine[] }
/** The opening comes first, with no id and no title. */
export type Chapter = { id: string | null; title: string | null; blocks: StoryBlock[] }
export type StoryDoc = {
  /** Its address, /stories/<slug>: the file's name. */
  slug: string
  title: string
  /** The day it was written, 2026-10-25. */
  date: string
  /** The line for search results, link cards and its card. */
  description: string
  chapters: Chapter[]
  /** The /stories/… it links to, in order. */
  links: string[]
}

export type StoriesContent = {
  /** The page of stories: its heading, its line, and its line for search. */
  title: string
  lede: string
  description: string
  /** Under each story's title. */
  byline: string
  /** In the order stories.md lists them. */
  list: StoryDoc[]
  /** The block on the main page: the story whose chats it shows, and its words. */
  block: { story: StoryDoc; heading: string; line: string; link: string }
}

/** What the block on the main page shows: its words, the story it leads to,
 *  and that story's first two chats. The main page gets only this
 *  (virtual:stories-block in vite.config.ts), not the stories' whole text. */
export type StoriesBlockContent = { slug: string; heading: string; line: string; link: string; chats: ChatLine[][] }

export function blockOf(stories: StoriesContent): StoriesBlockContent {
  const { story, heading, line, link } = stories.block
  const chats = story.chapters[0].blocks.flatMap((b) => (b.kind === "chat" ? [b.lines] : [])).slice(0, 2)
  return { slug: story.slug, heading, line, link, chats }
}

/** A chapter's address in its story: “The gain” is #the-gain. */
export const chapterId = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

const KEYS = ["date", "description"] as const
const LINK = /\]\((\/stories\/[^)\s]*)\)/g
const CHAT = /^>\s*\*\*([^*:]+):\*\*\s+(.+?)\s*\\?$/

export function parseStory(file: string, md: string): StoryDoc {
  const fail = (line: number, what: string): never => {
    throw new Error(`site/content/stories/${file}:${line}: ${what}`)
  }
  // A comment's lines stay, blank, so every line keeps its number.
  const text = md
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ""))
  const lines = text.split("\n").map((l) => l.trimEnd())
  let at = 0
  const skipBlank = () => {
    while (at < lines.length && lines[at] === "") at++
  }

  skipBlank()
  const start = at + 1
  if (lines[at] !== "---") fail(start, "the file starts with --- and date: and description: lines")
  const meta: Record<string, string> = {}
  for (at++; at < lines.length && lines[at] !== "---"; at++) {
    const m = /^(\w+):\s*(.*)$/.exec(lines[at])
    if (!m) fail(at + 1, "the file starts with --- and date: and description: lines")
    const [, key, value] = m!
    if (!(KEYS as readonly string[]).includes(key)) fail(at + 1, `${key} is not date or description`)
    if (!value) fail(at + 1, `no ${key}: at the top`)
    if (key === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(at + 1, "date goes 2026-10-25")
    meta[key] = value
  }
  if (at >= lines.length) fail(start, "the file starts with --- and date: and description: lines")
  for (const key of KEYS) if (!meta[key]) fail(start, `no ${key}: at the top`)
  at++

  skipBlank()
  const h1 = /^# (.+)$/.exec(lines[at] ?? "")
  if (!h1) fail(at + 1, "no # title after the --- block")
  const title = h1![1].trim()
  at++

  const chapters: (Chapter & { line: number })[] = [{ id: null, title: null, blocks: [], line: 0 }]
  const links: string[] = []
  let paragraph: string[] = []
  let chat: ChatLine[] | null = null
  const blocks = () => chapters[chapters.length - 1].blocks
  const close = () => {
    if (paragraph.length) {
      const words = paragraph.join(" ")
      const joke = /^\*\*(.+)\*\*$/.exec(words)
      blocks().push(joke && !joke[1].includes("**") ? { kind: "joke", text: joke[1] } : { kind: "text", text: words })
      for (const m of words.matchAll(LINK)) links.push(m[1])
      paragraph = []
    }
    if (chat) {
      blocks().push({ kind: "chat", lines: chat })
      chat = null
    }
  }

  for (; at < lines.length; at++) {
    const line = lines[at]
    const n = at + 1
    if (line === "") {
      close()
    } else if (/^# /.test(line)) {
      fail(n, "one # title only")
    } else if (/^#{3,} /.test(line)) {
      fail(n, "a story has # for its title and ## for chapters, nothing deeper")
    } else if (/^## /.test(line)) {
      close()
      const name = line.slice(3).trim()
      const id = chapterId(name)
      if (chapters.some((c) => c.id === id)) fail(n, `two chapters are #${id}`)
      chapters.push({ id, title: name, blocks: [], line: n })
    } else if (/^([-*]|\d+\.) /.test(line)) {
      fail(n, "no lists in a story: write it as sentences")
    } else if (line.startsWith(">")) {
      if (paragraph.length) close()
      const m = CHAT.exec(line)
      if (!m) fail(n, "a chat line goes > **Name:** what they say")
      const [, who, said] = m!
      if (!(WHO as readonly string[]).includes(who)) fail(n, `**${who}** is not one of ${WHO.join(", ")}`)
      for (const l of said.matchAll(LINK)) links.push(l[1])
      chat = [...(chat ?? []), { who: who as Who, text: said }]
    } else {
      if (chat) close()
      paragraph.push(line.trim())
    }
  }
  close()
  for (const c of chapters.slice(1)) if (!c.blocks.length) fail(c.line, `chapter “${c.title}” is empty`)

  return {
    slug: file.replace(/\.md$/, ""),
    title,
    date: meta.date,
    description: meta.description,
    chapters: chapters.map(({ id, title, blocks }) => ({ id, title, blocks })),
    links,
  }
}

const INDEX = "site/content/stories.md"

/** The stories by their files' names, and stories.md, as the pages use them. */
export function readStories(files: Record<string, string>, index: string): StoriesContent {
  const doc = parseDoc(index)
  if (!doc.title) throw new Error(`${INDEX}: no # title`)
  const parts = sectionsByTitles("stories.md", doc, [
    "description",
    "byline",
    "order",
    "block story",
    "block heading",
    "block line",
    "block link",
  ])
  const order = parts.order
    .split("\n")
    .map((l) => l.replace(/^- /, "").trim())
    .filter(Boolean)
  for (const name of order) if (!(`${name}.md` in files)) throw new Error(`${INDEX}: no stories/${name}.md`)
  for (const file of Object.keys(files))
    if (!order.includes(file.replace(/\.md$/, ""))) throw new Error(`${INDEX}: stories/${file} is not under ## order`)
  const list = order.map((name) => parseStory(`${name}.md`, files[`${name}.md`]))

  for (const story of list)
    for (const href of story.links) {
      const [, slug, id] = /^\/stories\/([^#]*)(?:#(.*))?$/.exec(href)!
      const to = list.find((s) => s.slug === slug)
      if (!to || (id !== undefined && !to.chapters.some((c) => c.id === id)))
        throw new Error(`site/content/stories/${story.slug}.md: a link to ${href} goes nowhere`)
    }

  const name = parts["block story"].trim()
  const story = list.find((s) => s.slug === name)
  if (!story) throw new Error(`${INDEX}: the block's story, ${name}, is not under ## order`)
  if (story.chapters[0].blocks.filter((b) => b.kind === "chat").length < 2)
    throw new Error(`${INDEX}: the block's story, ${name}, has fewer than two chats in its opening`)

  const one = (s: string) => s.replace(/\s*\n\s*/g, " ").trim()
  return {
    title: doc.title,
    lede: one(doc.intro),
    description: one(parts.description),
    byline: one(parts.byline),
    list,
    block: {
      story,
      heading: one(parts["block heading"]),
      line: one(parts["block line"]),
      link: one(parts["block link"]),
    },
  }
}
