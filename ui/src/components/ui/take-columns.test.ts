import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { TakeColumns } from "@/components/ui/take-columns"

type Column = { key: number; sec: number; starred: boolean; lit: boolean }

const column = (over: Partial<Column> = {}): Column => ({
  key: 1,
  sec: 60,
  starred: false,
  lit: false,
  ...over,
})

const render = (columns: Column[], props: { height?: 24 | 36; longest?: number } = {}) =>
  renderToStaticMarkup(createElement(TakeColumns, { columns, height: 24, ...props }))

/** The elements in `html` that carry the attribute `mark`, each with its
 *  attributes by name, whatever order React writes them in. */
const tagged = (html: string, mark: string) =>
  [...html.matchAll(/<\w+([^>]*)>/g)]
    .map((m) => ({
      attrs: Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]])),
    }))
    .filter((t) => mark in t.attrs)

/** The bars in `html`, each as its class list and its height in px. */
const barsOf = (html: string) =>
  tagged(html, "data-bar").map((t) => ({
    classes: t.attrs.class.split(" "),
    px: Number(/height:([\d.]+)px/.exec(t.attrs.style)![1]),
  }))

describe("TakeColumns colours", () => {
  it.each([
    ["lit", { lit: true }, "bg-foreground"],
    ["lit and starred", { lit: true, starred: true }, "bg-signal"],
    ["starred", { starred: true }, "bg-signal/45"],
    ["neither", {}, "bg-muted-foreground/35"],
  ])("a column that is %s is %s", (_, over, colour) => {
    const [bar] = barsOf(render([column(over)]))
    const fills = bar.classes.filter((c) => c.startsWith("bg-"))
    expect(fills).toEqual([colour])
  })

  it("lights one column and leaves the rest grey, a starred one paler green", () => {
    const bars = barsOf(
      render([
        column({ key: 1, starred: true }),
        column({ key: 2 }),
        column({ key: 3, lit: true }),
      ]),
    )
    expect(bars.map((b) => b.classes.find((c) => c.startsWith("bg-")))).toEqual([
      "bg-signal/45",
      "bg-muted-foreground/35",
      "bg-foreground",
    ])
  })

  it("has 4 px corners (F9)", () => {
    const [bar] = barsOf(render([column()]))
    expect(bar.classes).toContain("rounded-sm")
  })
})

describe("TakeColumns heights", () => {
  it("draws each column as tall as it ran, the longest as tall as the piece", () => {
    const bars = barsOf(render([column({ key: 1, sec: 30 }), column({ key: 2, sec: 120 })], { height: 36 }))
    expect(bars.map((b) => b.px)).toEqual([9, 36])
  })

  it("keeps a very short take tall enough to be seen", () => {
    const bars = barsOf(render([column({ key: 1, sec: 1 }), column({ key: 2, sec: 600 })]))
    expect(bars[0].px).toBe(4)
  })

  it("scales to a longest of the caller's when it is given one, as Last time does across songs", () => {
    const bars = barsOf(render([column({ sec: 60 })], { longest: 240 }))
    expect(bars[0].px).toBe(6)
  })

  it("stands each bar in a box as tall as `height`", () => {
    const html = render([column()], { height: 36 })
    // The box the bar stands in.
    expect(tagged(html, "style").map((t) => t.attrs.style)).toContain("height:36px")
  })

  it("is a bar 6 px wide at 24 and 8 px wide at 36", () => {
    expect(barsOf(render([column()], { height: 24 }))[0].classes).toContain("w-1.5")
    expect(barsOf(render([column()], { height: 36 }))[0].classes).toContain("w-2")
  })
})

describe("TakeColumns as a whole", () => {
  it("is out of the accessibility tree: the caller names it, in words", () => {
    const html = render([column()])
    expect(tagged(html, "data-columns")[0].attrs["aria-hidden"]).toBe("true")
    expect(html).not.toMatch(/\brole=|aria-label|title=/)
  })

  it("says in attributes which column is lit and which is starred, for the tests that look", () => {
    const [marked] = tagged(render([column({ lit: true, starred: true })]), "data-column")
    expect(marked.attrs).toMatchObject({ "data-lit": "true", "data-starred": "true" })
    const [plain] = tagged(render([column()]), "data-column")
    expect(plain.attrs).not.toHaveProperty("data-lit")
    expect(plain.attrs).not.toHaveProperty("data-starred")
  })

  it("is never squeezed in a row short of room: its box does not shrink", () => {
    expect(tagged(render([column()]), "data-columns")[0].attrs.class.split(" ")).toContain("shrink-0")
  })

  it("draws nothing for no columns", () => {
    expect(render([])).toBe("")
  })

  it("keeps the caller's classes", () => {
    const html = renderToStaticMarkup(
      createElement(TakeColumns, { columns: [column()], height: 24, className: "ml-auto" }),
    )
    expect(html).toContain("ml-auto")
  })
})
