import { describe, expect, it } from "vitest"
import type { MidiPort } from "@/lib/api"
import { bareName, findPort, portRef } from "@/lib/midiPorts"

// The same cases as tests/test_midi.py section [2]: the picker says a saved
// port is there, or not connected, exactly when Python finds it or does not.
const P = (name: string, device?: string, maker?: string, id?: string): MidiPort => ({
  name,
  ...(device ? { device } : {}),
  ...(maker ? { maker } : {}),
  ...(id ? { id } : {}),
  notes: 0,
})
const here = [
  P("TD-17", "TD-17", "Roland", "1001"),
  P("Launchkey Mini MK3 MIDI Port", "Launchkey Mini MK3", "Novation"),
]

describe("findPort: a saved port found again among the ports there (P1)", () => {
  it("finds it by its id first, then by its name", () => {
    expect(findPort({ name: "renamed", id: "1001" }, here)).toEqual({ port: here[0], alike: false })
    expect(findPort({ name: "TD-17" }, here)).toEqual({ port: here[0], alike: false })
  })

  it("then by its name as Windows renumbers it", () => {
    expect(findPort({ name: "TD-17 1" }, [P("TD-17 2")]).port?.name).toBe("TD-17 2")
    expect(findPort({ name: "2- TD-17" }, [P("TD-17")]).port?.name).toBe("TD-17")
    expect(findPort({ name: "TD-17 1", device: "TD-17" }, [P("TD-17 2", "TD-17")]).port?.name).toBe(
      "TD-17 2"
    )
  })

  it("does not guess between two alike", () => {
    expect(findPort({ name: "TD-17" }, [P("TD-17"), P("TD-17")])).toEqual({ port: null, alike: true })
    expect(findPort({ name: "TD-17" }, [P("TD-17 1"), P("2- TD-17 2")])).toEqual({
      port: null,
      alike: true,
    })
    expect(
      findPort({ name: "renamed", id: "1001" }, [P("TD-17", "", "", "1001"), P("Keys", "", "", "1001")])
    ).toEqual({ port: null, alike: true })
  })

  it("says one not there is just missing", () => {
    expect(findPort({ name: "TD-17" }, [])).toEqual({ port: null, alike: false })
    expect(findPort({ name: "renamed", id: "1001" }, [P("TD-17")])).toEqual({ port: null, alike: false })
    expect(findPort({ name: "  " }, here)).toEqual({ port: null, alike: false })
    expect(findPort({ name: "2- " }, [P("3-")])).toEqual({ port: null, alike: false })
  })

  it("takes the exact name before the bare one", () => {
    expect(findPort({ name: "TD-17 1" }, [P("TD-17 1"), P("TD-17 2")]).port?.name).toBe("TD-17 1")
  })

  it("does not bind a KeyLab 49 to a KeyLab 61 by the name they share", () => {
    expect(
      findPort({ name: "KeyLab 49", device: "KeyLab 49" }, [P("KeyLab 61", "KeyLab 61")]).port
    ).toBeNull()
  })

  it("bareName takes off Windows' numbers and the space around", () => {
    expect(bareName("2- TD-17 1")).toBe("TD-17")
    expect(bareName("  2- TD-17 1 ")).toBe("TD-17")
  })
})

describe("portRef: a listed port as a band keeps it", () => {
  it("keeps what the system said of it, and not the check's count", () => {
    expect(portRef({ name: "TD-17", device: "TD-17", maker: "Roland", id: "1001", notes: 12 })).toEqual({
      name: "TD-17",
      device: "TD-17",
      maker: "Roland",
      id: "1001",
    })
  })

  it("leaves out what says nothing", () => {
    expect(portRef({ name: "TD-17", device: "", maker: " ", notes: 0 })).toEqual({ name: "TD-17" })
  })
})
