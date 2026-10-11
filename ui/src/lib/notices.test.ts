import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  ACTION_MS,
  DONE_MS,
  MAX_NOTICES,
  dismiss,
  dismissNotice,
  getNotices,
  lifetime,
  notify,
  runAction,
  undoLatest,
  type Notice,
} from "@/lib/notices"
import { isUndoKey } from "@/hooks/useUndoKey"

// The store is the app's one list; start every test from an empty corner.
beforeEach(() => {
  for (const n of getNotices()) dismissNotice(n.id)
})

const idOf = (key: string) => getNotices().find((n) => n.key === key)!.id

describe("onGone", () => {
  it("runs once when a notice is closed, however often it is closed", () => {
    const onGone = vi.fn()
    notify({ key: "a", kind: "done", text: "one", onGone })
    const id = idOf("a")
    dismissNotice(id)
    dismissNotice(id)
    expect(onGone).toHaveBeenCalledTimes(1)
  })

  it("runs once when the notice is dismissed by its key", () => {
    const onGone = vi.fn()
    notify({ key: "a", kind: "done", text: "one", onGone })
    dismiss("a")
    dismiss("a")
    expect(onGone).toHaveBeenCalledTimes(1)
  })

  it("runs once when a notice under the same key replaces it, and not again later", () => {
    const first = vi.fn()
    const second = vi.fn()
    notify({ key: "a", kind: "done", text: "one", onGone: first })
    const firstId = idOf("a")
    notify({ key: "a", kind: "done", text: "two", onGone: second })
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
    // The one that went cannot go again.
    dismissNotice(firstId)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
  })

  it("runs once for the oldest when a fourth notice pushes it out", () => {
    // Three stay on screen; the fourth takes the first one's place.
    expect(MAX_NOTICES).toBe(3)
    const spies = [vi.fn(), vi.fn(), vi.fn(), vi.fn()]
    for (const [i, onGone] of spies.entries()) {
      notify({ key: `k${i}`, kind: "done", text: `${i}`, onGone })
    }
    expect(spies[0]).toHaveBeenCalledTimes(1)
    for (const onGone of spies.slice(1)) expect(onGone).not.toHaveBeenCalled()
    expect(getNotices().map((n) => n.key)).toEqual(["k1", "k2", "k3"])
  })

  it("does not run when the notice's action runs", () => {
    const onGone = vi.fn()
    const run = vi.fn()
    notify({ key: "a", kind: "done", text: "one", action: { label: "Undo", run }, onGone })
    runAction(idOf("a"))
    expect(run).toHaveBeenCalledTimes(1)
    expect(onGone).not.toHaveBeenCalled()
    expect(getNotices()).toHaveLength(0)
  })

  it("is called after the store is committed, so a callback sees the new list", () => {
    const seen: string[][] = []
    const onGone = () => seen.push(getNotices().map((n) => n.text))
    notify({ key: "a", kind: "done", text: "old", onGone })
    notify({ key: "a", kind: "done", text: "new" })
    expect(seen).toEqual([["new"]])

    seen.length = 0
    dismiss("a")
    notify({ key: "b", kind: "done", text: "closed", onGone })
    dismissNotice(idOf("b"))
    expect(seen).toEqual([[]])
  })

  it("lets a callback raise a notice of its own", () => {
    notify({
      key: "a",
      kind: "done",
      text: "one",
      onGone: () => notify({ key: "b", kind: "error", text: "it failed" }),
    })
    dismiss("a")
    expect(getNotices().map((n) => n.key)).toEqual(["b"])
  })
})

describe("runAction", () => {
  it("removes the notice first, then runs the action, which may raise another", () => {
    let listedWhileRunning: string[] = []
    notify({
      key: "a",
      kind: "done",
      text: "gone",
      action: {
        label: "Undo",
        run: () => {
          listedWhileRunning = getNotices().map((n) => n.key)
          notify({ key: "a", kind: "error", text: "could not undo" })
        },
      },
    })
    runAction(idOf("a"))
    expect(listedWhileRunning).toEqual([])
    expect(getNotices().map((n) => n.text)).toEqual(["could not undo"])
  })

  it("runs the action once, however often the button is pressed", () => {
    const run = vi.fn()
    notify({ key: "a", kind: "done", text: "gone", action: { label: "Undo", run } })
    const id = idOf("a")
    runAction(id)
    runAction(id)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it("does nothing for a notice with no action, and leaves it up", () => {
    notify({ key: "a", kind: "done", text: "plain" })
    runAction(idOf("a"))
    expect(getNotices()).toHaveLength(1)
  })
})

describe("undoLatest", () => {
  it("runs the newest action and leaves the older notice with its own", () => {
    const first = vi.fn()
    const second = vi.fn()
    notify({ key: "a", kind: "done", text: "one", action: { label: "Undo", run: first } })
    notify({ key: "b", kind: "done", text: "two", action: { label: "Undo", run: second } })
    expect(undoLatest()).toBe(true)
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
    expect(getNotices().map((n) => n.key)).toEqual(["a"])
    // The older one answers the next press.
    expect(undoLatest()).toBe(true)
    expect(first).toHaveBeenCalledTimes(1)
  })

  it("is false when no notice has an action", () => {
    expect(undoLatest()).toBe(false)
    notify({ key: "a", kind: "done", text: "plain" })
    expect(undoLatest()).toBe(false)
    expect(getNotices()).toHaveLength(1)
  })

  it("finds the newest action behind a plain notice raised after it", () => {
    const run = vi.fn()
    notify({ key: "a", kind: "done", text: "one", action: { label: "Undo", run } })
    notify({ key: "b", kind: "error", text: "something failed" })
    expect(undoLatest()).toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
    // The plain notice is untouched.
    expect(getNotices().map((n) => n.key)).toEqual(["b"])
  })
})

describe("lifetime", () => {
  const notice = (over: Partial<Notice>): Notice => ({
    id: 1,
    key: "k",
    kind: "done",
    text: "t",
    ...over,
  })
  const action = { label: "Undo", run: () => {} }

  it("is DONE_MS for a plain done notice", () => {
    expect(lifetime(notice({ kind: "done" }))).toBe(DONE_MS)
  })

  it("is nothing, so it stays until closed, for a plain warning or error", () => {
    expect(lifetime(notice({ kind: "warning" }))).toBeNull()
    expect(lifetime(notice({ kind: "error" }))).toBeNull()
  })

  it("is ACTION_MS, 10 s, for a notice with an action, whatever its kind", () => {
    expect(ACTION_MS).toBe(10000)
    for (const kind of ["done", "warning", "error"] as const) {
      expect(lifetime(notice({ kind, action }))).toBe(ACTION_MS)
    }
  })
})

describe("isUndoKey", () => {
  const press = (over: Partial<Parameters<typeof isUndoKey>[0]>) => ({
    key: "z",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...over,
  })

  it("is the Command key and Z on a Mac", () => {
    expect(isUndoKey(press({ metaKey: true }), "mac")).toBe(true)
  })

  it("is the Control key and Z on Windows and elsewhere", () => {
    expect(isUndoKey(press({ ctrlKey: true }), "windows")).toBe(true)
    expect(isUndoKey(press({ ctrlKey: true }), "other")).toBe(true)
  })

  it("is not Ctrl+Z on a Mac, nor Command+Z (Meta) anywhere else", () => {
    expect(isUndoKey(press({ ctrlKey: true }), "mac")).toBe(false)
    expect(isUndoKey(press({ metaKey: true }), "windows")).toBe(false)
    expect(isUndoKey(press({ metaKey: true }), "other")).toBe(false)
  })

  it("is not Z alone", () => {
    expect(isUndoKey(press({}), "mac")).toBe(false)
    expect(isUndoKey(press({}), "windows")).toBe(false)
  })

  it("is not redo, Shift with the key", () => {
    expect(isUndoKey(press({ metaKey: true, shiftKey: true }), "mac")).toBe(false)
    expect(isUndoKey(press({ ctrlKey: true, shiftKey: true }), "windows")).toBe(false)
  })

  it("is not with Alt, whatever the case of the letter", () => {
    expect(isUndoKey(press({ key: "Z", metaKey: true, altKey: true }), "mac")).toBe(false)
    expect(isUndoKey(press({ key: "Z", ctrlKey: true, altKey: true }), "windows")).toBe(false)
  })

  it("reads a capital Z as Z (Caps Lock)", () => {
    expect(isUndoKey(press({ key: "Z", metaKey: true }), "mac")).toBe(true)
  })

  it("finds the key by its place when the layout types another script", () => {
    // A Russian or Belarusian layout: the key is я, but it is the Z key.
    expect(isUndoKey(press({ key: "я", code: "KeyZ", metaKey: true }), "mac")).toBe(true)
    expect(isUndoKey(press({ key: "я", code: "KeyZ", ctrlKey: true }), "windows")).toBe(true)
  })

  it("lets a Latin letter win over the place (AZERTY types another letter there)", () => {
    expect(isUndoKey(press({ key: "x", code: "KeyZ", metaKey: true }), "mac")).toBe(false)
  })

  it("is not another key, by place or by letter", () => {
    expect(isUndoKey(press({ key: "я", code: "KeyY", metaKey: true }), "mac")).toBe(false)
    expect(isUndoKey(press({ key: "y", code: "KeyY", metaKey: true }), "mac")).toBe(false)
  })
})
