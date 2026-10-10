import { describe, expect, it } from "vitest"
import changelog from "../../../CHANGELOG.md?raw"
import { content, readContent } from "./index"
import { leadAndBeats } from "./markdown"
import { displayVersion, latestVersion, newsLead } from "./changelog"

// The words in site/content/, as the page will use them. An id spelt wrong
// there fails here, naming the file, rather than leaving a tile blank.
describe("the site's content", () => {
  it("has the ten tiles, in order, the MIDI one right after the one on tracks", () => {
    expect(content.features.tiles.map((t) => t.id)).toEqual([
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
    ])
  })

  it("has the MIDI tile's words", () => {
    const midi = content.features.tiles.find((t) => t.id === "midi")!
    expect(midi.title).toBe("Notes too, from an e-kit or a keyboard.")
    expect(midi.body.replace(/\s+/g, " ").trim()).toBe(
      "A track records its audio, its MIDI or both. The notes are saved as .mid beside " +
        "the audio, ready for your DAW."
    )
  })

  it("has the sets tile's words", () => {
    const sets = content.features.tiles.find((t) => t.id === "sets")!
    expect(sets.title).toBe("Rehearse the set, in order.")
    expect(sets.body.replace(/\s+/g, " ").trim()).toBe(
      "Make the gig's songs a set once. Every take is the song you are on until you move " +
        "on, and History says which ones you never got to."
    )
  })

  it("has the five steps, in order", () => {
    expect(content.story.steps.map((s) => s.id)).toEqual([
      "setup",
      "record",
      "keep",
      "history",
      "compare",
    ])
  })

  it("tells the second step as the app goes through it", () => {
    const record = content.story.steps.find((s) => s.id === "record")!
    expect(record.title).toBe("Hear last week, then record.")
    expect(leadAndBeats(record.body).beats).toEqual([
      "▶ beside Pałyn on the start screen plays its best go from last week.",
      "Start, and ↑ picks Pałyn under Next take.",
      "Record: the take's name over a big clock, and a tile per track that turns red when it clips.",
    ])
  })

  it("every step has one line and three lines under it", () => {
    for (const step of content.story.steps) {
      const { lead, beats } = leadAndBeats(step.body)
      expect(lead, step.id!).toHaveLength(1)
      expect(beats, step.id!).toHaveLength(3)
    }
  })

  it("has the hero's words", () => {
    expect(content.hero.title).toBe("Multitrack recording for band rehearsals")
    expect(content.hero.eyebrow).toBe("Free for macOS and Windows")
    expect(content.hero.finePrint).toBe("Open source · Nothing else to install")
    expect(content.hero.caption).toContain("This is the app itself.")
    expect(content.hero.phoneCaption).toContain("Try it on a computer.")
  })

  it("has the 404 page's words", () => {
    expect(content.notFound.title).toBe("Nothing was recorded here")
    expect(content.notFound.lede).toBe(
      "There is no page at this address. The link may be cut short or out of date."
    )
  })

  it("has eight questions, each with an answer, the name's first", () => {
    expect(content.faq.questions).toHaveLength(8)
    expect(content.faq.questions[0].body).toContain("Belarusian for “echo”")
    // Sleep follows the laptop dying, the question it answers next.
    expect(content.faq.questions[5].title).toBe("What if the laptop dies in the middle of a take?")
    expect(content.faq.questions[6].title).toBe(
      "Will the laptop fall asleep in the middle of a take?"
    )
    for (const q of content.faq.questions) expect(q.body).not.toBe("")
  })

  it("takes its version and news from CHANGELOG.md", () => {
    const tag = import.meta.env.VITE_SITE_VERSION || latestVersion(changelog)
    expect(content.tag).toBe(tag)
    expect(content.version).toBe(displayVersion(tag))
    expect(content.news).toBe(newsLead(changelog, content.version))
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
