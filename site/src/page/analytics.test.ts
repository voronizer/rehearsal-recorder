import { describe, expect, it } from "vitest"
import { onlyOnSite } from "./analytics"

describe("onlyOnSite", () => {
  it("keeps a visit to reha.stream", () => {
    const event = { url: "https://reha.stream/#faq" }
    expect(onlyOnSite(event)).toBe(event)
  })
  it("drops a visit to a preview, the vercel.app address or a local build", () => {
    expect(onlyOnSite({ url: "https://reha-stream-a1b2c3-voronizer-2324.vercel.app/" })).toBeNull()
    expect(onlyOnSite({ url: "https://reha-stream.vercel.app/" })).toBeNull()
    expect(onlyOnSite({ url: "http://127.0.0.1:4179/" })).toBeNull()
  })
  it("goes by the host, not by the address containing the name", () => {
    expect(onlyOnSite({ url: "https://reha.stream.example.com/" })).toBeNull()
    expect(onlyOnSite({ url: "https://example.com/?from=reha.stream" })).toBeNull()
  })
})
