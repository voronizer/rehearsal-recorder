import { describe, expect, it } from "vitest"
import md from "../../content/band-service.md?raw"
import sizes from "../stories/band-service/sizes.json"
import { parseBandService } from "./bandService"

// The page as site/content/band-service.md has it, small: the lines are
// numbered for the errors below.
const PAGE = [
  "---", // 1
  "description: A line.",
  "---",
  "",
  "# A title", // 5
  "",
  "The opening.",
  "",
  "## On your phone",
  "", // 10
  "Listen on the way",
  "home.",
  "",
  "![What to look at](new-takes)",
  "", // 15
  "## How to start",
  "",
  "1. Open the page and press **Send code**.",
  "2. Type the code",
  "   from the letter.", // 20
  "",
  "You stay signed in.",
]
const text = (lines: string[]) => lines.join("\n")
const without = (n: number) => PAGE.filter((_, i) => i !== n - 1)
const at = (n: number, line: string) => PAGE.map((l, i) => (i === n - 1 ? line : l))

describe("the band service's page", () => {
  it("reads the opening, the chapters with their pictures, and the steps", () => {
    expect(parseBandService(text(PAGE))).toEqual({
      title: "A title",
      description: "A line.",
      lead: ["The opening."],
      chapters: [
        {
          id: "on-your-phone",
          title: "On your phone",
          blocks: [
            { kind: "text", text: "Listen on the way home." },
            { kind: "picture", name: "new-takes", caption: "What to look at" },
          ],
        },
        {
          id: "how-to-start",
          title: "How to start",
          blocks: [
            { kind: "steps", steps: ["Open the page and press **Send code**.", "Type the code from the letter."] },
            { kind: "text", text: "You stay signed in." },
          ],
        },
      ],
    })
  })

  it("names the line of what it cannot draw", () => {
    expect(() => parseBandService(text(without(2)))).toThrow("band-service.md:1: the file starts with ---")
    expect(() => parseBandService(text(without(7)))).toThrow("band-service.md:8: no opening")
    expect(() => parseBandService(text(without(14)))).toThrow("band-service.md:9: chapter “On your phone” needs one picture")
    expect(() => parseBandService(text(at(12, "1. A step")))).toThrow("band-service.md:9: only the last chapter")
    expect(() => parseBandService(text(at(18, "- A step")))).toThrow("band-service.md:18: a list here is numbered steps")
    expect(() => parseBandService(text(at(14, "![What](New takes)")))).toThrow("band-service.md:14: a list here")
    expect(() => parseBandService(text(at(16, "## On your phone")))).toThrow("band-service.md:16: two chapters are #on-your-phone")
    expect(() => parseBandService(text(at(16, "### How to start")))).toThrow("band-service.md:16: the page has # for its title")
  })

  it("is what the page shows: seven things the service does, each with its picture, then how to start", () => {
    const page = parseBandService(md)
    expect(page.title).toBe("A band service of your own")
    expect(page.chapters.map((c) => c.title)).toEqual([
      "The takes are on your phone the same evening",
      "Hear your own part",
      "Point at the second",
      "Green to keep, red to fix",
      "Know which take you're aiming for",
      "Nothing gets lost",
      "Take your track home",
      "How to start",
    ])
    const steps = page.chapters.at(-1)!.blocks.find((b) => b.kind === "steps")
    expect(steps?.kind === "steps" && steps.steps.length).toBe(4)
    // Each picture in both themes, with its size, as `npm run pictures` in
    // service/ takes them.
    const files = Object.keys(import.meta.glob("../stories/band-service/*.webp"))
    for (const block of page.chapters.flatMap((c) => c.blocks))
      if (block.kind === "picture") {
        for (const theme of ["light", "dark"]) expect(files).toContain(`../stories/band-service/${block.name}-${theme}.webp`)
        expect(sizes).toHaveProperty(block.name)
      }
  })
})
