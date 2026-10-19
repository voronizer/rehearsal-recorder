import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  ACTION_MS,
  dismiss,
  dismissNotice,
  getNotices,
  lifetime,
  runAction,
  undoLatest,
} from "@/lib/notices"
import { setDeletionKind } from "@/lib/deletion"
import { setSystem } from "@/lib/platform"
import {
  endEveryOffer,
  draftMovedTo,
  endedByPython,
  keptText,
  offerCropUndo,
  offerUndo,
} from "@/lib/trash"

// Python, as far as an Undo reaches it: what each call answers is set by
// the test.
const bridge = vi.hoisted(() => ({ undo_trash: vi.fn(), end_trash: vi.fn() }))
vi.mock("@/lib/api", () => ({ api: () => bridge }))

/** Every answer on its way back has arrived: they are promises already
 *  settled, so one turn of the event loop sees them all through. */
const settle = () => new Promise((done) => setTimeout(done, 0))

const notice = (token: string) => getNotices().find((n) => n.key === `undo:${token}`)

beforeEach(() => {
  for (const n of getNotices()) dismissNotice(n.id)
  bridge.undo_trash.mockReset()
  bridge.end_trash.mockReset()
  bridge.end_trash.mockResolvedValue({ ok: true })
  setSystem("mac")
  setDeletionKind({ kind: "system", folder: "_deleted" })
})

afterEach(() => {
  for (const n of getNotices()) dismissNotice(n.id)
  setSystem(null)
  setDeletionKind(null)
  vi.restoreAllMocks()
})

describe("offerUndo", () => {
  it("says what went, with Undo, for ten seconds, under a key of its own", () => {
    offerUndo({ text: "“Pałyn 5” went to the Trash.", token: "t1", onUndone: vi.fn() })
    const n = notice("t1")!
    expect(n.kind).toBe("done")
    expect(n.text).toBe("“Pałyn 5” went to the Trash.")
    expect(n.action?.label).toBe("Undo")
    expect(lifetime(n)).toBe(ACTION_MS)
  })

  it("Undo puts it back and hands the answer on, and ends nothing", async () => {
    const back = { ok: true, kind: "take", folder: "/rec/old", take_numbers: [5] }
    bridge.undo_trash.mockResolvedValue(back)
    const onUndone = vi.fn()
    offerUndo({ text: "gone", token: "t1", onUndone })
    runAction(notice("t1")!.id)
    await settle()
    expect(bridge.undo_trash).toHaveBeenCalledWith("t1")
    expect(onUndone).toHaveBeenCalledWith(back)
    expect(bridge.end_trash).not.toHaveBeenCalled()
    expect(getNotices()).toHaveLength(0)
  })

  it("is what ⌘Z or Ctrl+Z takes back", async () => {
    bridge.undo_trash.mockResolvedValue({ ok: true, kind: "take" })
    offerUndo({ text: "gone", token: "t1", onUndone: vi.fn() })
    expect(undoLatest()).toBe(true)
    await settle()
    expect(bridge.undo_trash).toHaveBeenCalledWith("t1")
  })

  it("ends the removal when its notice goes, once", async () => {
    offerUndo({ text: "gone", token: "t1", onUndone: vi.fn() })
    dismiss("undo:t1")
    dismiss("undo:t1")
    await settle()
    expect(bridge.end_trash).toHaveBeenCalledTimes(1)
    expect(bridge.end_trash).toHaveBeenCalledWith("t1")
    expect(getNotices()).toHaveLength(0)
  })

  it("hands back a way to end the offer early", async () => {
    const end = offerUndo({ text: "gone", token: "t1", onUndone: vi.fn() })
    end()
    await settle()
    expect(notice("t1")).toBeUndefined()
    expect(bridge.end_trash).toHaveBeenCalledWith("t1")
  })

  it("says so when the Trash refused it at the end", async () => {
    bridge.end_trash.mockResolvedValue({ ok: false, error: "Permission denied" })
    offerUndo({ text: "gone", token: "t1", onUndone: vi.fn() })
    dismiss("undo:t1")
    await settle()
    const n = notice("t1")!
    expect(n.kind).toBe("error")
    expect(n.text).toBe("Permission denied")
    expect(n.action).toBeUndefined()
  })

  it("offers a refused Undo again, which can be retried, and still ends when it goes", async () => {
    bridge.undo_trash.mockResolvedValueOnce({ ok: false, error: "Wait until the crop is done." })
    const onUndone = vi.fn()
    offerUndo({ text: "gone", token: "t1", onUndone })
    runAction(notice("t1")!.id)
    await settle()
    const again = notice("t1")!
    expect(again.kind).toBe("error")
    expect(again.text).toBe("Wait until the crop is done.")
    expect(again.action?.label).toBe("Undo")
    expect(lifetime(again)).toBe(ACTION_MS)
    expect(onUndone).not.toHaveBeenCalled()
    expect(bridge.end_trash).not.toHaveBeenCalled()

    // Retried, once the crop is done.
    bridge.undo_trash.mockResolvedValueOnce({ ok: true, kind: "take" })
    runAction(again.id)
    await settle()
    expect(onUndone).toHaveBeenCalledWith({ ok: true, kind: "take" })
    expect(bridge.end_trash).not.toHaveBeenCalled()
  })

  it("ends a refused Undo's removal when the offer made again goes", async () => {
    bridge.undo_trash.mockResolvedValue({ ok: false, error: "Take 5 is taken by another take now." })
    offerUndo({ text: "gone", token: "t1", onUndone: vi.fn() })
    runAction(notice("t1")!.id)
    await settle()
    dismiss("undo:t1")
    await settle()
    expect(bridge.end_trash).toHaveBeenCalledTimes(1)
    expect(bridge.end_trash).toHaveBeenCalledWith("t1")
  })

  // Python answers "gone" for an Undo too late, and the words are the
  // interface's: the system's own name for the Trash (spec P2).
  const tooLate = async (answer: object) => {
    bridge.undo_trash.mockResolvedValue(answer)
    offerUndo({ text: "gone", token: "t1", onUndone: vi.fn() })
    runAction(notice("t1")!.id)
    await settle()
    return notice("t1")!
  }

  it("says an Undo too late as it is, with nothing left to offer or end", async () => {
    const n = await tooLate({ ok: false, gone: true, error: "It has already gone to the Trash." })
    expect(n.kind).toBe("error")
    expect(n.text).toBe("It has already gone to the Trash.")
    expect(n.action).toBeUndefined()
    dismiss("undo:t1")
    await settle()
    expect(bridge.end_trash).not.toHaveBeenCalled()
  })

  it("says the Recycle Bin for an Undo too late on Windows, whatever Python's words", async () => {
    setSystem("windows")
    const n = await tooLate({ ok: false, gone: true, error: "It has already gone to the Trash." })
    expect(n.text).toBe("It has already gone to the Recycle Bin.")
    expect(n.action).toBeUndefined()
  })

  it("says the _deleted folder for an Undo too late where there is no Trash", async () => {
    setSystem("windows")
    setDeletionKind({ kind: "folder", folder: "_deleted" })
    const n = await tooLate({ ok: false, gone: true, error: "anything" })
    expect(n.text).toBe("It has already moved to the _deleted folder.")
    expect(n.action).toBeUndefined()
  })

  it("goes by Python's flag, not its words: a refusal that only reads like one is offered again", async () => {
    const n = await tooLate({ ok: false, error: "It has already gone to the Trash." })
    expect(n.action?.label).toBe("Undo")
  })

  it("says what is back where it was is back, and offers and ends nothing", async () => {
    const onUndone = vi.fn()
    bridge.undo_trash.mockResolvedValue({ ok: false, back: true, error: "It is back where it was." })
    offerUndo({ text: "gone", token: "t1", onUndone })
    runAction(notice("t1")!.id)
    await settle()
    const n = notice("t1")!
    expect(n.kind).toBe("done")
    expect(n.text).toBe("It is back where it was.")
    expect(n.action).toBeUndefined()
    expect(onUndone).not.toHaveBeenCalled()
    dismiss("undo:t1")
    await settle()
    expect(bridge.end_trash).not.toHaveBeenCalled()
  })

  it("finishes an Undo that got stuck by ending it at once, then puts the screen back", async () => {
    bridge.undo_trash.mockResolvedValue({
      ok: false,
      error: "It is being put back; it will be finished when the notice goes.",
      finishing: true,
    })
    const onUndone = vi.fn()
    offerUndo({ text: "gone", token: "t1", onUndone })
    runAction(notice("t1")!.id)
    await settle()
    expect(bridge.end_trash).toHaveBeenCalledWith("t1")
    expect(onUndone).toHaveBeenCalledTimes(1)
    expect(getNotices()).toHaveLength(0)
  })

  it("says why when an Undo that got stuck will not finish either", async () => {
    bridge.undo_trash.mockResolvedValue({ ok: false, error: "stuck", finishing: true })
    bridge.end_trash.mockResolvedValue({ ok: false, error: "The drive is not there" })
    const onUndone = vi.fn()
    offerUndo({ text: "gone", token: "t1", onUndone })
    runAction(notice("t1")!.id)
    await settle()
    expect(onUndone).not.toHaveBeenCalled()
    const n = notice("t1")!
    expect(n.kind).toBe("error")
    expect(n.text).toBe("The drive is not there")
    expect(n.action).toBeUndefined()
  })

  it("reports a screen that fails to put itself back, rather than throwing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    bridge.undo_trash.mockResolvedValue({ ok: true, kind: "take" })
    offerUndo({
      text: "gone",
      token: "t1",
      onUndone: async () => {
        throw new Error("the bridge blinked")
      },
    })
    runAction(notice("t1")!.id)
    await settle()
    expect(log).toHaveBeenCalledTimes(1)
  })
})

describe("offerCropUndo", () => {
  it("offers the crop's Undo, saying the uncut take went", () => {
    offerCropUndo("Pałyn 5", { undo: "t1" }, vi.fn(), "rehearsal")
    expect(notice("t1")?.text).toBe("“Pałyn 5” is cropped. The uncut take went to the Trash.")
    expect(notice("t1")?.action?.label).toBe("Undo")
  })

  it("says where a click take now starts when the crop moved its start to a bar", () => {
    // Python cuts a click take from the bar line at or before the region's
    // start, and says where it cut.
    offerCropUndo("Pałyn 5", { undo: "t2", start_sec: 1.875, end_sec: 9.375 }, vi.fn(), "rehearsal", 3)
    expect(notice("t2")?.text).toBe(
      "“Pałyn 5” is cropped from the bar at 0:01. The uncut take went to the Trash."
    )
    // Cut where it was asked, there is nothing more to say.
    offerCropUndo("Pałyn 6", { undo: "t3", start_sec: 3, end_sec: 9 }, vi.fn(), "rehearsal", 3)
    expect(notice("t3")?.text).toBe("“Pałyn 6” is cropped. The uncut take went to the Trash.")
  })

  it("says it in the warning too, when there is no Undo", () => {
    offerCropUndo("Pałyn 5", { undo: null, error: "No space left", start_sec: 1.875 }, vi.fn(), "rehearsal", 3)
    expect(getNotices().find((x) => x.key === "rehearsal")!.text).toBe(
      "“Pałyn 5” is cropped from the bar at 0:01, but the uncut take could not be moved out of the way, so the crop cannot be undone: No space left."
    )
  })

  it("warns, with no Undo, when the uncut take could not wait for one", () => {
    offerCropUndo(
      "Pałyn 5",
      { undo: null, error: "No space left on device, and is still at /rec/old/05 (before crop)" },
      vi.fn(),
      "rehearsal"
    )
    const n = getNotices().find((x) => x.key === "rehearsal")!
    expect(n.kind).toBe("warning")
    // Python's words after a colon: a folder named "(before crop)" inside
    // brackets of our own would read as one.
    expect(n.text).toBe(
      "“Pałyn 5” is cropped, but the uncut take could not be moved out of the way, so the crop cannot be undone: No space left on device, and is still at /rec/old/05 (before crop)."
    )
    expect(n.action).toBeUndefined()
    // A warning: it stays until it is closed.
    expect(lifetime(n)).toBeNull()
  })
})

describe("endedByPython", () => {
  // What Python ended on its own while it removed or cropped something
  // (api.py _end_before, a call's "ended"): those notices go, as their Undo
  // would only be told it has gone. Three at a time, as the corner holds them.
  const offer = (token: string) => offerUndo({ text: token, token, onUndone: vi.fn() })
  const offered = () =>
    getNotices()
      .map((n) => n.key)
      .sort()
  const ended = () => bridge.end_trash.mock.calls.map((c) => c[0]).sort()

  it("lets go the offers Python names, each ending as its notice goes", async () => {
    offer("take-5")
    offer("crop-5")
    offer("crop-7")
    endedByPython(["take-5", "crop-5"])
    await settle()
    expect(offered()).toEqual(["undo:crop-7"])
    // Python has no entry for them now: end_trash answers ok for one.
    expect(ended()).toEqual(["crop-5", "take-5"])
  })

  it("leaves every offer when Python ended nothing, or did not say", async () => {
    offer("take-5")
    endedByPython([])
    endedByPython(undefined)
    await settle()
    expect(offered()).toEqual(["undo:take-5"])
    expect(bridge.end_trash).not.toHaveBeenCalled()
  })

  it("passes over a token with no notice on screen", async () => {
    offer("take-5")
    endedByPython(["somewhere-else"])
    await settle()
    expect(offered()).toEqual(["undo:take-5"])
    expect(bridge.end_trash).not.toHaveBeenCalled()
  })

  it("takes away what was said of an end that failed, once Python has ended it after all", async () => {
    bridge.end_trash.mockResolvedValueOnce({ ok: false, error: "Permission denied" })
    offer("take-5")
    dismiss("undo:take-5")
    await settle()
    expect(notice("take-5")?.text).toBe("Permission denied")
    endedByPython(["take-5"])
    await settle()
    expect(offered()).toEqual([])
    expect(bridge.end_trash).toHaveBeenCalledTimes(1)
  })

  it("lets go an offer made again after a refused Undo", async () => {
    bridge.undo_trash.mockResolvedValue({ ok: false, error: "Wait until the crop is done." })
    offer("take-5")
    runAction(notice("take-5")!.id)
    await settle()
    expect(notice("take-5")?.action?.label).toBe("Undo")
    endedByPython(["take-5"])
    await settle()
    expect(offered()).toEqual([])
    expect(ended()).toEqual(["take-5"])
  })
})

describe("endEveryOffer", () => {
  const offer = (token: string) => offerUndo({ text: token, token, onUndone: vi.fn() })
  const offered = () =>
    getNotices()
      .map((n) => n.key)
      .sort()
  const ended = () => bridge.end_trash.mock.calls.map((c) => c[0]).sort()

  it("ends them all at once, as a switch of the recordings folder does", async () => {
    offer("take-5")
    offer("other")
    endEveryOffer()
    await settle()
    expect(offered()).toEqual([])
    expect(ended()).toEqual(["other", "take-5"])
  })

  it("leaves what was said that is not an offer: an end that failed, another screen's notice", async () => {
    bridge.end_trash.mockResolvedValueOnce({ ok: false, error: "Permission denied" })
    offer("old")
    dismiss("undo:old")
    await settle()
    offerCropUndo("Pałyn 7", { undo: null, error: "Disk full" }, vi.fn(), "rehearsal")
    offer("take-5")
    endEveryOffer()
    await settle()
    expect(offered()).toEqual(["rehearsal", "undo:old"])
    expect(ended()).toEqual(["old", "take-5"])
  })
})

describe("draftMovedTo", () => {
  const take = {
    ok: true as const,
    take_number: 3,
    temp_dir: "/rec/Jam/_drafts/take 3",
    duration_sec: 4,
    tracks: [{ name: "Gtr", file: "/rec/Jam/_drafts/take 3/Gtr.wav" }],
    notes: [{ name: "Keys", file: "/rec/Jam/_drafts/take 3/Keys.mid", port: "K", after: null }],
  }

  it("moves the take's files to the folder its Undo put it back in", () => {
    const moved = draftMovedTo(take, "/rec/Jam renamed/_drafts/take 3")
    expect(moved.temp_dir).toBe("/rec/Jam renamed/_drafts/take 3")
    expect(moved.tracks).toEqual([{ name: "Gtr", file: "/rec/Jam renamed/_drafts/take 3/Gtr.wav" }])
    expect(moved.notes?.[0].file).toBe("/rec/Jam renamed/_drafts/take 3/Keys.mid")
    expect(moved.notes?.[0].port).toBe("K")
  })

  it("follows Windows paths as Python spells them", () => {
    const win = {
      ...take,
      temp_dir: "C:\\rec\\Jam\\_drafts\\take 3",
      tracks: [{ name: "Gtr", file: "C:\\rec\\Jam\\_drafts\\take 3\\Gtr.wav" }],
      notes: undefined,
    }
    const moved = draftMovedTo(win, "C:\\rec\\Jam renamed\\_drafts\\take 3")
    expect(moved.tracks[0].file).toBe("C:\\rec\\Jam renamed\\_drafts\\take 3\\Gtr.wav")
    expect(moved.notes).toBeUndefined()
  })

  it("leaves the take as it was when it came back where it went from, or nothing says where", () => {
    expect(draftMovedTo(take, take.temp_dir)).toEqual(take)
    expect(draftMovedTo(take, undefined)).toEqual(take)
  })

  it("leaves a file that is not in the take's folder, and one whose folder only starts the same", () => {
    const odd = {
      ...take,
      tracks: [
        { name: "Gtr", file: "/elsewhere/Gtr.wav" },
        { name: "Bass", file: "/rec/Jam/_drafts/take 3b/Bass.wav" },
      ],
    }
    expect(draftMovedTo(odd, "/rec/New/_drafts/take 3").tracks).toEqual(odd.tracks)
  })
})

describe("keptText", () => {
  it("names the one folder left where it was", () => {
    expect(keptText(["/old/_deleting/3"])).toBe(
      "Something that was being removed stays in “/old/_deleting/3”: it could not be put back or moved to the Trash."
    )
  })

  it("counts several, and names each", () => {
    expect(keptText(["/old/_deleting/3", "/old/_deleting/4"])).toBe(
      "2 things that were being removed stay where they were: “/old/_deleting/3”, “/old/_deleting/4”. They could not be put back or moved to the Trash."
    )
  })

  it("says the system's Trash, or the folder where there is none", () => {
    setSystem("windows")
    expect(keptText(["/a"])).toContain("moved to the Recycle Bin.")
    setDeletionKind({ kind: "folder", folder: "_deleted" })
    expect(keptText(["/a"])).toContain("moved to the _deleted folder.")
  })
})
