// The files in site/content/ the main page reads (index.ts), the only ones
// where a block can wait for a version (markdown.ts). Its own file, with no
// imports, so that scripts/waiting.mjs can read it too.
export const PAGE_FILES = [
  "hero.md",
  "controller.md",
  "story.md",
  "faq.md",
  "download.md",
  "closing.md",
  "notfound.md",
] as const

export type PageFile = (typeof PAGE_FILES)[number]
