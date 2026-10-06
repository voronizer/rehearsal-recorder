import { describe, expect, it } from "vitest"
import { isWindows } from "./os"

describe("isWindows", () => {
  it("is true on Windows, by platform or by user agent", () => {
    expect(isWindows("Win32", "")).toBe(true)
    expect(isWindows("", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(true)
  })
  it("is false on a Mac and on Linux", () => {
    expect(isWindows("MacIntel", "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)")).toBe(false)
    expect(isWindows("Linux x86_64", "")).toBe(false)
  })
  it("goes by the platform when it names one, and by the user agent only when not", () => {
    expect(isWindows("MacIntel", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(false)
  })
})
