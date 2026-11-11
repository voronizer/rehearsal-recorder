import { expect, test } from "vitest"
import { laneOrder } from "@/lib/midi"
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
  notes: [
    { position: 3, name: "Drums", icon: "drums" },
    { position: 4, name: "Pads", icon: null },
  ],
} as unknown as TakePage

test("each .mid of the take is a lane of notes: under its own sound, or after the band's tracks", () => {
  expect(notesOf(take)).toEqual([
    { name: "Drums", file: "/files/t1/2/3.mid", icon: "drums", port: "", after: "Drums", place: 3 },
    { name: "Pads", file: "/files/t1/2/4.mid", port: "", after: "Keys", place: 4 },
  ])
})

test("a take with no notes has no lanes of them, and one of notes alone has them at the top", () => {
  expect(notesOf({ ...take, notes: [] })).toEqual([])
  const midiOnly = { ...take, tracks: [], notes: [{ position: 1, name: "Pads", icon: null }] }
  expect(notesOf(midiOnly)).toEqual([{ name: "Pads", file: "/files/t1/2/1.mid", port: "", after: null, place: 1 }])
})

test("a track of notes alone has its own icon, so a kit on any channel is drawn as one", () => {
  const kit = { ...take, notes: [{ position: 4, name: "Pads", icon: "drums" }] }
  expect(notesOf(kit)).toEqual([{ name: "Pads", file: "/files/t1/2/4.mid", icon: "drums", port: "", after: "Keys", place: 4 }])
})

test("the lanes of notes alone are the ones with no track of sound of their name", () => {
  expect(notesAlone(take, notesOf(take)).map((n) => n.name)).toEqual(["Pads"])
})

test("a track of notes alone goes before the Backing track, which stays last, right above Master", () => {
  const backing = { position: 3, name: "Backing", icon: null, mp3: "/files/t1/2/3.mp3", peaks: "/files/t1/2/3.peaks", kind: "backing" }
  const withBacking = { ...take, tracks: [...take.tracks, backing] } as unknown as TakePage
  const notes = notesOf(withBacking)
  expect(notes.find((n) => n.name === "Pads")?.after).toBe("Keys")
  // As РЭХА's player lays them out: the band's tracks, the notes alone, then Backing.
  const media = withBacking.tracks.map((t) => ({ name: t.name, ...(t.kind === "backing" ? { kind: "backing" as const } : {}) }))
  expect(laneOrder(media, notes, []).map((l) => `${l.kind} ${l.name}`)).toEqual([
    "audio Drums",
    "notes Drums",
    "audio Keys",
    "notes Pads",
    "audio Backing",
  ])
  // A take whose only sound is Backing has its notes at the top.
  const alone = { ...withBacking, tracks: [backing], notes: [{ position: 4, name: "Pads", icon: null }] } as unknown as TakePage
  expect(notesOf(alone)[0].after).toBeNull()
})
