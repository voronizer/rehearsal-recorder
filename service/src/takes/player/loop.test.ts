import { expect, test } from "vitest"
import { loopTime, passFrames, passShift } from "./loop"

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

test("a pass on repeat has all it needs once the frame after b's has come", () => {
  // b at the start of frame 10: frames up to 10 and one more, 11 in all.
  const b = 10 * 1152
  expect(passFrames(b, 12, false)).toEqual({ last: 11, all: true })
  // Exactly those 11 have come, and the file is still coming.
  expect(passFrames(b, 11, false)).toEqual({ last: 11, all: true })
  expect(passFrames(b, 10, false)).toEqual({ last: 10, all: false })
  // A file shorter than the piece: all it has.
  expect(passFrames(b, 8, true)).toEqual({ last: 8, all: true })
})

test("with no repeat a pass needs the whole file", () => {
  expect(passFrames(Infinity, 50, false)).toEqual({ last: 50, all: false })
  expect(passFrames(Infinity, 50, true)).toEqual({ last: 50, all: true })
})
