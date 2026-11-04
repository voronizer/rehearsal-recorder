import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { unstable_readConfig } from "wrangler"

// wrangler.jsonc as wrangler itself reads it. If the site's Worker lost
// reha.stream, the release would take the address off the site; wrangler
// only warns, so this test is what stops it.

const config = fileURLToPath(new URL("../wrangler.jsonc", import.meta.url))
const read = () => unstable_readConfig({ config }, {})

describe("wrangler.jsonc", () => {
  it("puts the site at reha.stream and nowhere else", () => {
    const site = read()
    expect(site.name).toBe("reha-stream")
    expect(site.routes).toEqual([{ pattern: "reha.stream", custom_domain: true }])
    expect(site.route).toBeUndefined()
    expect(site.workers_dev).toBe(false)
    expect(site.preview_urls).toBe(false)
  })

  it("serves the build's files", () => {
    expect(read().assets).toEqual({
      directory: "./dist",
      html_handling: "auto-trailing-slash",
      not_found_handling: "404-page",
    })
  })
})
