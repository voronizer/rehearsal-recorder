import type { Page } from "@playwright/test"
import { test, expect } from "./fixtures.ts"

// Alex's stories: their page, each story, and the way to them. Each is
// written into its HTML at build time (the stories() plugin in
// vite.config.ts); here the preview server finds stories/x.html for
// /stories/x by itself, as Vercel does through vercel-config.json.

const STORIES = [
  ["digital-mixer", "Record your band's rehearsal from a digital mixer"],
  ["tempo-drift", "Find where your band speeds up, bar by bar"],
  ["metronome", "When your drummer hates the metronome"],
  ["record-rehearsal", "How to record a band rehearsal, with a track for each of us"],
]
const MIXER = "/stories/digital-mixer"
const onPlatform = (page: Page, platform: string) =>
  page.addInitScript((p) => Object.defineProperty(Navigator.prototype, "platform", { get: () => p }), platform)

test("Stories in the menu opens the page of stories, and a card its story", async ({ page }) => {
  await page.goto("/")
  await page.locator(".nav").getByRole("link", { name: "Stories", exact: true }).click()
  await expect(page).toHaveURL(/\/stories$/)
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("How our band records its rehearsals")
  await expect(page.locator(".tale-card h2")).toHaveText(STORIES.map(([, title]) => title))
  await page.locator(".tale-card").first().click()
  await expect(page).toHaveURL(new RegExp(`${MIXER}$`))
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(STORIES[0][1])
})

test("a link in a story opens the story it names", async ({ page }) => {
  await page.goto("/stories/tempo-drift")
  await page.getByRole("link", { name: "the mixer story" }).click()
  await expect(page).toHaveURL(new RegExp(`${MIXER}$`))
})

test("a chapter's address scrolls to its chapter", async ({ page }) => {
  await page.goto(`${MIXER}#the-gain`)
  const chapter = page.locator("#the-gain")
  await expect(chapter.getByRole("heading", { level: 2, name: "The gain" })).toBeInViewport()
  await expect(chapter.locator(".chap-head .n")).toHaveText("3")
})

test("the chapter's name stays in view while its text goes by", async ({ page }) => {
  await page.goto(MIXER)
  const chapter = page.locator("#a-channel-each")
  await chapter.evaluate((el) => window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top + 400))
  // The chapter's number and name, held 24 px from the top.
  const head = (await chapter.locator(".chap-head").boundingBox())!
  expect(Math.abs(head.y - 24)).toBeLessThanOrEqual(2)
  await expect(chapter.getByRole("heading", { level: 2 })).toBeInViewport()

  // Narrower than 1000 px, the name is over its text.
  await page.setViewportSize({ width: 900, height: 860 })
  await chapter.scrollIntoViewIfNeeded()
  const over = (await chapter.getByRole("heading", { level: 2 }).boundingBox())!
  const text = (await chapter.locator(".chap-body p").first().boundingBox())!
  expect(over.y + over.height).toBeLessThanOrEqual(text.y)
})

test("the story's chats and jokes are drawn as such", async ({ page }) => {
  await page.goto(MIXER)
  const say = page.locator(".chat .say").first()
  await expect(say.locator(".who")).toHaveText("Guitarist")
  await expect(say.locator("p")).toHaveText("You came in late in the second bar.")
  // Alex's own lines on the right, with no name.
  const me = page.locator(".chat .say.me").first()
  await expect(me.locator("p")).toHaveText("No, that was the third.")
  await expect(me.locator(".who")).toBeHidden()
  const chat = (await page.locator(".chat").first().boundingBox())!
  const bubble = (await me.locator("p").boundingBox())!
  expect(Math.abs(bubble.x + bubble.width - (chat.x + chat.width))).toBeLessThanOrEqual(1)
  await expect(page.locator("p.joke").first()).toHaveText("What happens at the mixer stays at the mixer.")
})

for (const [platform, mine, other] of [
  ["Win32", "Windows", "macOS"],
  ["MacIntel", "macOS", "Windows"],
]) {
  test(`the story's downloads put the visitor's system first: ${platform}`, async ({ page }) => {
    await onPlatform(page, platform)
    await page.goto(MIXER)
    const get = page.locator(".tale-get")
    await expect(get.locator(".btn:visible")).toHaveText(`Download for ${mine}`)
    await expect(get.locator(".more:visible")).toHaveText(`Download for ${other}`)
  })
}

test("the menu goes to the main page's parts from a story", async ({ page }) => {
  await page.goto(MIXER)
  const menu = page.locator(".nav")
  for (const [name, href] of [
    ["How it works", "/#how"],
    ["FAQ", "/#faq"],
    ["Stories", "/stories"],
    ["Download", "/#top"],
  ])
    await expect(menu.getByRole("link", { name, exact: true })).toHaveAttribute("href", href)
  await expect(menu.locator(".menu a")).toHaveText(["How it works", "FAQ", "Stories", "GitHub", "Download"])
  await expect(page.locator(".ribbon")).toHaveCount(0)
  await expect(page.getByText("Open source, under the MIT license.")).toBeVisible()
})

// Vercel's scripts themselves are only on Vercel; here they are missing files.
test("the new pages count their visits with Vercel's scripts", async ({ page }) => {
  for (const path of ["/stories", MIXER]) {
    await page.goto(path)
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://reha.stream${path}`)
    await expect(page.locator('script[src="/_vercel/insights/script.js"]')).toHaveCount(1)
    await expect(page.locator('script[src="/_vercel/speed-insights/script.js"]')).toHaveCount(1)
  }
})

test("the sitemap names the six pages", async ({ request }) => {
  const xml = await (await request.get("/sitemap.xml")).text()
  expect([...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1])).toEqual([
    "https://reha.stream/",
    "https://reha.stream/stories",
    ...STORIES.map(([slug]) => `https://reha.stream/stories/${slug}`),
  ])
})

// What a crawler reads: the whole story is in the HTML as the build wrote it.
test.describe("with script off", () => {
  test.use({ javaScriptEnabled: false })

  test("a story is all in its HTML", async ({ page }) => {
    await page.goto(MIXER)
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(STORIES[0][1])
    await expect(page.getByText("Alex, who plays bass in the band and wrote")).toBeVisible()
    await expect(page.getByText("You came in late in the second bar.")).toBeVisible()
    await expect(page.getByText("In the first chorus the baby woke up.")).toBeVisible()
    await expect(page.getByText("your singer gets every instrument on its own track to practise with at home.")).toBeVisible()
    await expect(page).toHaveTitle(`${STORIES[0][1]} · РЭХА`)
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      "We used to argue about which bar it was. Now we record each rehearsal from our Behringer XR18, a track per musician. How we do it, and what went wrong."
    )
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://reha.stream${MIXER}`)
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", "https://reha.stream/og.png")
    const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!)
    expect(ld).toMatchObject({
      "@type": "Article",
      headline: STORIES[0][1],
      datePublished: "2026-10-25",
      author: { name: "Alex" },
      publisher: { name: "РЭХА" },
    })
  })

  test("the page of stories is all in its HTML", async ({ page }) => {
    await page.goto("/stories")
    await expect(page.locator(".tale-card")).toHaveCount(4)
    for (const [slug, title] of STORIES)
      await expect(page.getByRole("link", { name: new RegExp(`^${title}`) })).toHaveAttribute("href", `/stories/${slug}`)
    await expect(page).toHaveTitle("Stories · РЭХА")
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      "How a band records its rehearsals with РЭХА, told by Alex, who plays bass in it and wrote the app."
    )
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://reha.stream/stories")
  })
})

test.describe("on a phone", () => {
  test.use({ isMobile: true, hasTouch: true })

  for (const [width, height] of [
    [390, 844],
    [320, 700],
  ]) {
    test(`at ${width} px a story and the page of stories fit`, async ({ page }) => {
      await page.setViewportSize({ width, height })
      for (const [path, title] of [
        [MIXER, STORIES[0][1]],
        ["/stories/record-rehearsal", STORIES[3][1]],
        ["/stories", "How our band records its rehearsals"],
      ]) {
        await page.goto(path)
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(title)
        expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBe(width)
      }
    })
  }
})
