import { describe, expect, it } from "vitest"
import html from "../../index.html?raw"
import { MAC_ZIP, REPO, WINDOWS_ZIP } from "../page/links"
import {
  DESCRIPTION,
  OG_IMAGE,
  SITE_URL,
  articleJsonLd,
  fillPage,
  jsonLdText,
  notFoundNoscriptHtml,
  noscriptHtml,
  pageHeadHtml,
  pageUrl,
  robotsTxt,
  sitemapXml,
  softwareJsonLd,
} from "./seo"

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

describe("notFoundNoscriptHtml", () => {
  it("says there is nothing here and links the main page", () => {
    const html = notFoundNoscriptHtml({ title: "Nothing <here>", lede: "No page at this address." })
    expect(html).toContain("<h1>Nothing &lt;here&gt;</h1>")
    expect(html).toContain("No page at this address.")
    expect(html).toContain('<a href="/">Go to the main page</a>')
  })
})

describe("robots and sitemap", () => {
  it("let every crawler in", () => {
    expect(robotsTxt()).toBe("User-agent: *\nAllow: /\n\nSitemap: https://reha.stream/sitemap.xml\n")
  })

  it("lists the main page, the page of stories and the four stories", () => {
    const xml = sitemapXml(["/", "/stories", "/stories/digital-mixer"])
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/)
    expect([...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1])).toEqual([
      "https://reha.stream/",
      "https://reha.stream/stories",
      "https://reha.stream/stories/digital-mixer",
    ])
  })
})

describe("pageUrl", () => {
  it("gives a page's whole address, with no slash at the end but the main page's", () => {
    expect(pageUrl("/")).toBe(SITE_URL)
    expect(pageUrl("/stories")).toBe("https://reha.stream/stories")
    expect(pageUrl("/stories/metronome")).toBe("https://reha.stream/stories/metronome")
  })
})

describe("pageHeadHtml", () => {
  const story = {
    path: "/stories/metronome",
    title: "When your drummer hates the metronome · РЭХА",
    description: "Our drummer hates the click.",
    kind: "article" as const,
    jsonLd: { "@type": "Article" },
  }
  const tag = (html: string, attr: string, name: string) =>
    html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`))?.[1]

  it("writes a page's head for search engines and chats", () => {
    const html = pageHeadHtml(story)
    expect(html).toContain("<title>When your drummer hates the metronome · РЭХА</title>")
    expect(tag(html, "name", "description")).toBe("Our drummer hates the click.")
    expect(html).toContain('<link rel="canonical" href="https://reha.stream/stories/metronome" />')
    expect(tag(html, "property", "og:type")).toBe("article")
    expect(tag(html, "property", "og:site_name")).toBe("РЭХА")
    expect(tag(html, "property", "og:url")).toBe("https://reha.stream/stories/metronome")
    expect(tag(html, "property", "og:title")).toBe(story.title)
    expect(tag(html, "property", "og:description")).toBe(story.description)
    expect(tag(html, "property", "og:image")).toBe(OG_IMAGE)
    expect(tag(html, "property", "og:image:width")).toBe("1200")
    expect(tag(html, "property", "og:image:height")).toBe("630")
    expect(tag(html, "property", "og:image:alt")).toBe("РЭХА: the rehearsal screen, playing a take")
    expect(tag(html, "name", "twitter:card")).toBe("summary_large_image")
    expect(html.match(/<script type="application\/ld\+json">/g)).toHaveLength(1)
    expect(pageHeadHtml({ ...story, kind: "website", jsonLd: null })).not.toContain("ld+json")
  })

  it("escapes what a page's words could break", () => {
    const html = pageHeadHtml({
      ...story,
      title: "R&B <live>",
      description: 'the “bridge” and "outro"',
      jsonLd: { headline: "</script><b>" },
    })
    expect(html).toContain("<title>R&amp;B &lt;live&gt;</title>")
    expect(tag(html, "name", "description")).toBe("the “bridge” and &quot;outro&quot;")
    expect(html).not.toContain("</script><b>")
  })
})

describe("articleJsonLd", () => {
  it("says a story is an Article by Alex, published by the app", () => {
    const url = "https://reha.stream/stories/metronome"
    expect(
      articleJsonLd({ title: "When your drummer hates the metronome", description: "Our drummer.", date: "2026-10-25", url })
    ).toEqual({
      "@context": "https://schema.org",
      "@type": "Article",
      headline: "When your drummer hates the metronome",
      description: "Our drummer.",
      datePublished: "2026-10-25",
      url,
      mainEntityOfPage: url,
      image: OG_IMAGE,
      inLanguage: "en",
      author: { "@type": "Person", name: "Alex" },
      publisher: { "@type": "Organization", name: "РЭХА", url: SITE_URL },
    })
  })
})

// The page's title and description are written out three times: for search
// engines, for chats, and in the JSON-LD. A change to one has to reach all.
describe("index.html", () => {
  const meta = (attr: string, name: string) =>
    html.match(new RegExp(`<meta\\s+${attr}="${name}"\\s+content="([^"]*)"`))?.[1]
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1]

  it("tells chats what it tells search engines", () => {
    expect(title).toBeTruthy()
    expect(meta("property", "og:title")).toBe(title)
    expect(meta("name", "description")).toBe(DESCRIPTION)
    expect(meta("property", "og:description")).toBe(DESCRIPTION)
  })
})

describe("fillPage", () => {
  const template = "<head>\n<!--head-->\n</head><div><!--body--></div>"

  it("puts a page's head and words into the template as they are", () => {
    const body = "<p>$600, $$, $& and $' stay as written</p>"
    expect(fillPage(template, "<title>T</title>", body)).toBe(
      `<head>\n<title>T</title>\n</head><div>${body}</div>`
    )
  })

  it("fails on a template without its places, or with one twice", () => {
    expect(() => fillPage("<div><!--body--></div>", "", "")).toThrow("stories.html has no <!--head-->")
    expect(() => fillPage(`${template}<!--body-->`, "", "")).toThrow("stories.html has <!--body--> twice")
  })
})
