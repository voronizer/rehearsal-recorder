import { describe, expect, it } from "vitest"
import changelog from "../../../CHANGELOG.md?raw"
import { content, readContent } from "./index"
import { latestVersion, newsLead } from "./changelog"

// The words in site/content/, as the page will use them. An id spelt wrong
// there fails here, naming the file, rather than leaving a tile blank.
describe("the site's content", () => {
  it("has the seven tiles, in order", () => {
    expect(content.features.tiles.map((t) => t.id)).toEqual([
      "health",
      "track",
      "rehearsals",
      "marks",
      "cloud",
      "formats",
      "trash",
    ])
  })

  it("has the four steps, in order", () => {
    expect(content.story.steps.map((s) => s.id)).toEqual(["setup", "record", "review", "history"])
  })

  it("has the hero's words", () => {
    expect(content.hero.title).toBe("Multitrack recording for band rehearsals")
    expect(content.hero.eyebrow).toBe("Free for macOS and Windows")
    expect(content.hero.finePrint).toBe("Open source · Nothing else to install")
    expect(content.hero.caption).toContain("This is the app itself.")
    expect(content.hero.phoneCaption).toContain("Try it on a computer.")
  })

  it("has six questions, each with an answer", () => {
    expect(content.faq.questions).toHaveLength(6)
    for (const q of content.faq.questions) expect(q.body).not.toBe("")
  })

  it("takes its version and news from CHANGELOG.md", () => {
    const version = latestVersion(changelog)
    expect(content.version).toBe(version)
    expect(content.tag).toBe(version)
    expect(newsLead(changelog, version)).not.toBeNull()
    expect(content.news).toBe(newsLead(changelog, version))
  })

  it("shows a release tagged with a v without it, and links the tag as it is", () => {
    const tagged = readContent("v1.0.0")
    expect(tagged.version).toBe("1.0.0")
    expect(tagged.tag).toBe("v1.0.0")
  })

  it("has no news, and still builds, for a version CHANGELOG.md has no section for", () => {
    expect(readContent("99.0.0").news).toBeNull()
  })
})
