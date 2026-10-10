import { describe, expect, it } from "vitest"
import type { MissingNotes, NotesFile, TrackFile } from "@/lib/api"
import { laneOrder, modeOf, notesProblem, recordsAudio, recordsNotes } from "@/lib/midi"

// The same bands and the same sentences as tests/test_midi.py section [1]:
// the screen greys Start out before asking Python, so it has to say what
// Python would.
const gtr = { name: "Gtr", channel: 1 }
const keys = {
  name: "Keys",
  mode: "midi" as const,
  channel: null,
  midi_port: { name: "Launchkey Mini MK3" },
}
const drums = {
  name: "Drums",
  mode: "both" as const,
  channel: 2,
  midi_port: { name: "TD-17" },
}
const noPort = { ...keys, midi_port: null }

describe("modeOf, recordsAudio, recordsNotes: what a track does", () => {
  it("reads a track with no mode, or one nobody here knows, as Audio", () => {
    for (const mode of [undefined, null, "", "MIDI", "notes"]) {
      expect(modeOf({ mode })).toBe("audio")
    }
    expect(modeOf({})).toBe("audio")
  })

  it("keeps the three modes as they are stored", () => {
    expect(modeOf({ mode: "audio" })).toBe("audio")
    expect(modeOf({ mode: "both" })).toBe("both")
    expect(modeOf({ mode: "midi" })).toBe("midi")
  })

  it("records audio for Audio and Both, notes for Both and MIDI", () => {
    expect([recordsAudio({}), recordsNotes({})]).toEqual([true, false])
    expect([recordsAudio({ mode: "audio" }), recordsNotes({ mode: "audio" })]).toEqual([true, false])
    expect([recordsAudio({ mode: "both" }), recordsNotes({ mode: "both" })]).toEqual([true, true])
    expect([recordsAudio({ mode: "midi" }), recordsNotes({ mode: "midi" })]).toEqual([false, true])
    expect([recordsAudio({ mode: "theremin" }), recordsNotes({ mode: "theremin" })]).toEqual([true, false])
  })
})

describe("notesProblem: what stops Start, in the words Python uses", () => {
  it("A1: a rehearsal of nothing but MIDI has nothing to hear", () => {
    expect(notesProblem([keys])).toBe("At least one track has to record sound, so the takes can be heard.")
  })

  it("P3: a track with no port, singular", () => {
    expect(notesProblem([gtr, noPort])).toBe("Keys has no MIDI port yet. Pick one, or set it to Audio.")
  })

  it("P3: tracks with no port, plural, in band order", () => {
    expect(notesProblem([gtr, noPort, { ...noPort, name: "Synth" }])).toBe(
      "Keys, Synth have no MIDI port yet. Pick one, or set them to Audio."
    )
    expect(notesProblem([gtr, { ...noPort, name: "Zed" }, { ...noPort, name: "Ann" }])).toBe(
      "Zed, Ann have no MIDI port yet. Pick one, or set them to Audio."
    )
  })

  it("P2: two tracks on one port", () => {
    expect(notesProblem([gtr, drums, { ...keys, midi_port: { name: "TD-17" } }])).toBe(
      "Drums and Keys both take notes from TD-17."
    )
  })

  it("None: a port picked but not plugged in stops nothing, nor does an old band", () => {
    expect(notesProblem([gtr, drums, keys])).toBeNull()
    expect(notesProblem([gtr, { name: "Bass", channel: 2 }])).toBeNull()
    expect(notesProblem([drums])).toBeNull()
  })

  it("says A1 before P3, and P3 before P2", () => {
    expect(notesProblem([noPort])).toBe("At least one track has to record sound, so the takes can be heard.")
    expect(notesProblem([gtr, noPort, { ...drums, name: "Pad" }, drums])).toBe(
      "Keys has no MIDI port yet. Pick one, or set it to Audio."
    )
  })

  it("counts a Both track with no port, and a port with no name, as having none", () => {
    expect(notesProblem([gtr, { ...drums, midi_port: null }])).toBe(
      "Drums has no MIDI port yet. Pick one, or set it to Audio."
    )
    expect(notesProblem([gtr, { ...keys, midi_port: { name: "  " } }])).toBe(
      "Keys has no MIDI port yet. Pick one, or set it to Audio."
    )
  })

  it("never charges an Audio track with a port, whatever it was handed", () => {
    const stray = { name: "TD-17" }
    expect(notesProblem([{ ...gtr, midi_port: stray }, drums])).toBeNull()
    expect(notesProblem([drums, { ...gtr, midi_port: stray }])).toBeNull()
    expect(notesProblem([{ ...gtr, mode: "audio" as const, midi_port: stray }, drums])).toBeNull()
    expect(notesProblem([{ ...gtr, midi_port: null }, drums])).toBeNull()
    expect(notesProblem([{ ...gtr, mode: "audio" as const, midi_port: { name: " " } }, drums])).toBeNull()
  })

  it("names the first collision met walking the band", () => {
    const four = [
      ["A", "p1"],
      ["B", "p2"],
      ["C", "p2"],
      ["D", "p1"],
    ].map(([name, port]) => ({ ...drums, name, midi_port: { name: port } }))
    expect(notesProblem(four)).toBe("B and C both take notes from p2.")
    expect(
      notesProblem([
        gtr,
        { ...keys, name: "Pad", midi_port: { name: "TD-17" } },
        drums,
        { ...keys, midi_port: { name: "TD-17" } },
      ])
    ).toBe("Pad and Drums both take notes from TD-17.")
  })

  it("takes two ports for one when their names are the same, whatever else is known", () => {
    expect(
      notesProblem([
        gtr,
        { ...drums, midi_port: { name: "TD-17", id: "a" } },
        { ...keys, midi_port: { name: "TD-17", id: "b" } },
      ])
    ).toBe("Drums and Keys both take notes from TD-17.")
    expect(
      notesProblem([gtr, drums, { ...keys, midi_port: { name: "TD-17 MIDI 2" } }])
    ).toBeNull()
  })

  it("reads a port saved as a bare name as that port", () => {
    expect(
      notesProblem([gtr, { ...drums, midi_port: "TD-17" }, { ...keys, midi_port: { name: "TD-17" } }])
    ).toBe("Drums and Keys both take notes from TD-17.")
  })

  it("leaves no tracks to the earlier refusal, and the tracks given as they were", () => {
    expect(notesProblem([])).toBeNull()
    const band = [gtr, { ...noPort }]
    notesProblem(band)
    expect(band).toEqual([gtr, noPort])
  })
})

describe("laneOrder: the lanes of a take, top to bottom", () => {
  const audio = (...names: string[]): TrackFile[] =>
    names.map((name) => ({ name, file: `/rec/${name}.wav` }))
  const notes = (name: string, after: string | null, port = "TD-17"): NotesFile => ({
    name,
    file: `/rec/${name}.mid`,
    port,
    after,
  })
  const gone = (name: string, after: string | null, port = "Launchkey Mini MK3"): MissingNotes => ({
    name,
    port,
    after,
  })
  const spell = (lanes: ReturnType<typeof laneOrder>) =>
    lanes.map((l) => `${l.kind}:${l.name}`)

  it("is the audio lanes in order when there are no notes", () => {
    expect(spell(laneOrder(audio("Gtr", "Drums", "Bass"), [], []))).toEqual([
      "audio:Gtr",
      "audio:Drums",
      "audio:Bass",
    ])
    expect(laneOrder([], [], [])).toEqual([])
  })

  it("puts Drums' notes right after Drums", () => {
    expect(
      spell(laneOrder(audio("Gtr", "Drums", "Bass"), [notes("Drums", "Drums")], []))
    ).toEqual(["audio:Gtr", "audio:Drums", "notes:Drums", "audio:Bass"])
  })

  it("puts Keys' notes after the audio lane before it in the band", () => {
    expect(
      spell(
        laneOrder(
          audio("Gtr", "Drums"),
          [notes("Keys", "Gtr", "Launchkey Mini MK3"), notes("Drums", "Drums")],
          []
        )
      )
    ).toEqual(["audio:Gtr", "notes:Keys", "audio:Drums", "notes:Drums"])
  })

  it("puts a notes track first in the band before every audio lane", () => {
    expect(
      spell(laneOrder(audio("Gtr", "Drums"), [notes("Keys", null, "Launchkey Mini MK3")], []))
    ).toEqual(["notes:Keys", "audio:Gtr", "audio:Drums"])
  })

  it("keeps two notes tracks after one audio track in the order they came", () => {
    expect(
      spell(
        laneOrder(
          audio("Gtr", "Drums", "Bass"),
          [notes("Drums", "Drums"), notes("Keys", "Drums", "Launchkey"), notes("Pad", "Drums", "Pad port")],
          []
        )
      )
    ).toEqual(["audio:Gtr", "audio:Drums", "notes:Drums", "notes:Keys", "notes:Pad", "audio:Bass"])
  })

  it("keeps two notes tracks at the top in the order they came", () => {
    expect(
      spell(laneOrder(audio("Gtr"), [notes("Keys", null), notes("Pad", null)], []))
    ).toEqual(["notes:Keys", "notes:Pad", "audio:Gtr"])
  })

  it("sets a missing one where its .mid would be", () => {
    expect(
      spell(laneOrder(audio("Gtr", "Drums", "Bass"), [], [gone("Keys", "Gtr")]))
    ).toEqual(["audio:Gtr", "missing:Keys", "audio:Drums", "audio:Bass"])
    expect(spell(laneOrder(audio("Gtr", "Drums"), [], [gone("Keys", null)]))).toEqual([
      "missing:Keys",
      "audio:Gtr",
      "audio:Drums",
    ])
  })

  it("sets a Both track's missing .mid right under its own sound", () => {
    expect(
      spell(
        laneOrder(
          audio("Gtr", "Drums", "Bass"),
          [],
          [gone("Drums", "Drums", "TD-17")]
        )
      )
    ).toEqual(["audio:Gtr", "audio:Drums", "missing:Drums", "audio:Bass"])
  })

  it("lists the notes that were saved before those that are missing in one place", () => {
    expect(
      spell(
        laneOrder(
          audio("Gtr", "Drums"),
          [notes("Drums", "Drums")],
          [gone("Keys", "Drums")]
        )
      )
    ).toEqual(["audio:Gtr", "audio:Drums", "notes:Drums", "missing:Keys"])
  })

  it("keeps a Both track's own lane right under its sound, missing or not, before the tracks after it", () => {
    // Keys follows Drums because Drums is the last track before it with
    // sound: it comes after Drums in the band, so Drums' own lane is first.
    expect(
      spell(
        laneOrder(
          audio("Gtr", "Drums"),
          [notes("Keys", "Drums", "Launchkey")],
          [gone("Drums", "Drums", "TD-17")]
        )
      )
    ).toEqual(["audio:Gtr", "audio:Drums", "missing:Drums", "notes:Keys"])
    expect(
      spell(
        laneOrder(
          audio("Gtr", "Drums"),
          [notes("Keys", "Drums", "Launchkey"), notes("Drums", "Drums")],
          []
        )
      )
    ).toEqual(["audio:Gtr", "audio:Drums", "notes:Drums", "notes:Keys"])
  })

  it("puts a missing and a saved lane after the same audio lane in band order, by their places", () => {
    // Gtr, Pads (MIDI, its port gone), Synth (MIDI, saved), Bass: both
    // follow Gtr, and only their places say Pads stood first.
    const pads = { ...gone("Pads", "Gtr", "Pad box"), place: 1 }
    const synth = { ...notes("Synth", "Gtr", "Synth port"), place: 2 }
    expect(spell(laneOrder(audio("Gtr", "Bass"), [synth], [pads]))).toEqual([
      "audio:Gtr",
      "missing:Pads",
      "notes:Synth",
      "audio:Bass",
    ])
  })

  it("keeps the band's order in every take, whichever port was there", () => {
    const savedPads = { ...notes("Pads", "Gtr", "Pad box"), place: 1 }
    const goneSynth = { ...gone("Synth", "Gtr", "Synth port"), place: 2 }
    expect(spell(laneOrder(audio("Gtr", "Bass"), [savedPads], [goneSynth]))).toEqual([
      "audio:Gtr",
      "notes:Pads",
      "missing:Synth",
      "audio:Bass",
    ])
    // And the same at the top, before every audio lane.
    const top = laneOrder(
      audio("Gtr"),
      [{ ...notes("Synth", null), place: 1 }],
      [{ ...gone("Pads", null), place: 0 }]
    )
    expect(spell(top)).toEqual(["missing:Pads", "notes:Synth", "audio:Gtr"])
  })

  it("keeps a Both track's own lane first by its place too", () => {
    expect(
      spell(
        laneOrder(
          audio("Gtr", "Drums"),
          [{ ...notes("Keys", "Drums", "Launchkey"), place: 2 }],
          [{ ...gone("Drums", "Drums", "TD-17"), place: 1 }]
        )
      )
    ).toEqual(["audio:Gtr", "audio:Drums", "missing:Drums", "notes:Keys"])
  })

  it("keeps the order it was given where a lane has no place", () => {
    // A track the band does not have has no place: as before, the saved first.
    expect(
      spell(
        laneOrder(
          audio("Gtr"),
          [notes("Synth", "Gtr")],
          [{ ...gone("Pads", "Gtr"), place: 1 }]
        )
      )
    ).toEqual(["audio:Gtr", "notes:Synth", "missing:Pads"])
  })

  it("lays out whatever the audio lanes are, and hands each back as it was given", () => {
    // The player lays its lanes out from what take_media answered, which has
    // a track's name and its waveform, and no file.
    const media = [{ name: "Gtr", peaks: [[0.5]] }]
    const [first, second] = laneOrder(media, [notes("Keys", "Gtr")], [])
    expect(first).toEqual({ kind: "audio", name: "Gtr", track: media[0] })
    expect(first.kind === "audio" && first.track).toBe(media[0])
    expect(second.kind).toBe("notes")
  })

  it("carries what each lane is made of", () => {
    const [first, second, third] = laneOrder(
      audio("Gtr"),
      [notes("Drums", "Gtr")],
      [gone("Keys", "Gtr")]
    )
    expect(first).toEqual({ kind: "audio", name: "Gtr", track: { name: "Gtr", file: "/rec/Gtr.wav" } })
    expect(second).toEqual({ kind: "notes", name: "Drums", notes: notes("Drums", "Gtr") })
    expect(third).toEqual({ kind: "missing", name: "Keys", missing: gone("Keys", "Gtr") })
  })

  it("treats a lane that follows an audio lane the take does not have as one that goes first", () => {
    expect(
      spell(laneOrder(audio("Gtr"), [notes("Keys", "Lost")], [gone("Pad", "Lost")]))
    ).toEqual(["notes:Keys", "missing:Pad", "audio:Gtr"])
  })

  it("is a take of nothing but notes, when the audio files are gone", () => {
    expect(spell(laneOrder([], [notes("Keys", null)], [gone("Pad", null)]))).toEqual([
      "notes:Keys",
      "missing:Pad",
    ])
  })

  it("leaves the lists it is given as they were", () => {
    const tracks = audio("Gtr", "Drums")
    const saved = [notes("Drums", "Drums")]
    const missing = [gone("Keys", null)]
    const before = JSON.stringify([tracks, saved, missing])
    laneOrder(tracks, saved, missing)
    expect(JSON.stringify([tracks, saved, missing])).toBe(before)
  })
})
