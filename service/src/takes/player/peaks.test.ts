import { expect, test } from "vitest"
import { Fold, peaksOf } from "./peaks"

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

test("a wave folded piece by piece as it is decoded is the wave of the whole", () => {
  const pieces = [
    [sine(700, 0.3), sine(700, 0.6)],
    [sine(1300, 0.9), sine(1300, 0.1)],
    [sine(500, 0.2), sine(500, 0.4)],
  ]
  for (const buckets of [7, 900, 5000]) {
    const fold = new Fold(2500, buckets)
    for (const p of pieces) fold.add(p)
    expect(fold.peaks).toEqual(peaksOf(pieces, buckets))
  }
})

test("a stretch that runs past the file's end is silent there", () => {
  const fold = new Fold(1000, 10)
  fold.add([new Float32Array(500).fill(0.5)])
  expect(fold.peaks).toEqual([0.5, 0.5, 0.5, 0.5, 0.5, 0, 0, 0, 0, 0])
})
