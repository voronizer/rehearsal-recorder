import { describe, expect, it } from "vitest"
import changelog from "../../../CHANGELOG.md?raw"
import { content, ITEMS, readContent, STEPS } from "./index"
import { leadAndBeats } from "./markdown"
import { changelogHead, displayVersion, latestNews, latestVersion } from "./changelog"

// What the build reads: the release's part of CHANGELOG.md (vite.config.ts).
const head = changelogHead(changelog, import.meta.env.VITE_SITE_VERSION || undefined)

// The words in site/content/, as the page will use them. An id spelt wrong
// there fails here, naming the file, rather than leaving a tile blank.
describe("the site's content", () => {
  it("has the four steps of an evening, in order", () => {
    expect(content.story.title).toBe("From soundcheck to the take you keep.")
    expect(content.story.steps.map((s) => s.id)).toEqual(["before", "during", "after", "later"])
    expect(content.story.steps.map((s) => s.title)).toEqual([
      "Before you play.",
      "While you record.",
      "After the take.",
      "After the rehearsal.",
    ])
  })

  it("has each step's items, in order: its tiles, then its cards", () => {
    for (const [i, step] of content.story.steps.entries())
      expect(step.items.map((item) => item.id), step.id).toEqual([...ITEMS[STEPS[i]]])
    // 31 picked: these 29, and the controller's block and its fourth line;
    // then the backing track's and the lineups'.
    expect(content.story.steps.flatMap((s) => s.items)).toHaveLength(31)
  })

  it("has a line for each step, and for each item a line and what the window says", () => {
    for (const step of content.story.steps) {
      expect(leadAndBeats(step.body), step.id).toEqual({ lead: [expect.any(String)], beats: [] })
      for (const item of step.items) {
        expect(item.title, item.id).toMatch(/\.$/)
        expect(item.line, item.id).not.toBe("")
        expect(item.more, item.id).not.toBe("")
      }
    }
    const before = content.story.steps[0]
    expect(before.body.replace(/\s+/g, " ")).toBe(
      "The tracks are filled in from last time, and each song brings its tempo and its backing track."
    )
  })

  it("has the tap card's words, and the tempo drift tile's “+7”", () => {
    const items = content.story.steps.flatMap((s) => s.items)
    const words = (id: string) => items.find((i) => i.id === id)!.line.replace(/\s+/g, " ")
    expect(words("tap")).toBe("Press Tap once, and the drummer taps the rest on any pad of the e-kit.")
    expect(words("drift")).toContain("the line turns amber: “+7”.")
  })

  it("has the controller's words: four lines, its fine print, its link and its photo's", () => {
    const { controller } = content
    expect(controller.title).toBe("Start a take without going to the laptop.")
    expect(leadAndBeats(controller.body).beats).toEqual([
      "REC starts a take, and pressed again keeps it.",
      "PLAY plays the take back, and the knob sets how loud.",
      "Hold SONG or TAKE and turn the knob to pick another one.",
      "With the click on, REC counts the band in, and the screen shows 00:00 until the band comes in.",
    ])
    expect(controller.finePrint).toContain("Settings › Controls")
    expect(controller.link).toBe("Victor Baikov's controller on GitHub")
    expect(controller.photo).toMatch(/^Victor Baikov's controller: a red REC button/)
  })

  it("has the hero's words", () => {
    expect(content.hero.title).toBe("Multitrack recording for band rehearsals")
    expect(content.hero.eyebrow).toBe("Our band's recorder, free for yours.")
    expect(content.hero.finePrint).toBe("Open source · Nothing else to install")
    expect(content.hero.caption).toContain("This is the app itself.")
    expect(content.hero.phoneCaption).toContain("Try it on a computer.")
  })

  it("has the words of the downloads at the end of the main page", () => {
    expect(content.download.title).toBe("Record the next rehearsal.")
    expect(content.download.lede.replace(/\s+/g, " ")).toBe(
      "Free, for macOS and Windows. Plug in the interface, press **Record take**, play."
    )
  })

  it("has the 404 page's words", () => {
    expect(content.notFound.title).toBe("Nothing was recorded here")
    expect(content.notFound.lede).toBe(
      "There is no page at this address. The link may be cut short or out of date."
    )
  })

  it("has eleven questions, each with an answer, the name's first", () => {
    expect(content.faq.questions).toHaveLength(11)
    expect(content.faq.questions[0].body).toContain("Belarusian for “echo”")
    // Sleep follows the laptop dying, the question it answers next.
    expect(content.faq.questions[8].title).toBe("What if the laptop dies in the middle of a take?")
    expect(content.faq.questions[9].title).toBe(
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

// The metronome on reha.stream (spec, "On reha.stream"): a question.
describe("metronome on the site", () => {
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

// The tempo drift on reha.stream (drift spec, "On reha.stream"): a question
// after the metronome's.
describe("tempo drift on the site", () => {
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

// Lineups on reha.stream (lineups spec, section 4): a tile after the backing
// track's.
describe("lineups on the site", () => {
  it("has the lineups' tile right after the backing track's, with its words", () => {
    const before = content.story.steps[0]
    const ids = before.items.map((i) => i.id)
    expect(ids[ids.indexOf("backing") + 1]).toBe("lineups")
    const lineups = before.items.find((i) => i.id === "lineups")!
    expect(lineups.title).toBe("A lineup for each evening.")
    expect(lineups.line.replace(/\s+/g, " ")).toBe(
      "Full band, Trio, With keys: pick one in the title over the tracks, and everyone is " +
        "back on their own input."
    )
    expect(lineups.more.replace(/\s+/g, " ")).toBe(
      "Take the drums off for one evening, and Full band stays as it was. Update keeps a " +
        "change for good, and Save as new makes another lineup."
    )
  })
})

// The backing track on reha.stream (backing-track spec, "On reha.stream"):
// the step's line, an item after the song's tempo, and a question after
// drift's.
describe("backing track on the site", () => {
  it("has the backing track's item right after the song's tempo, with its words", () => {
    const before = content.story.steps[0]
    const ids = before.items.map((i) => i.id)
    expect(ids[ids.indexOf("tempo") + 1]).toBe("backing")
    const backing = before.items.find((i) => i.id === "backing")!
    expect(backing.title).toBe("A song brings its backing track.")
    expect(backing.line.replace(/\s+/g, " ")).toBe(
      "Add the file to the song once. It comes in on bar 1, after the count-in, through its " +
        "own output, and the take keeps it as a track."
    )
    expect(backing.more.replace(/\s+/g, " ")).toBe(
      "The app counts the file's tempo and finds bar 1. For pads with no beat, drag bar 1 to " +
        "where you hear it. In the player the take's Backing track sits right above Master, " +
        "muted the first time, so you hear the band without it."
    )
  })

  it("asks whether it can play a backing track, after drift's question", () => {
    const titles = content.faq.questions.map((q) => q.title)
    const at = titles.indexOf("Can it play a backing track?")
    expect(titles[at - 1]).toBe("Does it show where we sped up?")
    expect(content.faq.questions[at].body.replace(/\s+/g, " ").trim()).toBe(
      "Yes. A song can keep one audio file, mono or stereo: a backing track, pads, a loop. Add " +
        "it on the song's page in History: the app counts its tempo and finds bar 1, or you " +
        "drag bar 1 to where you hear it. It comes in on bar 1, right after the count-in, " +
        "through the output you choose: the speakers, say, while the click stays in the " +
        "drummer's headphones. The take keeps it as a track of its own, so you can listen to " +
        "the band without it."
    )
  })
})
