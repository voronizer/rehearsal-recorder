import { expect, test } from "vitest"
import { withMute, withSolo } from "./desk"

const desk = (muted: number[], solo: number | null) => ({ muted, solo })

test("S on a muted track takes its M off", () => {
  expect(withSolo(desk([1, 2], null), 1)).toEqual(desk([2], 1))
  expect(withSolo(desk([2], 1), 0)).toEqual(desk([2], 0))
  expect(withSolo(desk([2], 1), null)).toEqual(desk([2], null))
})

test("M on the soloed track takes its S off, and on another track leaves it", () => {
  expect(withMute(desk([], 1), 1, true)).toEqual(desk([1], null))
  expect(withMute(desk([], 1), 2, true)).toEqual(desk([2], 1))
  expect(withMute(desk([1, 2], null), 1, false)).toEqual(desk([2], null))
  expect(withMute(desk([1], null), 1, true)).toEqual(desk([1], null))
})
