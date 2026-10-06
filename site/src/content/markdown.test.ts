import { describe, expect, it } from "vitest"
import { inline, parseDoc, sectionsByIds, sectionsByTitles } from "./markdown"

describe("parseDoc", () => {
  it("splits a file into its title, intro and sections", () => {
    expect(parseDoc("# T\n\nIntro.\n\n## A {#a}\nOne.\n\n## B\nTwo.")).toEqual({
      title: "T",
      intro: "Intro.",
      sections: [
        { title: "A", id: "a", body: "One." },
        { title: "B", id: null, body: "Two." },
      ],
    })
  })

  it("leaves out comments, which are notes for whoever edits the file", () => {
    expect(parseDoc("# T\n\nIntro.\n\n<!-- Keep the ids.\n     In order. -->\n\n## A\nOne.")).toEqual({
      title: "T",
      intro: "Intro.",
      sections: [{ title: "A", id: null, body: "One." }],
    })
  })

  it("leaves out a comment that taking out another one would make", () => {
    expect(parseDoc("Intro <!-<!-- -->- note --> end.").intro).toBe("Intro  end.")
  })

  it("keeps a section's paragraphs", () => {
    expect(parseDoc("## Q\nOne.\n\nTwo.\n").sections[0].body).toBe("One.\n\nTwo.")
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
