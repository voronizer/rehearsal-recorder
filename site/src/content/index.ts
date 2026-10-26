// Everything the page says, read at build time: site/content/*.md for its
// words, and CHANGELOG.md for its version and news (only that version's
// section: see vite.config.ts). A file that does not have what the page
// needs fails `npm test`, naming the file, and so the site's CI.
import changelog from "virtual:changelog"
import { displayVersion, latestNews, latestVersion } from "./changelog"
import { itemsByIds, parseDoc, sectionsByIds, sectionsByTitles, type Doc, type Section } from "./markdown"

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
  /** Victor Baikov's controller: its words, a `- ` list of four, its fine
   *  print, its link's words and what its photo shows. */
  controller: { title: string; body: string; finePrint: string; link: string; photo: string }
  /** The four steps of an evening, each with its items (story.md). */
  story: { title: string; steps: StoryStep[] }
  faq: { title: string; questions: Section[] }
  closing: { title: string }
  /** The 404 page's heading and line. */
  notFound: { title: string; lede: string }
}

export const STEPS = ["before", "during", "after", "later"] as const
export type Step = (typeof STEPS)[number]

/** Each step's items, in order: its tiles, then its cards. */
export const ITEMS = {
  before: ["set", "tempo", "backing", "lineups", "left-off", "tap", "counted", "first-take", "inputs"],
  during: ["tracks", "midi", "count-in", "edge", "last-time", "clip", "awake", "unplugged", "disk"],
  after: ["marks", "drift", "undo", "same-bar", "false-starts"],
  later: ["song-page", "cloud", "mark-lead", "numbers", "cloud-follows", "phone-mix", "bars", "wav-tempo"],
} as const satisfies Record<Step, readonly string[]>
export type ItemId = (typeof ITEMS)[Step][number]

/** An item of a step: its tile's or card's line, and what the window says
 *  under the app once the item is picked. */
export type Item = { id: ItemId; title: string; line: string; more: string }
export type StoryStep = { id: Step; title: string; body: string; items: Item[] }

// Alex's stories are read on their own: see src/stories/content.ts.
const files = import.meta.glob<string>(["../../content/*.md", "!../../content/stories.md"], {
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
  const controller = doc("controller.md")
  const controllerParts = sectionsByTitles("controller.md", controller, ["fine print", "link", "photo"])
  const story = doc("story.md")
  const steps = sectionsByIds("story.md", story, STEPS).map((step) => ({
    id: step.id as Step,
    title: step.title,
    body: step.body,
    items: itemsByIds("story.md", step, ITEMS[step.id as Step]).map(item),
  }))
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
    controller: {
      title: controller.title!,
      body: controller.intro,
      finePrint: controllerParts["fine print"],
      link: controllerParts.link,
      photo: controllerParts.photo,
    },
    story: { title: story.title!, steps },
    faq: { title: faq.title!, questions: faq.sections },
    closing: { title: doc("closing.md").title! },
    notFound: { title: notFound.title!, lede: notFound.intro },
  }
}

/** A story item's two paragraphs, as story.md has them. */
function item(section: Section): Item {
  const [line, more, ...rest] = section.body.split(/\n\s*\n/).filter((p) => p.trim())
  if (!line || !more || rest.length)
    throw new Error(
      `site/content/story.md, {#${section.id}}: an item has two paragraphs, its line and what the window says`
    )
  return { id: section.id as ItemId, title: section.title, line, more }
}

export const content: SiteContent = readContent(import.meta.env.VITE_SITE_VERSION)
