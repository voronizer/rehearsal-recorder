import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { unstable_readConfig } from "wrangler"

// wrangler.jsonc as wrangler itself reads it for each environment. In CI
// wrangler takes a domain from whichever Worker has it, without asking: if
// the preview's environment ever came with reha.stream, a pull request's
// preview would become the live site, and if the site's own lost it, the
// release would take reha.stream off the site. Wrangler only warns, so
// this test is what stops it.

const config = fileURLToPath(new URL("../wrangler.jsonc", import.meta.url))
const read = (env: string | undefined) => unstable_readConfig({ config, env }, {})

describe("wrangler.jsonc", () => {
  it("puts the site at reha.stream and nowhere else", () => {
    const site = read(undefined)
    expect(site.name).toBe("reha-stream")
    expect(site.routes).toEqual([{ pattern: "reha.stream", custom_domain: true }])
    expect(site.route).toBeUndefined()
    expect(site.workers_dev).toBe(false)
    expect(site.preview_urls).toBe(false)
  })

  it("keeps previews in a Worker of their own, with no address of its own", () => {
    const preview = read("preview")
    expect(preview.name).toBe("reha-stream-preview")
    expect(preview.routes ?? []).toEqual([])
    expect(preview.route).toBeUndefined()
    expect(preview.workers_dev).toBe(false)
    expect(preview.preview_urls).toBe(true)
  })

  it("serves the same files the same way in both", () => {
    expect(read("preview").assets).toEqual(read(undefined).assets)
    expect(read(undefined).assets).toEqual({
      directory: "./dist",
      html_handling: "auto-trailing-slash",
      not_found_handling: "404-page",
    })
  })
})
