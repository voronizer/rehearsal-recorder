import { describe, expect, it } from "vitest"
import { beaconFor } from "./analytics"

describe("beaconFor", () => {
  it("counts a visit to reha.stream with the site's token", () => {
    expect(beaconFor("reha.stream", "abc123")).toEqual({
      src: "https://static.cloudflareinsights.com/beacon.min.js",
      data: '{"token":"abc123"}',
    })
  })
  it("counts nothing on a preview, the www address or a local build", () => {
    expect(beaconFor("pr-12-reha-stream-preview.example.workers.dev", "abc123")).toBeNull()
    expect(beaconFor("www.reha.stream", "abc123")).toBeNull()
    expect(beaconFor("127.0.0.1", "abc123")).toBeNull()
    expect(beaconFor("localhost", "abc123")).toBeNull()
  })
  it("goes by the whole host, not by a host containing the name", () => {
    expect(beaconFor("reha.stream.example.com", "abc123")).toBeNull()
    expect(beaconFor("evilreha.stream", "abc123")).toBeNull()
  })
  it("counts nothing without a token", () => {
    expect(beaconFor("reha.stream", undefined)).toBeNull()
    expect(beaconFor("reha.stream", "")).toBeNull()
    expect(beaconFor("reha.stream", "  ")).toBeNull()
  })
})
