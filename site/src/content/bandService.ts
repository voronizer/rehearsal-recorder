// reha.stream/band-service: site/content/band-service.md, the page a band
// member is sent. Its opening, then a chapter for each thing the service
// does for them, each with a picture of the service showing it, then the
// last chapter, how to start, with its steps. What the page cannot draw
// fails the tests, naming the line.
import { chapterId } from "./stories.ts"

/** A paragraph and a step are inline Markdown. A picture is named by its
 *  files in site/src/stories/band-service/, <name>-light.webp and
 *  <name>-dark.webp, and its caption says what to look at. */
export type ServiceBlock =
  | { kind: "text"; text: string }
  | { kind: "picture"; name: string; caption: string }
  | { kind: "steps"; steps: string[] }
export type ServiceChapter = { id: string; title: string; blocks: ServiceBlock[] }
export type BandServiceDoc = {
  title: string
  /** The line for search results and link cards. */
  description: string
  lead: string[]
  /** Numbered on the page, all but the last, which is how to start. */
  chapters: ServiceChapter[]
}

const FILE = "site/content/band-service.md"
const PICTURE = /^!\[([^\]]+)\]\(([a-z0-9-]+)\)$/
const STEP = /^\d+\. (.+)$/

export function parseBandService(md: string): BandServiceDoc {
  const fail = (line: number, what: string): never => {
    throw new Error(`${FILE}:${line}: ${what}`)
  }
  // A comment's lines stay, blank, so every line keeps its number.
  const lines = md
    .replace(/^﻿/, "")
    .replace(/\r\n/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ""))
    .split("\n")
    .map((l) => l.trimEnd())
  let at = 0
  while (at < lines.length && lines[at] === "") at++
  const head = /^---\ndescription:\s*(.+)\n---$/.exec(lines.slice(at, at + 3).join("\n"))
  if (!head) fail(at + 1, "the file starts with --- then description: then ---")
  const description = head![1]
  at += 3
  while (at < lines.length && lines[at] === "") at++
  const h1 = /^# (.+)$/.exec(lines[at] ?? "")
  if (!h1) fail(at + 1, "no # title after the --- block")
  const title = h1![1].trim()

  const lead: string[] = []
  const chapters: (ServiceChapter & { line: number })[] = []
  let paragraph: string[] = []
  let steps: string[] | null = null
  const into = (block: ServiceBlock) => (chapters.length ? chapters[chapters.length - 1].blocks.push(block) : null)
  const close = () => {
    if (paragraph.length) {
      const text = paragraph.join(" ")
      if (chapters.length) into({ kind: "text", text })
      else lead.push(text)
      paragraph = []
    }
    if (steps) {
      into({ kind: "steps", steps })
      steps = null
    }
  }

  for (at++; at < lines.length; at++) {
    const line = lines[at]
    const n = at + 1
    const picture = PICTURE.exec(line)
    const step = STEP.exec(line)
    if (line === "") {
      close()
    } else if (/^# /.test(line)) {
      fail(n, "one # title only")
    } else if (/^#{3,} /.test(line)) {
      fail(n, "the page has # for its title and ## for chapters, nothing deeper")
    } else if (/^## /.test(line)) {
      close()
      const name = line.slice(3).trim()
      chapters.push({ id: chapterId(name), title: name, blocks: [], line: n })
    } else if (picture) {
      close()
      if (!chapters.length) fail(n, "a picture goes in a chapter")
      into({ kind: "picture", name: picture[2], caption: picture[1] })
    } else if (step) {
      if (paragraph.length) close()
      if (!chapters.length) fail(n, "steps go in a chapter")
      steps = [...(steps ?? []), step[1]]
    } else if (/^([-*] |!\[)/.test(line)) {
      fail(n, "a list here is numbered steps, 1. 2. 3., and a picture goes ![what to look at](its-name)")
    } else if (steps) {
      // A step that wraps onto the next line.
      steps[steps.length - 1] += ` ${line.trim()}`
    } else {
      paragraph.push(line.trim())
    }
  }
  close()

  if (!lead.length) fail(chapters[0]?.line ?? at, "no opening before the first ## chapter")
  if (chapters.length < 2) fail(at, "a chapter for each thing the service does, then the last one, how to start")
  chapters.forEach((c, i) => {
    const count = (kind: ServiceBlock["kind"]) => c.blocks.filter((b) => b.kind === kind).length
    if (!count("text")) fail(c.line, `chapter “${c.title}” has no words`)
    if (i < chapters.length - 1) {
      if (count("picture") !== 1) fail(c.line, `chapter “${c.title}” needs one picture`)
      if (count("steps")) fail(c.line, `only the last chapter, how to start, has steps`)
    } else if (count("steps") !== 1) {
      fail(c.line, `the last chapter, “${c.title}”, has its steps, 1. 2. 3., in one list`)
    }
    if (chapters.findIndex((o) => o.id === c.id) !== i) fail(c.line, `two chapters are #${c.id}`)
  })

  return { title, description, lead, chapters: chapters.map(({ id, title, blocks }) => ({ id, title, blocks })) }
}
