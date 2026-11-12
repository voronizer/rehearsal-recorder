import { afterEach, expect, test, vi } from "vitest"
import { keepFold, keptFold } from "./menu"

/** A browser's storage for this site, as far as the menu's fold needs it. */
function storage(start: Record<string, string> = {}) {
  const kept = new Map(Object.entries(start))
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => kept.get(k) ?? null,
    setItem: (k: string, v: string) => void kept.set(k, v),
    removeItem: (k: string) => void kept.delete(k),
  })
  return kept
}

afterEach(() => {
  vi.unstubAllGlobals()
})

test("the menu is open where the browser keeps nothing, folded where it keeps the fold", () => {
  storage()
  expect(keptFold()).toBe(false)
  storage({ "reha.menu": "folded" })
  expect(keptFold()).toBe(true)
  storage({ "reha.menu": "open" })
  expect(keptFold()).toBe(false)
})

test("folding keeps the fold, and opening drops it", () => {
  const kept = storage()
  keepFold(true)
  expect(kept.get("reha.menu")).toBe("folded")
  expect(keptFold()).toBe(true)
  keepFold(false)
  expect(kept.has("reha.menu")).toBe(false)
  expect(keptFold()).toBe(false)
})

test("a browser with no storage opens the menu, and folding there throws nothing", () => {
  const fails = () => {
    throw new Error("no storage")
  }
  vi.stubGlobal("localStorage", { getItem: fails, setItem: fails, removeItem: fails })
  expect(keptFold()).toBe(false)
  expect(() => keepFold(true)).not.toThrow()
  expect(() => keepFold(false)).not.toThrow()
})
