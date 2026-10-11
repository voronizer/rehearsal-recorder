// Everything the page says, read at build time: site/content/*.md for its
// words, and CHANGELOG.md for its version and news (only that version's
// section: see vite.config.ts). A file that does not have what the page
// needs fails `npm test`, naming the file, and so the site's CI.
import changelog from "virtual:changelog"
import { displayVersion, latestNews, latestVersion } from "./changelog"
import { parseDoc, sectionsByIds, sectionsByTitles, type Doc, type Section } from "./markdown"

export type { Section } from "./markdown"

export type SiteContent = {
  /** As people read it: 0.9.0. */
  version: string
  /** The release's tag, for its link: what VITE_SITE_VERSION says, or the version. */
  tag: string
  /** The bold lead of the version's first change, or, for a release with
   *  nothing new in the app, of the newest one before it that has; null
   *  when there is none. Its version and tag are the ones it is news of. */
  news: { version: string; tag: string; lead: string } | null
  hero: {
    title: string
    lede: string
    eyebrow: string
    finePrint: string
    caption: string
    phoneCaption: string
  }
  features: { title: string; lede: string; tiles: Section[] }
  story: { title: string; steps: Section[] }
  faq: { title: string; questions: Section[] }
  closing: { title: string }
  /** The 404 page's heading and line. */
  notFound: { title: string; lede: string }
}

export const TILES = [
  "health",
  "track",
  "midi",
  "rehearsals",
  "marks",
  "names",
  "cloud",
  "sets",
  "formats",
  "trash",
] as const
export const STEPS = ["setup", "record", "keep", "history", "compare"] as const

const files = import.meta.glob<string>("../../content/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
})

function doc(name: string): Doc {
  const text = files[`../../content/${name}`]
  if (text === undefined) throw new Error(`site/content/${name} is missing`)
  const parsed = parseDoc(text)
  if (!parsed.title) throw new Error(`site/content/${name}: no # title`)
  return parsed
}

/** The content for a release with this tag, or, without one, for the newest
 *  version in CHANGELOG.md (a pull request's build, or a local one). */
export function readContent(tagFromRelease?: string): SiteContent {
  const tag = tagFromRelease || latestVersion(changelog)
  const version = displayVersion(tag)
  // Tags are bare (0.11.0), so an older version's tag is its version.
  const latest = latestNews(changelog)
  const news = latest && { ...latest, tag: latest.version === version ? tag : latest.version }

  const hero = doc("hero.md")
  const heroParts = sectionsByTitles("hero.md", hero, [
    "eyebrow",
    "fine print",
    "caption",
    "caption on a phone",
  ])
  const features = doc("features.md")
  const story = doc("story.md")
  const faq = doc("faq.md")
  const notFound = doc("notfound.md")

  return {
    version,
    tag,
    news,
    hero: {
      title: hero.title!,
      lede: hero.intro,
      eyebrow: heroParts.eyebrow,
      finePrint: heroParts["fine print"],
      caption: heroParts.caption,
      phoneCaption: heroParts["caption on a phone"],
    },
    features: {
      title: features.title!,
      lede: features.intro,
      tiles: sectionsByIds("features.md", features, [...TILES]),
    },
    story: { title: story.title!, steps: sectionsByIds("story.md", story, [...STEPS]) },
    faq: { title: faq.title!, questions: faq.sections },
    closing: { title: doc("closing.md").title! },
    notFound: { title: notFound.title!, lede: notFound.intro },
  }
}

export const content: SiteContent = readContent(import.meta.env.VITE_SITE_VERSION)
