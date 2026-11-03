import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

// The interface's icons are the app's own drawings (packaging/), copied:
// a tab and the window show them, and a drawing changed in one place only
// would leave the other behind.
const read = (path: string) => readFileSync(new URL(path, import.meta.url))

describe("the interface's icons", () => {
  it("carries the small drawing, since a tab shows it at 16 px", () => {
    expect(read("../index.html").toString()).toContain('rel="icon"')
    expect(read("../public/favicon.svg").equals(read("../../packaging/icon-small.svg"))).toBe(true)
  })

  it("and the full one, for where the window shows it large", () => {
    expect(read("../public/logo.svg").equals(read("../../packaging/icon.svg"))).toBe(true)
  })
})
