import { describe, expect, it } from "vitest"
import { ITEM_CHOSEN } from "@/components/ui/item"
import { SECTION } from "./sections"

describe("a section in the column", () => {
  it("is lit in ITEM_CHOSEN's grey, under the Sidebar's data-active", () => {
    // `dark:bg-selected` becomes `dark:data-[active=true]:bg-selected`.
    const lit = (c: string) => c.replace(/^(dark:)?/, "$1data-[active=true]:")
    const classes = SECTION.split(/\s+/)
    for (const c of ITEM_CHOSEN.split(/\s+/)) expect(classes).toContain(lit(c))
  })
})
