import { expect, test } from "vitest"
import { heard, withMute, withSolo } from "./desk"

const desk = (muted: number[], solo: number[]) => ({ muted, solo })

test("S on a muted track takes its M off", () => {
  expect(withSolo(desk([1, 2], []), 1, true)).toEqual(desk([2], [1]))
  expect(withSolo(desk([2], [1]), 1, false)).toEqual(desk([2], []))
})

test("S on a second track adds it; S again takes one away", () => {
  expect(withSolo(desk([2], [1]), 0, true)).toEqual(desk([2], [1, 0]))
  expect(withSolo(desk([2], [1, 0]), 1, false)).toEqual(desk([2], [0]))
  expect(withSolo(desk([], [1]), 1, true)).toEqual(desk([], [1]))
  expect(withSolo(desk([], [1]), 3, false)).toEqual(desk([], [1]))
})

test("M on a soloed track takes its S off, and on another track leaves it", () => {
  expect(withMute(desk([], [1, 3]), 1, true)).toEqual(desk([1], [3]))
  expect(withMute(desk([], [1]), 2, true)).toEqual(desk([2], [1]))
  expect(withMute(desk([1, 2], []), 1, false)).toEqual(desk([2], []))
  expect(withMute(desk([1], []), 1, true)).toEqual(desk([1], []))
})

test("with S on, only the soloed tracks are heard; with none, all but the muted", () => {
  expect([0, 1, 2, 3].map((i) => heard(desk([2], [1, 3]), i))).toEqual([false, true, false, true])
  expect([0, 1, 2].map((i) => heard(desk([2], []), i))).toEqual([true, true, false])
})
