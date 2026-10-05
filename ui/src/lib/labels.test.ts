import { describe, expect, it } from "vitest"
import type { Label, Marker } from "@/lib/api"
import {
  LABEL_COLOURS,
  firstFreeColour,
  labelCounts,
  labelLook,
  labelOf,
  markText,
} from "@/lib/labels"

const note: Label = { id: 1, name: "Note", colour: "grey", marks: 0 }
const keep: Label = { id: 2, name: "Keep this", colour: "green", marks: 0 }
const solo: Label = { id: 7, name: "Solo", colour: "violet", marks: 0 }
const mark = (label_id: number, note = ""): Marker => ({ at: 1, label_id, note })

describe("labels", () => {
  it("finds a mark's label, or the first when it is not there", () => {
    expect(labelOf([note, keep], 2)).toBe(keep)
    expect(labelOf([keep, note], 99)).toBe(keep)
  })

  it("still has a label to draw with before any have been read", () => {
    expect(labelOf([], 1).colour).toBe("grey")
  })

  it("says a mark by its label's name, then its comment", () => {
    expect(markText(keep, "")).toBe("Keep this")
    expect(markText(keep, "   ")).toBe("Keep this")
    expect(markText(keep, "the take")).toBe("Keep this · the take")
  })

  it("counts marks by label, in the labels' order, leaving out labels with none", () => {
    expect(labelCounts([solo, note, keep], [mark(2), mark(1, "x"), mark(2), mark(99)])).toEqual([
      { label: solo, n: 1 },
      { label: note, n: 1 },
      { label: keep, n: 2 },
    ])
  })

  it("has a look for every colour of the palette, each its own", () => {
    expect(LABEL_COLOURS).toEqual(["grey", "red", "amber", "green", "teal", "blue", "violet", "pink"])
    for (const c of LABEL_COLOURS) {
      const look = labelLook(c)
      expect(look.cssVar).toBe(`--label-${c}`)
      expect(look.dot).toBe(`bg-label-${c}`)
      expect(look.chip).toContain(`label-${c}`)
    }
  })

  it("offers the first colour no label has, and grey once all are taken", () => {
    expect(firstFreeColour([note, keep])).toBe("red")
    expect(
      firstFreeColour(LABEL_COLOURS.map((colour, i) => ({ id: i, name: colour, colour, marks: 0 })))
    ).toBe("grey")
  })
})
