import { expect, test } from "vitest"
import { loopTime, passShift } from "./loop"

test("before the piece's end the playhead is where it played to", () => {
  expect(loopTime(12.5, 10, 20)).toBe(12.5)
  // Started before the piece, as a seek there leaves it.
  expect(loopTime(4, 10, 20)).toBe(4)
})

test("past the piece's end it goes on from the piece's start, pass after pass", () => {
  expect(loopTime(20, 10, 20)).toBe(10)
  expect(loopTime(23, 10, 20)).toBeCloseTo(13)
  expect(loopTime(31.5, 10, 20)).toBeCloseTo(11.5)
})

test("each pass is placed one piece later on the clock", () => {
  expect(passShift(0, 10, 20)).toBe(0)
  expect(passShift(1, 10, 20)).toBe(10)
  expect(passShift(3, 10, 12.5)).toBeCloseTo(7.5)
})
