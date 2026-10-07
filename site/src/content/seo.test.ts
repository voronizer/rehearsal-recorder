import { describe, expect, it } from "vitest"
import { MAC_ZIP, REPO, WINDOWS_ZIP } from "../page/links"
import { OG_IMAGE, SITE_URL, jsonLdText, noscriptHtml, robotsTxt, sitemapXml, softwareJsonLd } from "./seo"

describe("softwareJsonLd", () => {
  it("describes the app at the build's version", () => {
    expect(softwareJsonLd("0.11.0")).toMatchObject({
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "РЭХА",
      alternateName: "Rehearsal Recorder",
      softwareVersion: "0.11.0",
      operatingSystem: "macOS, Windows",
      applicationCategory: "MultimediaApplication",
      url: SITE_URL,
      image: OG_IMAGE,
      downloadUrl: [MAC_ZIP, WINDOWS_ZIP],
      license: "https://opensource.org/licenses/MIT",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    })
  })
})

describe("jsonLdText", () => {
  it("cannot end the script it sits in", () => {
    const text = jsonLdText({ name: "</script><b>x" })
    expect(text).not.toContain("<")
    expect(JSON.parse(text)).toEqual({ name: "</script><b>x" })
  })
})

describe("noscriptHtml", () => {
  it("says what the app is and links both downloads and the source", () => {
    const html = noscriptHtml({ title: "Multitrack <recording>", lede: "One track per musician." })
    expect(html).toContain("Multitrack &lt;recording&gt;")
    expect(html).toContain("One track per musician.")
    for (const href of [MAC_ZIP, WINDOWS_ZIP, REPO]) expect(html).toContain(`href="${href}"`)
  })
})

describe("robots and sitemap", () => {
  it("let every crawler in and name the one page", () => {
    expect(robotsTxt()).toBe("User-agent: *\nAllow: /\n\nSitemap: https://reha.stream/sitemap.xml\n")
    expect(sitemapXml()).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/)
    expect(sitemapXml()).toContain("<url><loc>https://reha.stream/</loc></url>")
  })
})
