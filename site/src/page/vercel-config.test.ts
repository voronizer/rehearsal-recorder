import { describe, expect, it } from "vitest"
import raw from "../../vercel-config.json?raw"
import { MAC_ZIP, WINDOWS_ZIP } from "./links"

type Route = { src: string; status?: number; headers?: Record<string, string>; continue?: boolean }
const config: { version: number; routes: Route[] } = JSON.parse(raw)
const route = (path: string) => config.routes.find((r) => new RegExp(r.src).test(path))

describe("vercel-config.json", () => {
  it("is a Build Output API v3 config", () => {
    expect(config.version).toBe(3)
  })
  it("sends /mac and /windows to the latest zips, for now", () => {
    for (const [path, zip] of [
      ["/mac", MAC_ZIP],
      ["/mac/", MAC_ZIP],
      ["/windows", WINDOWS_ZIP],
      ["/windows/", WINDOWS_ZIP],
    ]) {
      expect(route(path)).toMatchObject({ status: 307, headers: { Location: zip } })
    }
  })
  it("leaves other addresses that start the same alone", () => {
    expect(route("/macos")).toBeUndefined()
    expect(route("/mac/x")).toBeUndefined()
    expect(route("/windowsx")).toBeUndefined()
  })
  it("caches the build's hashed files for a year, and nothing else", () => {
    expect(route("/assets/index-Bx1y2z3.js")).toMatchObject({
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
      continue: true,
    })
    expect(route("/")).toBeUndefined()
    expect(route("/index.html")).toBeUndefined()
    expect(route("/stage.html")).toBeUndefined()
  })
})
