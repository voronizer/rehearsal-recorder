import { afterEach, describe, expect, it } from "vitest"
import { setSystem, system, words } from "@/lib/platform"

afterEach(() => setSystem(null))

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
  it("is what the navigator says, and under node that is nothing we know", () => {
    expect(system()).toBe("other")
  })

  it("is the one it is told to be, until it is told to go back", () => {
    setSystem("windows")
    expect(system()).toBe("windows")
    setSystem("mac")
    expect(system()).toBe("mac")
    setSystem(null)
    expect(system()).toBe("other")
  })

  it("does not throw where there is no navigator at all", () => {
    const real = Object.getOwnPropertyDescriptor(globalThis, "navigator")
    Object.defineProperty(globalThis, "navigator", { value: undefined, configurable: true })
    try {
      expect(system()).toBe("other")
    } finally {
      if (real) Object.defineProperty(globalThis, "navigator", real)
      else delete (globalThis as { navigator?: unknown }).navigator
    }
  })
})
