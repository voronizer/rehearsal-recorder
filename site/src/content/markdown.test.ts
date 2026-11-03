import { describe, expect, it } from "vitest"
import { inline, isNewer, itemsByIds, leadAndBeats, parseDoc, sectionsByIds, sectionsByTitles } from "./markdown"

describe("parseDoc", () => {
  it("splits a file into its title, intro and sections", () => {
    expect(parseDoc("# T\n\nIntro.\n\n## A {#a}\nOne.\n\n## B\nTwo.")).toEqual({
      title: "T",
      intro: "Intro.",
      sections: [
        { title: "A", id: "a", from: null, body: "One.", items: [] },
        { title: "B", id: null, from: null, body: "Two.", items: [] },
      ],
      waiting: [],
    })
  })

  it("leaves out comments, which are notes for whoever edits the file", () => {
    expect(parseDoc("# T\n\nIntro.\n\n<!-- Keep the ids.\n     In order. -->\n\n## A\nOne.")).toEqual({
      title: "T",
      intro: "Intro.",
      sections: [{ title: "A", id: null, from: null, body: "One.", items: [] }],
      waiting: [],
    })
  })

  it("leaves out a comment that taking out another one would make", () => {
    expect(parseDoc("Intro <!-<!-- -->- note --> end.").intro).toBe("Intro  end.")
  })

  it("keeps a section's paragraphs", () => {
    expect(parseDoc("## Q\nOne.\n\nTwo.\n").sections[0].body).toBe("One.\n\nTwo.")
  })

  it("puts a step's ### items under it, with ids and bodies", () => {
    const [a, c] = parseDoc("## A {#a}\nLead.\n\n### B {#b}\nOne\nline.\n\n### D\nTwo.\n\n## C\nThree.").sections
    expect(a.body).toBe("Lead.")
    expect(a.items).toEqual([
      { title: "B", id: "b", from: null, body: "One\nline.", items: [] },
      { title: "D", id: null, from: null, body: "Two.", items: [] },
    ])
    expect(c).toEqual({ title: "C", id: null, from: null, body: "Three.", items: [] })
  })

  it("keeps a ### line before any section as words", () => {
    expect(parseDoc("### x\n\n## A").intro).toBe("### x")
  })
})

describe("inline", () => {
  it("makes bold, emphasis, code and links, and escapes the rest", () => {
    expect(inline("**Hi** <b> [x](https://e.x)")).toBe(
      '<strong>Hi</strong> &lt;b&gt; <a href="https://e.x" rel="noopener">x</a>'
    )
    expect(inline("*so* `a & b`")).toBe("<em>so</em> <code>a &amp; b</code>")
  })

  it("links only to web pages, mail, and places on the site", () => {
    expect(inline("[a](mailto:x@e.x) [b](#faq) [c](/stage.html)")).toBe(
      '<a href="mailto:x@e.x" rel="noopener">a</a> <a href="#faq" rel="noopener">b</a> <a href="/stage.html" rel="noopener">c</a>'
    )
    expect(inline("[x](javascript:void0)")).toBe("x")
    expect(inline("[x](data:text/html,hi)")).toBe("x")
  })
})

describe("leadAndBeats", () => {
  it("parts a story step into its line and the lines under it", () => {
    expect(leadAndBeats("One line.\n\n- first\n- **Marks**: second\n- third")).toEqual({
      lead: ["One line."],
      beats: ["first", "<strong>Marks</strong>: second", "third"],
    })
  })

  it("has no lines under a body with no list", () => {
    expect(leadAndBeats("One line.\n\nAnother.")).toEqual({ lead: ["One line.", "Another."], beats: [] })
  })

  it("keeps a line that wraps onto the next as one", () => {
    expect(leadAndBeats("Lead.\n\n- a line that\n  wraps\n- next").beats).toEqual(["a line that wraps", "next"])
  })
})

describe("sections of a file", () => {
  const doc = parseDoc("# T\n\n## A {#a}\nOne.\n\n## B {#b}\nTwo.")

  it("gives the sections when the ids are the ones expected, in order", () => {
    expect(sectionsByIds("x.md", doc, ["a", "b"]).map((s) => s.body)).toEqual(["One.", "Two."])
  })

  it("names the file and the id when one is missing", () => {
    expect(() => sectionsByIds("x.md", doc, ["a", "b", "c"])).toThrow(
      "site/content/x.md: no section {#c}"
    )
  })

  it("names the file and the id when one is not expected", () => {
    expect(() => sectionsByIds("x.md", doc, ["a"])).toThrow("site/content/x.md: section {#b} is not one of a")
  })

  it("names the file and the id when they are out of order", () => {
    expect(() => sectionsByIds("x.md", doc, ["b", "a"])).toThrow(
      "site/content/x.md: sections go a, b; they should go b, a"
    )
  })

  it("checks a section's items the same way, naming the section", () => {
    const [a] = parseDoc("## A {#a}\n### B {#b}\n### C {#c}").sections
    expect(itemsByIds("x.md", a, ["b", "c"]).map((s) => s.id)).toEqual(["b", "c"])
    expect(() => itemsByIds("x.md", a, ["b", "c", "d"])).toThrow("site/content/x.md, {#a}: no item {#d}")
    expect(() => itemsByIds("x.md", a, ["c", "b"])).toThrow(
      "site/content/x.md, {#a}: items go b, c; they should go c, b"
    )
  })

  it("gives sections by their titles, and names one that is missing", () => {
    const named = parseDoc("## eyebrow\nFree.\n\n## caption\nSilent.")
    expect(sectionsByTitles("h.md", named, ["eyebrow", "caption"])).toEqual({
      eyebrow: "Free.",
      caption: "Silent.",
    })
    expect(() => sectionsByTitles("h.md", named, ["fine print"])).toThrow(
      "site/content/h.md: no section ## fine print"
    )
  })
})

describe("blocks that wait for a version", () => {
  const faq = "# Questions.\n\n## Old?\nYes.\n\n## New? {from 0.22.0}\nSoon.\n"
  const story =
    "# Story.\n\n## Before. {#before}\nLead.\n\n### One. {#one}\nA.\n\n### Two. {#two from 0.22.0}\nB.\n\n### Three. {#three}\nC.\n"

  it("reads {from} and {#id from} in a heading", () => {
    const [, question] = parseDoc(faq).sections
    expect(question).toMatchObject({ title: "New?", id: null, from: "0.22.0" })
    const [, item] = parseDoc(story).sections[0].items
    expect(item).toMatchObject({ title: "Two.", id: "two", from: "0.22.0" })
  })

  it("leaves out what is newer than the release, and lists it", () => {
    const before = parseDoc(faq, { release: "0.21.0" })
    expect(before.sections.map((s) => s.title)).toEqual(["Old?"])
    expect(before.waiting).toEqual([{ id: null, title: "New?", from: "0.22.0" }])
    const items = parseDoc(story, { release: "0.21.0" })
    expect(items.waiting).toEqual([{ id: "two", title: "Two.", from: "0.22.0" }])

    const on = parseDoc(faq, { release: "0.22.0" })
    expect(on.sections.map((s) => s.title)).toEqual(["Old?", "New?"])
    expect(on.waiting).toEqual([])
    expect(parseDoc(faq).sections).toHaveLength(2)
    expect(parseDoc(faq).waiting).toEqual([])
  })

  it("keeps a waiting item's step and the other items", () => {
    const doc = parseDoc(story, { release: "0.21.0" })
    const [step] = sectionsByIds("story.md", doc, ["before"])
    expect(step.body).toBe("Lead.")
    expect(itemsByIds("story.md", step, ["one", "three"]).map((s) => s.body)).toEqual(["A.", "C."])
  })

  it("fails on a mark written wrong, naming the file and heading", () => {
    for (const mark of ["{from 0.22}", "{from soon}", "{#id from}", "{later}"])
      expect(() => parseDoc(`## Is it free? ${mark}\nYes.`, { file: "faq.md" }), mark).toThrow(
        `site/content/faq.md: the heading "## Is it free? ${mark}" ends in ${mark}; a heading ends in {#id}, {from 0.22.0} or {#id from 0.22.0}`
      )
  })

  it("reads a mark stuck to its title, and fails on braces left in a title", () => {
    expect(parseDoc("## Is it free?{from 0.22.0}\nYes.").sections[0]).toMatchObject({ title: "Is it free?", from: "0.22.0" })
    // An item's heading counts as one only under a section.
    for (const [before, heading] of [
      ["", "## Is it free? {from 0.22.0}."],
      ["## Before.\n", "### Tap. {#tap} {from 0.22.0}"],
      ["", "# Questions. {from 0.22.0}"],
    ])
      expect(() => parseDoc(`${before}${heading}\nYes.`, { file: "faq.md" }), heading).toThrow(
        `site/content/faq.md: the heading "${heading}" has braces in its title; a heading ends in {#id}, {from 0.22.0} or {#id from 0.22.0}`
      )
    expect(parseDoc("## Is it free?{#free}\nYes.").sections[0]).toMatchObject({ title: "Is it free?", id: "free" })
  })

  it("fails when a block the page needs waits", () => {
    const steps = parseDoc("## Later. {#later from 0.22.0}\nLead.", { release: "0.21.0" })
    expect(() => sectionsByIds("story.md", steps, ["later"])).toThrow(
      /\{#later\} waits for 0\.22\.0, but the page needs it; only a story item or a question can wait/
    )
    const hero = parseDoc("## eyebrow {from 0.22.0}\nFree.", { release: "0.21.0" })
    expect(() => sectionsByTitles("hero.md", hero, ["eyebrow"])).toThrow(
      "site/content/hero.md: ## eyebrow waits for 0.22.0, but the page needs it; only a story item or a question can wait"
    )
  })

  it("compares versions by number", () => {
    expect(isNewer("0.10.0", "0.9.0")).toBe(true)
    expect(isNewer("0.21.0", "0.21.0")).toBe(false)
    expect(isNewer("0.21.0", "0.22.0")).toBe(false)
    expect(() => isNewer("v1", "0.1.0")).toThrow("v1 is not a version like 0.22.0")
  })
})
