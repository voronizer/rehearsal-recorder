import { expect, test } from "vitest"
import type { TakePage } from "../../api"
import { notesAlone, notesOf } from "./lanes"

/** A take as its page has it: Drums and Keys recorded sound, the drums and a pad their notes too. */
const take = {
  uid: "t1",
  gen: 2,
  tracks: [
    { position: 1, name: "Drums", icon: "drums", mp3: "/files/t1/2/1.mp3", peaks: "/files/t1/2/1.peaks" },
    { position: 2, name: "Keys", icon: "keys", mp3: "/files/t1/2/2.mp3", peaks: "/files/t1/2/2.peaks" },
  ],
  files: [
    { position: 1, name: "Drums", mp3: true, flac: true, mid: null },
    { position: 2, name: "Keys", mp3: true, flac: true, mid: null },
    { position: 3, name: "Drums", mp3: false, flac: false, mid: true },
    { position: 4, name: "Pads", mp3: false, flac: false, mid: true },
  ],
} as unknown as TakePage

test("each .mid of the take is a lane of notes: under its own sound, or after the band's tracks", () => {
  expect(notesOf(take)).toEqual([
    { name: "Drums", file: "/files/t1/2/3.mid", icon: "drums", port: "", after: "Drums", place: 3 },
    { name: "Pads", file: "/files/t1/2/4.mid", port: "", after: "Keys", place: 4 },
  ])
})

test("a take with no notes has no lanes of them, and one of notes alone has them at the top", () => {
  expect(notesOf({ ...take, files: take.files.slice(0, 2) })).toEqual([])
  const midiOnly = { ...take, tracks: [], files: [{ position: 1, name: "Pads", mp3: false, flac: false, mid: true }] }
  expect(notesOf(midiOnly)).toEqual([{ name: "Pads", file: "/files/t1/2/1.mid", port: "", after: null, place: 1 }])
})

test("the lanes of notes alone are the ones with no track of sound of their name", () => {
  expect(notesAlone(take, notesOf(take)).map((n) => n.name)).toEqual(["Pads"])
})
