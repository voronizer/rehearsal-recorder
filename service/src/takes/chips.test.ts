import { expect, test } from "vitest"
import type { Mark } from "../api"
import { chipsOf } from "./chips"

const mark = (id: number, at: number, note: string) => ({ id, at, note, label_id: 1 }) as unknown as Mark

test("two marks at the same second each open their own talk", () => {
  const marks = [mark(1, 5, "Late"), mark(2, 5, "Late"), mark(3, 9, "Ok")]
  const { markers, markOf } = chipsOf(marks)
  expect(markers.map((m) => m.at)).toEqual([5, 5, 9])
  expect(markers.map((m) => markOf(m)?.id)).toEqual([1, 2, 3])
})

test("a chip from an earlier drawing of the page still finds its mark", () => {
  const marks = [mark(1, 5, "Late"), mark(3, 9, "Ok")]
  const { markOf } = chipsOf(marks)
  expect(markOf({ at: 9, note: "Ok", label_id: 1 })?.id).toBe(3)
  expect(markOf({ at: 9, note: "Changed", label_id: 1 })?.id).toBe(3)
  expect(markOf({ at: 4, note: "", label_id: 1 })).toBeUndefined()
})
