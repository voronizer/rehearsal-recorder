import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { croppedText, goneText, setDeletionKind, trashName, wentTo } from "@/lib/deletion"
import { setSystem } from "@/lib/platform"

beforeEach(() => setDeletionKind({ kind: "system", folder: "_deleted" }))
afterEach(() => {
  setSystem(null)
  setDeletionKind(null)
})

describe("wentTo", () => {
  it("says the Trash on a Mac", () => {
    setSystem("mac")
    expect(wentTo("“Palyn 3”")).toBe("“Palyn 3” went to the Trash.")
  })

  it("says the Recycle Bin on Windows", () => {
    setSystem("windows")
    expect(wentTo("“Palyn 3”")).toBe("“Palyn 3” went to the Recycle Bin.")
  })

  it("says the Trash anywhere else", () => {
    setSystem("other")
    expect(wentTo("2 false starts")).toBe("2 false starts went to the Trash.")
  })

  it("names the folder where the machine has no Trash", () => {
    setDeletionKind({ kind: "folder", folder: "_deleted" })
    setSystem("windows")
    expect(wentTo("“Palyn 3”")).toBe("“Palyn 3” moved to the _deleted folder.")
  })

  it("names the folder the settings name", () => {
    setDeletionKind({ kind: "folder", folder: "_gone" })
    expect(wentTo("1 false start")).toBe("1 false start moved to the _gone folder.")
  })
})

describe("croppedText", () => {
  it("says the uncut take went to the Trash", () => {
    setSystem("mac")
    expect(croppedText("Palyn 3")).toBe("“Palyn 3” is cropped. The uncut take went to the Trash.")
  })

  it("says the Recycle Bin on Windows", () => {
    setSystem("windows")
    expect(croppedText("Palyn 3")).toBe(
      "“Palyn 3” is cropped. The uncut take went to the Recycle Bin.",
    )
  })

  it("says the folder where there is no Trash", () => {
    setDeletionKind({ kind: "folder", folder: "_deleted" })
    expect(croppedText("Palyn 3")).toBe(
      "“Palyn 3” is cropped. The uncut take moved to the _deleted folder.",
    )
  })

  it("says where a click take now starts, the bar its start moved back to", () => {
    setSystem("mac")
    expect(croppedText("Palyn 3", 1.875)).toBe(
      "“Palyn 3” is cropped. It now starts on the bar at 0:01. The uncut take went to the Trash.",
    )
    expect(croppedText("Palyn 3", 75)).toBe(
      "“Palyn 3” is cropped. It now starts on the bar at 1:15. The uncut take went to the Trash.",
    )
  })
})

describe("goneText", () => {
  it("says an Undo too late found it gone to the Trash on a Mac", () => {
    setSystem("mac")
    expect(goneText()).toBe("It has already gone to the Trash.")
  })

  it("says the Recycle Bin on Windows", () => {
    setSystem("windows")
    expect(goneText()).toBe("It has already gone to the Recycle Bin.")
  })

  it("says the folder where there is no Trash", () => {
    setDeletionKind({ kind: "folder", folder: "_deleted" })
    expect(goneText()).toBe("It has already moved to the _deleted folder.")
  })
})

describe("trashName", () => {
  it("is the system's word for its Trash", () => {
    setSystem("mac")
    expect(trashName()).toBe("the Trash")
    setSystem("windows")
    expect(trashName()).toBe("the Recycle Bin")
  })

  it("is the folder where there is no Trash", () => {
    setDeletionKind({ kind: "folder", folder: "_deleted" })
    expect(trashName()).toBe("the _deleted folder")
  })
})
