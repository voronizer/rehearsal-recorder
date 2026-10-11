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

  it("sets the filled ones in semibold", () => {
    for (const variant of ["default", "strong", "destructive"] as const) {
      expect(looks({ variant })).toContain("font-semibold")
    }
  })

  it("sets the others in regular weight", () => {
    for (const variant of ["outline", "ghost", "link"] as const) {
      expect(looks({ variant })).toContain("font-normal")
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
