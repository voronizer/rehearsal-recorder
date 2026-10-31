import { readFileSync } from "node:fs"
import { expect, test } from "vitest"
import { parseFrames } from "./mp3"

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../test/fixtures/${name}`, import.meta.url)))

test("an MP3's frames are found and counted", () => {
  // t1.mp3: 10.032 s of mono at 48 kHz, 128 kbit/s, no Xing frame, no tag.
  const mp3 = parseFrames(fixture("t1.mp3"))
  expect(mp3.samplesPerFrame).toBe(1152)
  expect(mp3.sampleRate).toBe(48000)
  expect(mp3.channels).toBe(1)
  expect(mp3.frames.length).toBe(418)
  expect(mp3.frames.every((f) => f[0] === 0xff && (f[1] & 0xe0) === 0xe0)).toBe(true)
})

test("an ID3 tag and junk between frames are skipped", () => {
  const bytes = fixture("t2.mp3")
  const tag = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 5, 1, 2, 3, 4, 5])
  const mp3 = parseFrames(new Uint8Array([...tag, ...bytes.subarray(0, 2000), 0, 0, 0, ...bytes.subarray(2000)]))
  // The frame the three bytes land in comes out damaged; the ones after it are found again.
  expect(mp3.frames.length).toBeGreaterThanOrEqual(416)
  expect(mp3.frames[0]).toEqual(bytes.subarray(0, mp3.frames[0].length))
})

test("a file with no MP3 frames has none", () => {
  expect(parseFrames(new Uint8Array(500)).frames).toEqual([])
})
