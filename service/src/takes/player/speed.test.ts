import { expect, test } from "vitest"
import { speedFor } from "./speed"

test("the take in the player keeps its speed when it comes in again", () => {
  expect(speedFor("t1", "t1", 0.75, undefined)).toBe(0.75)
  expect(speedFor("t1", "t1", 0.75, 1.25)).toBe(0.75)
})

test("another take starts at 100%, or at the speed its open page kept", () => {
  expect(speedFor("t2", "t1", 0.75, undefined)).toBe(1)
  expect(speedFor("t2", "t1", 0.75, 0.6)).toBe(0.6)
  expect(speedFor("t1", "", 1, undefined)).toBe(1)
})
