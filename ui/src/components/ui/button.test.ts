import { describe, expect, it } from "vitest"
import { buttonVariants } from "@/components/ui/button"

// The class list a variant or size ends up with, as one string.
const looks = (props: Parameters<typeof buttonVariants>[0]) => buttonVariants(props)

describe("Button variants", () => {
  it("makes destructive full colour in both themes, not 60% in the dark", () => {
    const red = looks({ variant: "destructive" })
    expect(red).toContain("text-destructive-foreground")
    expect(red).not.toContain("/60")
  })

  it("gives strong the text's own colour (Stop is neutral, F2)", () => {
    const strong = looks({ variant: "strong" })
    expect(strong).toContain("bg-strong")
    expect(strong).toContain("text-strong-foreground")
  })

  it("sets every variant in one weight, so a toggle swapping variants never changes width", () => {
    // Emphasis comes from the fill only: a heavier word is wider, and a row
    // of pills would shift on every click.
    for (const variant of ["default", "strong", "destructive", "outline", "ghost", "link"] as const) {
      const css = looks({ variant })
      expect(css, variant).toContain("font-normal")
      expect(css, variant).not.toContain("font-semibold")
      expect(css, variant).not.toContain("font-medium")
    }
  })

  it("gives every variant the same 1 px border, clear on all but outline", () => {
    // Outline's frame takes 2 px of width; a variant without one is 2 px
    // narrower, so swapping between them would move whatever sits beside.
    for (const variant of ["default", "strong", "destructive", "outline", "ghost", "link"] as const) {
      const tokens = looks({ variant }).split(/\s+/)
      expect(tokens, variant).toContain("border")
      if (variant === "outline") expect(tokens, variant).not.toContain("border-transparent")
      else expect(tokens, variant).toContain("border-transparent")
    }
  })

  it("has no secondary", () => {
    // @ts-expect-error secondary went: nothing used it
    expect(looks({ variant: "secondary" })).not.toContain("bg-secondary")
  })
})

describe("Button sizes", () => {
  it("makes the lane's M and S 20 px with a 4 px corner", () => {
    const lane = looks({ size: "lane" })
    expect(lane).toContain("size-5")
    expect(lane).toContain("rounded-sm")
    expect(lane).not.toContain("rounded-md")
    expect(lane).toContain("text-xs")
  })

  it("rounds every other size as a control, 8 px", () => {
    const sizes = [
      "default",
      "row",
      "footer",
      "footer-aside",
      "icon",
      "icon-row",
      "icon-tiny",
      "player",
    ] as const
    for (const size of sizes) {
      const css = looks({ size })
      expect(css, size).toContain("rounded-md")
      expect(css, size).not.toContain("rounded-xl")
    }
  })

  it("names the sizes for their place, at the heights they had", () => {
    expect(looks({ size: "default" })).toContain("h-9")
    expect(looks({ size: "row" })).toContain("h-8")
    expect(looks({ size: "footer-aside" })).toContain("h-10")
    expect(looks({ size: "footer" })).toContain("h-14")
    expect(looks({ size: "icon" })).toContain("size-9")
    expect(looks({ size: "icon-row" })).toContain("size-8")
    expect(looks({ size: "icon-tiny" })).toContain("size-6")
    expect(looks({ size: "player" })).toContain("size-10")
  })
})
