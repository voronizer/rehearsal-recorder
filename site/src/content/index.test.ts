import { describe, expect, it } from "vitest"
import changelog from "../../../CHANGELOG.md?raw"
import { content, readContent } from "./index"
import { leadAndBeats } from "./markdown"
import { changelogHead, displayVersion, latestNews, latestVersion } from "./changelog"

// What the build reads: the release's part of CHANGELOG.md (vite.config.ts).
const head = changelogHead(changelog, import.meta.env.VITE_SITE_VERSION || undefined)

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
      "metronome",
      "trash",
    ])
  })

  it("has the MIDI tile's words", () => {
    const midi = content.features.tiles.find((t) => t.id === "midi")!
    expect(midi.title).toBe("Notes too, from an e-kit or a keyboard.")
    expect(midi.body.replace(/\s+/g, " ").trim()).toBe(
      "A track records its audio, its MIDI or both. The notes are saved as a .mid file " +
        "beside the audio."
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

  it("has the controller's words: three lines, its fine print, its link and its photo's", () => {
    const { controller } = content
    expect(controller.title).toBe("Start a take without going to the laptop.")
    expect(leadAndBeats(controller.body).beats).toEqual([
      "REC starts a take, and pressed again keeps it.",
      "PLAY plays the take back, and the knob sets how loud.",
      "Hold SONG or TAKE and turn the knob to pick another one.",
    ])
    expect(controller.finePrint).toContain("Settings › Controls")
    expect(controller.link).toBe("Victor Baikov's controller on GitHub")
    expect(controller.photo).toMatch(/^Victor Baikov's controller: a red REC button/)
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

  it("tells the second step as the app goes through it, the click and the count-in with it", () => {
    const record = content.story.steps.find((s) => s.id === "record")!
    expect(record.title).toBe("Hear last week, then record.")
    expect(leadAndBeats(record.body).beats).toEqual([
      "▶ beside Pałyn on the start screen plays its ★ take from last week.",
      "Start, and ↑ picks Pałyn under Next take, and its 128 bpm for the click.",
      "Record: a bar of clicks to count in, then the take's name over a big clock, and a tile per track that turns red when it clips.",
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

  it("has ten questions, each with an answer, the name's first", () => {
    expect(content.faq.questions).toHaveLength(10)
    expect(content.faq.questions[0].body).toContain("Belarusian for “echo”")
    // Sleep follows the laptop dying, the question it answers next.
    expect(content.faq.questions[7].title).toBe("What if the laptop dies in the middle of a take?")
    expect(content.faq.questions[8].title).toBe(
      "Will the laptop fall asleep in the middle of a take?"
    )
    for (const q of content.faq.questions) expect(q.body).not.toBe("")
  })

  it("takes its version and news from CHANGELOG.md", () => {
    const tag = import.meta.env.VITE_SITE_VERSION || latestVersion(changelog)
    expect(content.tag).toBe(tag)
    expect(content.version).toBe(displayVersion(tag))
    const latest = latestNews(head)
    expect(content.news?.lead ?? null).toBe(latest?.lead ?? null)
    expect(content.news?.version).toBe(latest?.version)
  })

  it("links the news to the release it is news of", () => {
    const news = content.news!
    expect(news.tag).toBe(news.version === content.version ? content.tag : news.version)
  })

  it("shows a release tagged with a v without it, and links the tag as it is", () => {
    const tagged = readContent("v1.0.0")
    expect(tagged.version).toBe("1.0.0")
    expect(tagged.tag).toBe("v1.0.0")
  })

  it("still builds for a version CHANGELOG.md has no section for, with the newest news there is", () => {
    const content = readContent("99.0.0")
    expect(content.version).toBe("99.0.0")
    expect(content.news?.version).toBe(latestNews(head)?.version)
    expect(content.news?.tag).toBe(content.news?.version)
  })
})

// The metronome on reha.stream (spec, "On reha.stream"): a tile of its own,
// the second step's lines (above) and a question.
describe("metronome on the site", () => {
  it("has the metronome tile's words", () => {
    const tile = content.features.tiles.find((t) => t.id === "metronome")!
    expect(tile.title).toBe("A click for the drummer.")
    expect(tile.body.replace(/\s+/g, " ").trim()).toBe(
      "Each song keeps its tempo and time signature. The click can go to the drummer's " +
        "headphones only, and during a take the edge of the screen lights on every click. " +
        "After a take, the Master row shows where the band ran ahead or dragged."
    )
  })

  it("asks whether there is a metronome after the question on audio interfaces", () => {
    const titles = content.faq.questions.map((q) => q.title)
    const at = titles.indexOf("Is there a metronome?")
    expect(titles[at - 1]).toBe("Which audio interfaces work?")
    expect(content.faq.questions[at].body.replace(/\s+/g, " ").trim()).toBe(
      "Yes. Each song keeps its tempo and time signature: typed, tapped, or counted from " +
        "an old take. The click plays through the output you choose, so it can go to the " +
        "drummer's headphones only, and during a take the edge of the screen lights on " +
        "every click. A take recorded to the click keeps its tempo, and its WAV and .mid " +
        "files carry it: set your DAW to that tempo, and the take's bars sit on the " +
        "project's bars."
    )
  })
})

// The tempo drift on reha.stream (drift spec, "On reha.stream"): the story's
// last step, a question after the metronome's, and the metronome tile's last
// sentence (above).
describe("tempo drift on the site", () => {
  it("says in the last step that Pałyn 5 ran ahead in the bridge and Pałyn 6 held it", () => {
    const compare = content.story.steps.find((s) => s.id === "compare")!
    expect(leadAndBeats(compare.body).beats.slice(0, 2)).toEqual([
      "Open Pałyn 5 and loop its bridge: the Master row says it ran ahead, +7.",
      "Step to Pałyn 6: the same bar, still looping, and the bridge held 128.",
    ])
  })

  it("asks whether it shows where we sped up, after the metronome's question", () => {
    const titles = content.faq.questions.map((q) => q.title)
    const at = titles.indexOf("Does it show where we sped up?")
    expect(titles[at - 1]).toBe("Is there a metronome?")
    expect(content.faq.questions[at].body.replace(/\s+/g, " ").trim()).toBe(
      "Yes. Under the tracks, the Master row draws the band's tempo bar by bar: against the " +
        "click the take was recorded to, or the song's tempo, or, for a song without one, the " +
        "take's own middle. Where the band ran ahead or dragged by more than 2% (you can change " +
        "that in Settings), the line turns amber and says by how much."
    )
  })
})
