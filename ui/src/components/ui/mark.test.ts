import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { LabelDot, MarkLine, MarkTick } from "@/components/ui/mark"
import type { LabelColour } from "@/lib/api"
import { LABEL_COLOURS, labelLook } from "@/lib/labels"

const issue = { id: 3, name: "Issue", colour: "red" as const, marks: 4 }

/** The attributes of the first tag in `html` matching `tag`, by name. */
const attrsOf = (html: string, tag: RegExp) => {
  const found = html.match(tag)
  if (!found) throw new Error(`no ${tag} in ${html}`)
  return Object.fromEntries([...found[0].matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]))
}

describe("MarkLine", () => {
  it("is the label's dot, the time, the take and the words, in that order", () => {
    const out = renderToStaticMarkup(
      createElement(MarkLine, { label: issue, at: 58, note: "chorus came in early", take: "Pałyn 5" }),
    )
    const order = ["bg-label-red", ">0:58<", "Pałyn 5 · ", "Issue · chorus came in early"].map((s) =>
      out.indexOf(s),
    )
    expect(order.every((at) => at >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it("says only its label when nothing is written, and no take when given none", () => {
    const out = renderToStaticMarkup(createElement(MarkLine, { label: issue, at: 5, note: " " }))
    expect(out).toMatch(/>Issue<\/span><\/span>$/)
    expect(out).not.toContain(" · ")
  })

  it("in the band service, says the note alone, or the label's name when nothing is written", () => {
    const line = (note: string) =>
      renderToStaticMarkup(createElement(MarkLine, { label: issue, at: 3725, note, variant: "service" }))
    expect(line("chorus came in early")).toContain(">chorus came in early<")
    expect(line("chorus came in early")).not.toContain("Issue")
    expect(line(" ")).toMatch(/>Issue<\/span><\/span>$/)
    // The time runs to hours, as the service's clock writes it.
    expect(line("")).toContain(">1:02:05<")
  })

  it("is a note line wherever it is, for the pages that count them", () => {
    const out = renderToStaticMarkup(createElement(MarkLine, { label: issue, at: 5, note: "" }))
    expect(out).toMatch(/^<span data-note="true"/)
  })
})

describe("LabelDot", () => {
  it("is an empty mark a screen reader skips: the line says the label in words", () => {
    const out = renderToStaticMarkup(createElement(LabelDot, { colour: "teal" }))
    // One element with nothing in it, out of the accessibility tree, and
    // nothing that would put it back (a role or a name).
    expect(out).toMatch(/^<span [^>]*><\/span>$/)
    expect(out).toContain('aria-hidden="true"')
    expect(out).not.toMatch(/\brole=|aria-label|title=|tabindex/)
  })

  it("is one size and round: 8 px", () => {
    const out = renderToStaticMarkup(createElement(LabelDot, { colour: "teal" }))
    expect(attrsOf(out, /^<span [^>]*>/).class.split(" ")).toEqual(
      expect.arrayContaining(["size-2", "rounded-full", "shrink-0"]),
    )
  })

  it("is drawn in its label's colour, the one colour labelLook gives it", () => {
    const dot = (colour: LabelColour) => renderToStaticMarkup(createElement(LabelDot, { colour }))
    for (const colour of LABEL_COLOURS) expect(dot(colour)).toContain(labelLook(colour).dot)
    // Two labels' dots are told apart by colour alone.
    expect(dot("teal")).not.toEqual(dot("red"))
    // A colour from a newer version's library is grey, as everywhere.
    expect(dot("indigo" as LabelColour)).toEqual(dot("grey"))
  })

  it("is the one dot of a note line, before its time", () => {
    const out = renderToStaticMarkup(createElement(MarkLine, { label: issue, at: 58, note: "" }))
    expect(out.match(/data-slot="label-dot"/g)).toHaveLength(1)
    // The line's first child is an empty mark, and the time comes after it,
    // whatever order the attributes are written in.
    expect(out).toMatch(/^<span [^>]*><span [^>]*><\/span><span[^>]*>0:58<\/span>/)
    expect(attrsOf(out, /^<span [^>]*>/)["data-note"]).toBe("true")
    const dot = attrsOf(out, /(?<=^<span [^>]*>)<span [^>]*>/)
    expect(dot).toMatchObject({ "aria-hidden": "true", "data-slot": "label-dot" })
    expect(dot.class.split(" ")).toEqual(expect.arrayContaining(["size-2", "rounded-full"]))
  })
})

describe("MarkTick", () => {
  const tick = (colour: LabelColour, at: number, className?: string) =>
    renderToStaticMarkup(createElement(MarkTick, { colour, at, className }))

  it("stands at its percent of the bar, 3 px wide with a small corner", () => {
    const out = tick("red", 33.5)
    const own = attrsOf(out, /^<span [^>]*>/)
    expect(own.style).toMatch(/(^|;)\s*left:\s*33\.5%/)
    expect(own.class.split(" ")).toEqual(expect.arrayContaining(["absolute", "w-[3px]", "rounded-sm"]))
  })

  it("is drawn in its label's colour and says which, for a test to read", () => {
    for (const colour of LABEL_COLOURS) {
      const own = attrsOf(tick(colour, 10), /^<span [^>]*>/)
      expect(own.class.split(" ")).toContain(labelLook(colour).dot)
      expect(own["data-mark-colour"]).toBe(colour)
    }
    // A colour from a newer version's library is grey, as everywhere.
    expect(tick("indigo" as LabelColour, 10)).toContain(labelLook("grey").dot)
  })

  it("is an empty mark a screen reader skips: the line under the bar says it in words", () => {
    const out = tick("teal", 50)
    expect(out).toMatch(/^<span [^>]*><\/span>$/)
    expect(out).toContain('aria-hidden="true"')
    expect(out).not.toMatch(/\brole=|aria-label|title=|tabindex/)
  })

  it("takes the caller's class for where it sits up and down", () => {
    expect(attrsOf(tick("teal", 50, "inset-y-1"), /^<span [^>]*>/).class.split(" ")).toContain("inset-y-1")
  })
})
