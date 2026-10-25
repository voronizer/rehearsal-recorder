import { describe, expect, it } from "vitest"
import { content } from "./index"
import { chapterId, parseStory, readStories, type StoryDoc } from "./stories"

// A story as site/content/stories/ has them, small: the lines are numbered
// for the errors below.
const STORY = [
  "---", // 1
  "date: 2026-10-25",
  "description: A line.",
  "---",
  "", // 5
  "# A title",
  "",
  "Opening text, with [a link](/stories/other).",
  "",
  "> **Guitarist:** One.\\", // 10
  "> **Me:** Two.",
  "",
  "> **Drummer:** Three.",
  "",
  "## The gain", // 15
  "",
  "**A joke.**",
  "",
  "More *text*",
  "on two lines.", // 20
]
const text = (lines: string[]) => lines.join("\n")
/** The story with line `n` (from 1) put in place of what is there. */
const withLine = (n: number, line: string) => text(STORY.map((l, i) => (i === n - 1 ? line : l)))
const read = (md: string) => () => parseStory("a-story.md", md)

describe("parseStory", () => {
  it("reads the opening, the chapters, the chats and the jokes", () => {
    expect(parseStory("a-story.md", text(STORY))).toEqual<StoryDoc>({
      slug: "a-story",
      title: "A title",
      date: "2026-10-25",
      description: "A line.",
      chapters: [
        {
          id: null,
          title: null,
          blocks: [
            { kind: "text", text: "Opening text, with [a link](/stories/other)." },
            {
              kind: "chat",
              lines: [
                { who: "Guitarist", text: "One." },
                { who: "Me", text: "Two." },
              ],
            },
            { kind: "chat", lines: [{ who: "Drummer", text: "Three." }] },
          ],
        },
        {
          id: "the-gain",
          title: "The gain",
          blocks: [
            { kind: "joke", text: "A joke." },
            { kind: "text", text: "More *text* on two lines." },
          ],
        },
      ],
      links: ["/stories/other"],
    })
  })

  it("reads a file saved on Windows the same", () => {
    const windows = STORY.map((l) => (l.endsWith("\\") ? `${l} ` : l)).join("\r\n")
    expect(parseStory("a-story.md", windows)).toEqual(parseStory("a-story.md", text(STORY)))
  })

  it("keeps a comment's lines, so the lines after it keep their numbers", () => {
    const commented = text(["<!-- A note", "on two lines -->", ...STORY.slice(2)])
    expect(read(commented)).toThrow("site/content/stories/a-story.md:3: the file starts with --- and date: and description: lines")
  })

  it("names the file and the line of what it cannot read", () => {
    const at = (line: number, what: string) => `site/content/stories/a-story.md:${line}: ${what}`
    expect(read(text(STORY.slice(5)))).toThrow(at(1, "the file starts with --- and date: and description: lines"))
    expect(read(withLine(3, "author: Alex"))).toThrow(at(3, "author is not date or description"))
    expect(read(withLine(2, "date: 25.10.2026"))).toThrow(at(2, "date goes 2026-10-25"))
    expect(read(withLine(3, "description:"))).toThrow(at(3, "no description: at the top"))
    expect(read(text(STORY.filter((_, i) => i !== 1)))).toThrow(at(1, "no date: at the top"))
    expect(read(withLine(6, "A title"))).toThrow(at(6, "no # title after the --- block"))
    expect(read(withLine(15, "# Another"))).toThrow(at(15, "one # title only"))
    expect(read(withLine(15, "### The gain"))).toThrow(
      at(15, "a story has # for its title and ## for chapters, nothing deeper")
    )
    for (const list of ["- More", "* More", "1. More"])
      expect(read(withLine(19, list))).toThrow(at(19, "no lists in a story: write it as sentences"))
    expect(read(withLine(11, "> Me: Two."))).toThrow(at(11, "a chat line goes > **Name:** what they say"))
    expect(read(withLine(11, "> **Bassist:** Two."))).toThrow(
      at(11, "**Bassist** is not one of Singer, Guitarist, Drummer, Me")
    )
    expect(read(text([...STORY, "", "## The Gain", "", "Again."]))).toThrow(at(22, "two chapters are #the-gain"))
    expect(read(text([...STORY, "", "## Empty"]))).toThrow(at(22, "chapter “Empty” is empty"))
  })

  it("gives a chapter its address from its name", () => {
    expect(chapterId("The gain")).toBe("the-gain")
    expect(chapterId("A channel each")).toBe("a-channel-each")
    expect(chapterId("The DAW")).toBe("the-daw")
  })
})

const INDEX = text([
  "# Our stories",
  "",
  "The lede.",
  "",
  "## description",
  "",
  "For search.",
  "",
  "## byline",
  "",
  "Alex",
  "",
  "## order",
  "",
  "- a-story",
  "- other",
  "",
  "## block story",
  "",
  "a-story",
  "",
  "## block heading",
  "",
  "Heading.",
  "",
  "## block line",
  "",
  "Line.",
  "",
  "## block link",
  "",
  "Read the story",
])
const OTHER = text(["---", "date: 2026-10-26", "description: Another line.", "---", "", "# Other", "", "Words."])
const FILES = { "a-story.md": text(STORY), "other.md": OTHER }

describe("readStories", () => {
  it("reads the stories in their order, and the words of their page and block", () => {
    const stories = readStories(FILES, INDEX)
    expect(stories.list.map((s) => s.slug)).toEqual(["a-story", "other"])
    expect(stories).toMatchObject({
      title: "Our stories",
      lede: "The lede.",
      description: "For search.",
      byline: "Alex",
      block: { heading: "Heading.", line: "Line.", link: "Read the story" },
    })
    expect(stories.block.story.slug).toBe("a-story")
  })

  it("names what does not add up", () => {
    const index = "site/content/stories.md"
    expect(() => readStories(FILES, INDEX.replace("- other", "- other\n- third"))).toThrow(
      `${index}: no stories/third.md`
    )
    expect(() => readStories({ ...FILES, "extra.md": OTHER }, INDEX)).toThrow(
      `${index}: stories/extra.md is not under ## order`
    )
    expect(() => readStories(FILES, INDEX.replace("## block story\n\na-story", "## block story\n\nthird"))).toThrow(
      `${index}: the block's story, third, is not under ## order`
    )
    expect(() => readStories(FILES, INDEX.replace("## block story\n\na-story", "## block story\n\nother"))).toThrow(
      `${index}: the block's story, other, has fewer than two chats in its opening`
    )
    expect(() => readStories(FILES, INDEX.replace("## byline\n\nAlex\n", ""))).toThrow(`${index}: no section ## byline`)
    for (const href of ["/stories/nothing", "/stories/other#nothing"])
      expect(() =>
        readStories({ ...FILES, "a-story.md": text(STORY).replace("/stories/other", href) }, INDEX)
      ).toThrow(`site/content/stories/a-story.md: a link to ${href} goes nowhere`)
  })
})

// The site's own stories, as the pages will show them.
describe("the site's stories", () => {
  const { stories } = content
  const all = stories.list.flatMap((s) => s.chapters.flatMap((c) => c.blocks))
  const words = all.flatMap((b) => (b.kind === "chat" ? b.lines.map((l) => l.text) : [b.text]))

  it("has the four stories, in the order they were written", () => {
    expect(stories.list.map((s) => [s.slug, s.title, s.description, s.date])).toEqual([
      [
        "digital-mixer",
        "Record your band's rehearsal from a digital mixer",
        "We used to argue about which bar it was. Now we record each rehearsal from our Behringer XR18, a track per musician. How we do it, and what went wrong.",
        "2026-10-25",
      ],
      [
        "tempo-drift",
        "Find where your band speeds up, bar by bar",
        "Our band argued about who was rushing. Now a line under each take shows how fast we played, bar by bar, and where we ran ahead.",
        "2026-10-25",
      ],
      [
        "metronome",
        "When your drummer hates the metronome",
        "Our drummer hates the click. How we kept it out of the vocal mic, why we gave up on it, and how the kit's MIDI saved a track.",
        "2026-10-25",
      ],
      [
        "record-rehearsal",
        "How to record a band rehearsal, with a track for each of us",
        "We tried a DAW and spent the night after each rehearsal hunting for takes. What a rehearsal needs instead: Space to record, a track each, the good takes in the cloud.",
        "2026-10-25",
      ],
    ])
  })

  it("has the page of stories' words and the block's", () => {
    expect(stories).toMatchObject({
      title: "How our band records its rehearsals",
      lede: "Alex plays bass in the band and wrote РЭХА. These are our evenings, and what they taught us about recording.",
      description:
        "How a band records its rehearsals with РЭХА, told by Alex, who plays bass in it and wrote the app.",
      byline: "Alex, who plays bass in the band and wrote РЭХА",
      block: {
        heading: "We used to argue about which bar it was.",
        line: "Then we started recording. Alex, who plays bass and wrote РЭХА, tells how our band does it, and what went wrong on the way.",
        link: "Read the story",
      },
    })
    expect(stories.block.story.slug).toBe("digital-mixer")
  })

  it("opens each story with words, then numbered chapters with names", () => {
    for (const story of stories.list) {
      const [opening, ...chapters] = story.chapters
      expect(opening.title, story.slug).toBeNull()
      expect(opening.blocks.length, story.slug).toBeGreaterThan(0)
      expect(chapters.length, story.slug).toBeGreaterThan(2)
      for (const chapter of chapters) expect(chapter.title, story.slug).toBeTruthy()
      const kinds = story.chapters.flatMap((c) => c.blocks.map((b) => b.kind))
      expect(kinds, story.slug).toContain("joke")
      expect(kinds, story.slug).toContain("chat")
    }
  })

  it("links each story to the ones its text names", () => {
    expect(Object.fromEntries(stories.list.map((s) => [s.slug, s.links]))).toEqual({
      "digital-mixer": [],
      "tempo-drift": ["/stories/digital-mixer"],
      metronome: ["/stories/tempo-drift"],
      "record-rehearsal": ["/stories/digital-mixer", "/stories/metronome"],
    })
  })

  it("has no straight double quotes in the stories", () => {
    for (const w of words) expect(w).not.toContain('"')
  })
})
