import { expect, test } from "vitest"
import { peaksOf } from "./peaks"

/** `n` samples of a sine of this height, ten whole turns. */
const sine = (n: number, height: number) => Float32Array.from({ length: n }, (_, k) => height * Math.sin((2 * Math.PI * 10 * k) / n))

test("a stretch's wave is the loudest of either side in each slice", () => {
  // Two pieces of stereo: the left side at 0.5 all through, the right
  // silent in the first piece and at 0.8 in the second.
  const first = [sine(480, 0.5), new Float32Array(480)]
  const second = [sine(480, 0.5), sine(480, -0.8)]
  const wave = peaksOf([first, second], 4)
  expect(wave).toHaveLength(4)
  expect(wave[0]).toBeCloseTo(0.5, 2)
  expect(wave[1]).toBeCloseTo(0.5, 2)
  expect(wave[2]).toBeCloseTo(0.8, 2)
  expect(wave[3]).toBeCloseTo(0.8, 2)
})

test("more slices than samples leaves none empty, and no sound is 0", () => {
  expect(peaksOf([[Float32Array.of(0.25, -1)]], 4)).toEqual([0.25, 0.25, 1, 1])
  expect(peaksOf([], 3)).toEqual([0, 0, 0])
})
