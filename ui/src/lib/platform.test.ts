import { afterEach, describe, expect, it, vi } from "vitest"
import { setSystem, system, words } from "@/lib/platform"

afterEach(() => {
  setSystem(null)
  vi.unstubAllGlobals()
})

describe("words", () => {
  it("are the Mac's on a Mac", () => {
    expect(words("mac")).toEqual({
      mod: "⌘",
      undoKey: "⌘Z",
      fileManager: "Finder",
      folderButton: "Show in Finder",
      trash: "the Trash",
    })
  })

  it("are Windows' on Windows, which has a Recycle Bin", () => {
    expect(words("windows")).toEqual({
      mod: "Ctrl",
      undoKey: "Ctrl+Z",
      fileManager: "Explorer",
      folderButton: "Show in Explorer",
      trash: "the Recycle Bin",
    })
  })

  it("are the plain ones anywhere else", () => {
    const w = words("other")
    expect(w.mod).toBe("Ctrl")
    expect(w.undoKey).toBe("Ctrl+Z")
    expect(w.fileManager).toBe("file manager")
    expect(w.folderButton).toBe("Open folder")
    expect(w.trash).toBe("the Trash")
  })

  it("are those of the system we are on when none is named", () => {
    setSystem("windows")
    expect(words().folderButton).toBe("Show in Explorer")
    setSystem("mac")
    expect(words().mod).toBe("⌘")
  })
})

describe("system", () => {
  // Node 21 and later has a navigator of its own, with the machine it runs on
  // in its platform: a test that asked it would answer differently on a
  // developer's Mac. Each case below says what the navigator says.
  const on = (platform: string | undefined) =>
    vi.stubGlobal("navigator", platform === undefined ? {} : { platform })

  it("is mac where the navigator says Mac", () => {
    on("MacIntel")
    expect(system()).toBe("mac")
  })

  it("is mac on an iPhone and an iPad, whose hand goes to the same key", () => {
    on("iPhone")
    expect(system()).toBe("mac")
    on("iPad")
    expect(system()).toBe("mac")
  })

  it("is windows where the navigator says Win", () => {
    on("Win32")
    expect(system()).toBe("windows")
  })

  it("is other for Linux, and for anything it does not know", () => {
    on("Linux x86_64")
    expect(system()).toBe("other")
    on("FreeBSD amd64")
    expect(system()).toBe("other")
  })

  it("is other for a navigator that says no platform", () => {
    on(undefined)
    expect(system()).toBe("other")
  })

  it("is other, and does not throw, where there is no navigator at all", () => {
    vi.stubGlobal("navigator", undefined)
    expect(system()).toBe("other")
  })

  it("is the one it is told to be, until it is told to go back", () => {
    on("Linux x86_64")
    setSystem("windows")
    expect(system()).toBe("windows")
    setSystem("mac")
    expect(system()).toBe("mac")
    setSystem(null)
    expect(system()).toBe("other")
    on("MacIntel")
    expect(system()).toBe("mac")
  })
})
