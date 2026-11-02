import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { Toggle, toggleVariants } from "@/components/ui/toggle"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

describe("Toggle", () => {
  it("is a grey fill when on, never the accent (F2)", () => {
    for (const variant of ["default", "outline"] as const) {
      const css = toggleVariants({ variant })
      expect(css, variant).toContain("data-[state=on]:bg-selected")
      expect(css, variant).not.toMatch(/data-\[state=on\]:bg-(primary|accent)/)
    }
  })

  it("has the same frame and weight in every look, so turning it on moves nothing (C1)", () => {
    for (const variant of ["default", "outline"] as const) {
      const css = toggleVariants({ variant })
      expect(css, variant).toMatch(/(^| )border( |$)/)
      expect(css, variant).toContain("font-normal")
    }
  })

  it("is as tall as Button's row, and a square of it for an icon", () => {
    expect(toggleVariants({ size: "row" })).toContain("h-8")
    expect(toggleVariants({ size: "icon-row" })).toContain("size-8")
  })

  it("lights M up in the accent and S in amber when on, and nothing else", () => {
    const on = (tone: "mute" | "solo") =>
      renderToStaticMarkup(createElement(Toggle, { size: "lane", variant: "outline", tone, pressed: true }, "M"))
        .match(/class="([^"]*)"/)![1]
        .split(" ")
    expect(on("mute")).toContain("data-[state=on]:bg-primary")
    expect(on("mute")).toContain("data-[state=on]:text-primary-foreground")
    expect(on("solo")).toContain("data-[state=on]:bg-warn")
    expect(on("solo")).toContain("data-[state=on]:text-warn-foreground")
    // The grey of every other toggle gives way, so the two never fight.
    for (const tone of ["mute", "solo"] as const) {
      expect(on(tone)).not.toContain("data-[state=on]:bg-selected")
      expect(on(tone)).not.toContain("data-[state=on]:text-foreground")
    }
    expect(toggleVariants({})).toContain("data-[state=on]:bg-selected")
  })

  it("has a lane size, 20 px with a 4 px corner, for M and S on a plate", () => {
    const css = toggleVariants({ size: "lane" })
    expect(css).toContain("size-5")
    expect(css).toContain("rounded-sm")
    expect(css).toContain("text-xs")
    // The plate's 20 px is the whole of it: nothing pads the letter.
    expect(css).not.toMatch(/(^| )p[xy]?-\d/)
  })

  it("draws a lane toggle at 20 px, 4 px corners and 12 px text, whatever the base says", () => {
    const html = renderToStaticMarkup(createElement(Toggle, { size: "lane", variant: "outline" }, "M"))
    const css = html.match(/class="([^"]*)"/)![1].split(" ")
    expect(css).toContain("size-5")
    expect(css).toContain("rounded-sm")
    expect(css).not.toContain("rounded-md")
    expect(css).toContain("text-xs")
    expect(css).not.toContain("text-sm")
  })
})

describe("ToggleGroup", () => {
  const group = (variant: "default" | "outline" | "switch") =>
    renderToStaticMarkup(
      createElement(
        ToggleGroup,
        { type: "single", variant },
        createElement(ToggleGroupItem, { value: "a" }, "A"),
      ),
    )

  it("as a switch is History's look: a grey track, the chosen item a plate with a light shadow", () => {
    const html = group("switch")
    expect(html).toContain("bg-muted")
    expect(html).toContain("data-[state=on]:bg-background")
    expect(html).toContain("data-[state=on]:shadow-sm")
  })

  it("otherwise says what is on with the grey fill", () => {
    for (const variant of ["default", "outline"] as const) {
      expect(group(variant), variant).toContain("data-[state=on]:bg-selected")
    }
  })
})
