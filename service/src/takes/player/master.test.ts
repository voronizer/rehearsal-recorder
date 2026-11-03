import { afterEach, expect, test, vi } from "vitest"
import { keepMaster, keptMaster } from "./master"

/** A browser's storage for this site, as far as Master's level needs it. */
function storage(start: Record<string, string> = {}) {
  const kept = new Map(Object.entries(start))
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => kept.get(k) ?? null,
    setItem: (k: string, v: string) => void kept.set(k, v),
  })
  return kept
}

afterEach(() => {
  vi.unstubAllGlobals()
})

test("Master's level is kept on this device, and read back for the next take", () => {
  storage()
  expect(keptMaster()).toBe(1)
  keepMaster(0.4)
  expect(keptMaster()).toBe(0.4)
})

test("what is not a level in the storage reads as full, and a browser with no storage plays at full", () => {
  storage({ "reha.master": "loud" })
  expect(keptMaster()).toBe(1)
  storage({ "reha.master": "7" })
  expect(keptMaster()).toBe(1)
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw new Error("blocked")
    },
    setItem: () => {
      throw new Error("blocked")
    },
  })
  expect(keptMaster()).toBe(1)
  expect(() => keepMaster(0.5)).not.toThrow()
})
