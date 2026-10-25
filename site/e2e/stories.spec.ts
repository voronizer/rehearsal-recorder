import type { Locator, Page } from "@playwright/test"
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

test("each card on the page of stories opens with its band's chat", async ({ page }) => {
  await page.goto("/stories")
  const cards = page.locator(".tale-card")
  await expect(cards.locator(".say:first-child p")).toHaveText([
    "You came in late in the second bar.",
    "Hear that? We're rushing.",
    "Bloody hell.",
    "Are we recording?",
  ])
  for (let n = 0; n < 4; n++) {
    await expect(cards.nth(n).locator(".say")).toHaveCount(3)
    await expect(cards.nth(n).locator(".card-foot .fine")).toHaveText(/^\d+ min read$/)
  }
  // The bubbles in the page's own colour, on the card's grey.
  const bg = (el: Element) => getComputedStyle(el).backgroundColor
  expect(await cards.first().locator(".say:not(.me) p").first().evaluate(bg)).toBe(
    await page.locator("body").evaluate(bg)
  )
})

// The block right after the main page's first screen: the band's chat
// beside a few words, and the way to the story it comes from.
const opacity = (page: Page, n: number) =>
  page.locator("#stories .say").nth(n).evaluate((el) => Number(getComputedStyle(el).opacity))

/** A name over a line that the screen leaves out (Alex's, or the same
 *  person's again) but a screen reader still reads. */
async function expectUnseenName(who: Locator, name: string) {
  await expect(who).toHaveText(name)
  const box = (await who.boundingBox())!
  expect(box.width * box.height).toBeLessThanOrEqual(1)
}

test.describe("with Reduce motion", () => {
  test.use({ reducedMotion: "reduce" })

  test("the block sits between the first screen and the controller, and opens its story or all of them", async ({ page }) => {
    await page.goto("/")
    const block = page.locator("#stories")
    await expect(block.locator(".eyebrow")).toHaveText("Stories")
    // In red, as over the main page's heading.
    const red = await page.locator(".hero .eyebrow").evaluate((el) => getComputedStyle(el).color)
    await expect(block.locator(".eyebrow")).toHaveCSS("color", red)
    await expect(block.getByRole("heading", { level: 2 })).toHaveText("We used to argue about which bar it was.")
    await expect(block.locator(".copy p").nth(1)).toHaveText(
      "Then we started recording. Alex, who plays bass and wrote РЭХА, tells how our band does it, and what went wrong on the way."
    )
    const at = await page.evaluate(() => ({
      hero: document.querySelector(".hero")!.getBoundingClientRect().bottom,
      block: document.querySelector("#stories")!.getBoundingClientRect(),
      controller: document.querySelector("#controller")!.getBoundingClientRect().top,
    }))
    expect(at.block.top).toBeGreaterThanOrEqual(at.hero)
    expect(at.block.bottom).toBeLessThanOrEqual(at.controller)
    // The first two arguments of the mixer story, all there at once.
    await expect(block.locator(".say p")).toHaveText([
      "You came in late in the second bar.",
      "No, that was the third.",
      "Bloody hell, you're all playing it wrong!",
      "Let's change that bit in the chorus.",
      "Which bit?",
      "You know. That bit.",
    ])
    for (let n = 0; n < 6; n++) expect(await opacity(page, n)).toBe(1)
    const side = (await block.locator(".chat-side").boundingBox())!
    const me = block.locator(".say.me")
    const bubble = (await me.locator("p").boundingBox())!
    expect(Math.abs(bubble.x + bubble.width - (side.x + side.width))).toBeLessThanOrEqual(1)
    await expectUnseenName(me.locator(".who"), "Me")
    await expect(block.getByRole("link", { name: "More stories" })).toHaveAttribute("href", "/stories")
    await block.getByRole("link", { name: "Read the story" }).click()
    await expect(page).toHaveURL(new RegExp(`${MIXER}$`))
  })
})

test.describe("with motion", () => {
  test.use({ reducedMotion: "no-preference" })

  test("the block's lines come one at a time once it is in view", async ({ page }) => {
    await page.goto("/")
    await expect(page.locator("#stories .say")).toHaveCount(6)
    expect(await opacity(page, 0)).toBe(0)
    await page.locator("#stories .chat-side").scrollIntoViewIfNeeded()
    await expect.poll(() => opacity(page, 0)).toBe(1)
    expect(await opacity(page, 5)).toBeLessThan(1)
    await expect.poll(() => opacity(page, 5), { timeout: 10_000 }).toBe(1)
  })

  // A phone on its side is lower than the block, though not than a third of
  // its chat, which is what the lines wait for.
  test("on a phone on its side the block's lines still come", async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 })
    await page.goto("/")
    await page.locator("#stories .chat-side").scrollIntoViewIfNeeded()
    await expect.poll(() => opacity(page, 5), { timeout: 10_000 }).toBe(1)
  })

  // On a big screen the app's window fills the first screen, and the chat
  // is below it: its lines wait there for the visitor.
  test("on a big screen the block's lines wait until it is scrolled to", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto("/")
    await expect(page.locator("#stories .say")).toHaveCount(6)
    await page.waitForTimeout(1500)
    expect(await opacity(page, 0)).toBe(0)
    await page.locator("#stories .chat-side").scrollIntoViewIfNeeded()
    await expect.poll(() => opacity(page, 0)).toBe(1)
  })
})

test("on the narrowest phone the block fits, its words over its chat", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await page.goto("/")
  await expect(page.locator("#stories .say")).toHaveCount(6)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
  const copy = (await page.locator("#stories .copy").boundingBox())!
  const chat = (await page.locator("#stories .chat-side").boundingBox())!
  expect(copy.y + copy.height).toBeLessThanOrEqual(chat.y)
})

// The main page's scripts have the block's words and chats, not every story.
test("the main page carries only what its block shows of the stories", async ({ page }) => {
  const scripts: Promise<string>[] = []
  page.on("response", (r) => {
    if (r.url().endsWith(".js") && r.ok()) scripts.push(r.text())
  })
  await page.goto("/")
  await expect(page.locator("#stories .say")).toHaveCount(6)
  const code = (await Promise.all(scripts)).join("\n")
  // As true or false: the scripts' whole text would fill the report.
  for (const [words, carried] of [
    ["You know. That bit.", true],
    [STORIES[2][1], false],
    ["In the first chorus the baby woke up.", false],
  ] as const)
    expect(code.includes(words), words).toBe(carried)
})

test("a link in a story opens the story it names", async ({ page }) => {
  await page.goto("/stories/tempo-drift")
  await page.getByRole("link", { name: "the mixer story" }).click()
  await expect(page).toHaveURL(new RegExp(`${MIXER}$`))
})

test("the end of a story leads to the next one, and names the others", async ({ page }) => {
  await page.goto("/stories/tempo-drift")
  const end = page.locator(".tale-next")
  const next = end.locator(".tale-card")
  await expect(next.locator(".eyebrow")).toHaveText("Next story")
  await expect(next.locator("h2")).toHaveText(STORIES[2][1])
  await expect(next).toHaveAttribute("href", "/stories/metronome")
  await expect(next.locator(".say").first()).toContainText("Bloody hell.")
  await expect(end.locator(".also")).toContainText("Also:")
  await expect(end.locator(".also a")).toHaveText([STORIES[0][1], STORIES[3][1]])
  // After the downloads, and after the last story the first comes next.
  const below = await page.evaluate(
    () => document.querySelector(".tale-next")!.getBoundingClientRect().top - document.querySelector(".tale-get")!.getBoundingClientRect().bottom
  )
  expect(below).toBeGreaterThan(0)
  await page.goto("/stories/record-rehearsal")
  await expect(next).toHaveAttribute("href", "/stories/digital-mixer")
  await expect(end.locator(".also a")).toHaveText([STORIES[1][1], STORIES[2][1]])
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
  await expectUnseenName(me.locator(".who"), "Me")
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
        ...STORIES.map(([slug, title]) => [`/stories/${slug}`, title]),
        ["/stories", "How our band records its rehearsals"],
      ]) {
        await page.goto(path)
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(title)
        expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBe(width)
      }
    })

    // A word longer than the screen, as a model's name or an address can be.
    test(`at ${width} px a long word in a story still fits`, async ({ page }) => {
      await page.setViewportSize({ width, height })
      await page.goto(MIXER)
      const long = "Lautsprecherbox".repeat(5)
      await page.locator(".chap-body > p").first().evaluate((el, w) => el.append(` ${w}`), long)
      await page.locator(".chap-head h2").first().evaluate((el, w) => el.append(` ${w}`), long)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    })

    test(`at ${width} px the menu keeps Stories`, async ({ page }) => {
      await page.setViewportSize({ width, height })
      for (const path of ["/", MIXER]) {
        await page.goto(path)
        await expect(page.locator(".nav").getByRole("link", { name: "Stories", exact: true }), path).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBe(width)
      }
      await page.locator(".nav").getByRole("link", { name: "Stories", exact: true }).click()
      await expect(page).toHaveURL(/\/stories$/)
    })
  }
})
