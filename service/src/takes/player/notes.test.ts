import { expect, test } from "vitest"
import { DRUM_ROWS, readNotes } from "./notes"

/*
  The same cases as РЭХА's own reader (tests/test_midi.py, read_notes), so a
  take's notes look the same on the band's page as in РЭХА.
*/

type Event = [seconds: number, bytes: number[]]

const on = (sec: number, note: number, vel = 100, ch = 0): Event => [sec, [0x90 | ch, note, vel]]
const off = (sec: number, note: number, vel = 0, ch = 0): Event => [sec, [0x80 | ch, note, vel]]
const cc = (sec: number, ch = 0): Event => [sec, [0xb0 | ch, 4, 90]]

/** A number as a .mid's variable-length quantity. */
function vlq(n: number): number[] {
  const out = [n & 0x7f]
  for (n >>= 7; n > 0; n >>= 7) out.unshift((n & 0x7f) | 0x80)
  return out
}

/** One track chunk of [tick, bytes] in order, ended as a .mid track is. */
function track(events: [number, number[]][]): number[] {
  const body: number[] = []
  let last = 0
  for (const [tick, bytes] of events) {
    body.push(...vlq(tick - last), ...bytes)
    last = tick
  }
  body.push(0, 0xff, 0x2f, 0)
  const n = body.length
  return [0x4d, 0x54, 0x72, 0x6b, n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff, ...body]
}

/** A whole .mid of these tracks: format 0 for one, 1 for more. */
function file(tracks: number[][], ticksPerBeat = 960): Uint8Array {
  const format = tracks.length > 1 ? 1 : 0
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, format, 0, tracks.length, ticksPerBeat >> 8, ticksPerBeat & 0xff]
  return new Uint8Array([...head, ...tracks.flat()])
}

const tempo = (us: number) => [0xff, 0x51, 3, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff]

/** As РЭХА writes a take: 960 ticks to the beat at 120, so 1920 to a second. */
function take(events: Event[], drumsIcon = false) {
  const sorted = [...events].sort((a, b) => a[0] - b[0])
  return readNotes(file([track(sorted.map(([s, b]) => [Math.round(s * 1920), b]))]), drumsIcon)
}

test("the drum rows are Crash, Ride, Hi-hat, Toms, Snare, Kick", () => {
  expect(DRUM_ROWS).toEqual(["Crash", "Ride", "Hi-hat", "Toms", "Snare", "Kick"])
})

test("each kit note lands on its row, and any other note on Other, the row after Kick", () => {
  const rows: Record<string, number[]> = {
    Kick: [36, 35],
    Snare: [38, 40, 37],
    "Hi-hat": [42, 44, 46, 22, 26],
    Toms: [48, 50, 45, 47, 43, 41, 58],
    Ride: [51, 53, 59],
    Crash: [49, 55, 57, 52],
  }
  const hits = [...Object.values(rows).flat(), 99, 0, 127]
  const grid = take(hits.flatMap((n, k) => [on(k * 0.1, n, 100, 9), off(k * 0.1 + 0.05, n, 0, 9)]))
  const want = hits.map((n) => {
    const row = Object.entries(rows).find(([, ns]) => ns.includes(n))?.[0]
    return row ? DRUM_ROWS.indexOf(row) : DRUM_ROWS.length
  })
  expect(grid).toMatchObject({ drums: true, rows: [...DRUM_ROWS, "Other"] })
  expect(grid.notes.map((n) => n[2])).toEqual(want)
  // Every note in the map: no Other row.
  expect(take([on(0, 36), on(0.1, 49)], true)).toMatchObject({ rows: DRUM_ROWS })
})

test("the drums icon makes a kit of any channel; without it, only notes all on channel 10 do", () => {
  expect(take([on(0, 36), off(0.5, 36)], true).drums).toBe(true)
  expect(take([on(0, 36, 100, 9), off(0.1, 36, 0, 9)]).drums).toBe(true)
  expect(take([on(0, 60), off(0.5, 60)]).drums).toBe(false)
  // One note-on elsewhere and it is pitched.
  expect(take([on(0, 36, 100, 9), on(0.5, 60), on(1, 38, 100, 9)]).drums).toBe(false)
  // A release, or a note-on at velocity 0, elsewhere is no note-on.
  expect(take([on(0, 36, 100, 9), off(0.1, 36, 0, 9), off(0.2, 60), on(0.3, 60, 0)]).drums).toBe(true)
  // No note-on at all is not channel 10's.
  expect(take([cc(0, 9), cc(1, 9)]).drums).toBe(false)
  expect(take([cc(0, 9)], true)).toEqual({ drums: true, rows: DRUM_ROWS, notes: [] })
})

test("a release closes the oldest note still sounding on its channel and note", () => {
  const roll = take([0, 1, 2, 3, 4, 5].flatMap((k) => [on(k * 0.05, 38, 90 + k, 9), off(k * 0.05 + 0.1, 38, 0, 9)]))
  expect(roll.notes).toEqual([0, 0.05, 0.1, 0.15, 0.2, 0.25].map((t, k) => [t, 0.1, 4, 90 + k]))
  expect(take([on(0, 60), on(0.2, 60), off(0.5, 60), off(0.9, 60)]).notes).toEqual([
    [0, 0.5, 60, 100],
    [0.2, 0.7, 60, 100],
  ])
  // The same note on two channels is two notes.
  expect(take([on(0, 60, 100, 0), on(0.1, 60, 100, 1), off(0.2, 60, 0, 1), off(0.5, 60, 0, 0)]).notes).toEqual([
    [0, 0.5, 60, 100],
    [0.1, 0.1, 60, 100],
  ])
})

test("a note-on at velocity 0 is a release, and a release with nothing sounding is passed over", () => {
  expect(take([on(0, 60), on(0.5, 60, 0), on(1, 62, 64), on(1.25, 62, 0)]).notes).toEqual([
    [0, 0.5, 60, 100],
    [1, 0.25, 62, 64],
  ])
  expect(take([on(0, 60, 0), on(0.5, 60, 0)]).notes).toEqual([])
  expect(take([off(0, 60), on(0.5, 60, 70), off(1, 60, 127), off(1.5, 60)]).notes).toEqual([[0.5, 0.5, 60, 70]])
})

test("a note never released lasts to the file's last event; one struck last is 0 long", () => {
  expect(take([on(0.5, 60), cc(2)]).notes).toEqual([[0.5, 1.5, 60, 100]])
  expect(take([on(0.5, 60), off(1, 60), on(2, 62)]).notes).toEqual([
    [0.5, 0.5, 60, 100],
    [2, 0, 62, 100],
  ])
})

test("notes come in the order they began", () => {
  const got = take([on(0, 60), on(0.1, 64), off(0.2, 64), on(0.3, 67), off(0.4, 67), off(1, 60)])
  expect(got.notes.map(([t, d, p]) => [t, d, p])).toEqual([
    [0, 1, 60],
    [0.1, 0.1, 64],
    [0.3, 0.1, 67],
  ])
})

test("a piano roll covers whole octaves from C to B, and ends at 127", () => {
  const span = (...pitches: number[]) => {
    const got = take(pitches.map((n, k) => on(k * 0.1, n)))
    return got.drums ? null : [got.low, got.high]
  }
  expect(span(61, 74)).toEqual([60, 83])
  expect(span(59, 72)).toEqual([48, 83])
  expect(span(66)).toEqual([60, 71])
  expect(span(0)).toEqual([0, 11])
  expect(span(127)).toEqual([120, 127])
  expect(take([cc(0), cc(1)])).toEqual({ drums: false, low: 60, high: 71, notes: [] })
})

test("the seconds are the file's own, through its ticks to the beat and its tempo changes", () => {
  // 480 ticks to the beat, 120 a minute, then half as fast from the second beat.
  const daw = file([track([[0, tempo(500_000)], [0, [0x90, 60, 80]], [480, tempo(1_000_000)], [960, [0x80, 60, 0]]])], 480)
  expect(readNotes(daw, false).notes).toEqual([[0, 1.5, 60, 80]])
})

test("a format 1 file's tracks are read as one: a strike in one and its release in another are one note", () => {
  const daw = file(
    [
      track([[0, tempo(500_000)]]),
      track([[0, [0x90, 60, 100]], [240, [0x90, 60, 100]]]),
      track([[480, [0x80, 60, 0]], [960, [0x80, 60, 0]]]),
    ],
    480
  )
  expect(readNotes(daw, false).notes).toEqual([
    [0, 0.5, 60, 100],
    [0.25, 0.75, 60, 100],
  ])
})

test("bytes that are not a .mid are an error", () => {
  expect(() => readNotes(new TextEncoder().encode("<html>Not found</html>"), false)).toThrow(Error)
  expect(() => readNotes(new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0]), false)).toThrow(Error)
  // A take cut short in its track, as a download that stopped would leave it.
  const whole = file([track([[0, [0x90, 60, 100]], [960, [0x80, 60, 0]]])])
  expect(() => readNotes(whole.subarray(0, whole.length - 3), false)).toThrow(Error)
})

test("a long take of keys reads in full: more notes than a browser takes as arguments", () => {
  const roll = Array.from({ length: 130_000 }, (_, k) => on(k * 0.02, 40 + (k % 30)))
  const got = take(roll)
  expect(got.notes).toHaveLength(130_000)
  expect(got).toMatchObject({ drums: false, low: 36, high: 71 })
})

test("bytes after the last track, as some programs pad a file, are passed over as РЭХА's reader does", () => {
  const padded = file([track([[0, [0x90, 60, 100]], [960, [0x80, 60, 0]]])])
  expect(readNotes(new Uint8Array([...padded, 0, 0]), false).notes).toEqual([[0, 0.5, 60, 100]])
})

test("an hour of 40000 notes reads in full", () => {
  const hour = Array.from({ length: 40000 }, (_, k) => [on(k * 0.09, 36 + (k % 40), 1 + (k % 127), 9), off(k * 0.09 + 0.05, 36 + (k % 40), 0, 9)]).flat()
  const got = take(hour)
  expect(got.notes).toHaveLength(40000)
  expect(new Set(got.notes.map((n) => n[1]))).toEqual(new Set([0.05]))
})
