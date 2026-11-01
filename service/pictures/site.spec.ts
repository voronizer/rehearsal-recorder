import { writeFileSync } from "node:fs"
import { test, type Browser, type Page } from "@playwright/test"
import { as, pictured } from "./seed"

/*
  The pictures on reha.stream/band-service: the service's own pages on a
  phone, or on a computer where that is where it is used, in the light and
  in the dark, over the band in seed.ts. They check nothing.

      npm run pictures

  writes site/src/stories/band-service/<picture>-<light|dark>.webp, and
  sizes.json, each picture's size as the page shows it. Run it
  after changing anything the pictures show, and look at them before
  committing.
*/

const OUT = new URL("../../site/src/stories/band-service/", import.meta.url)
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
// The size of the app's own mockups.
const COMPUTER = { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1 }

type Shot = {
  who: Parameters<typeof as>[0] | null
  path: () => string
  then?: (page: Page) => Promise<void>
  on?: typeof PHONE | typeof COMPUTER
}

/** Puts `heading` near the top of the screen, under the bar. */
const scrollTo = (heading: string) => async (page: Page) => {
  await page.getByRole("heading", { name: heading, exact: true }).evaluate((el) => {
    el.scrollIntoView({ block: "start" })
    // Whichever scrolls, the page or its main part, makes room for the bar.
    el.closest("main")?.scrollBy(0, -64)
    window.scrollBy(0, -64)
  })
}

const SHOTS: Record<string, Shot> = {
  "new-takes": { who: "ira", path: () => "/" },
  lanes: {
    who: "ivan",
    path: () => `/takes/${pictured().takes["Viasna 12"]}?at=102`,
    then: (page) => page.getByRole("button", { name: "Solo Guitar" }).click(),
  },
  mark: {
    who: "ivan",
    path: () => `/takes/${pictured().takes["Viasna 12"]}?at=102`,
    // The lanes with the mark on them, then the mark with the band's talk under it.
    then: scrollTo("Tracks"),
  },
  colours: { who: "ivan", path: () => "/marks" },
  song: { who: "ivan", path: () => `/songs/${pictured().songs["Viasna"]}` },
  "three-weeks-ago": { who: "ivan", path: () => `/takes/${pictured().takes["Viasna 3"]}?at=104` },
  // On the computer at home, for the recording program: the lanes, and every
  // track to download under them.
  downloads: { who: "ivan", path: () => `/takes/${pictured().takes["Kupalle 2"]}`, on: COMPUTER, then: scrollTo("Tracks") },
  "sign-in": {
    who: null,
    path: () => "/signin",
    then: (page) => page.getByLabel("Email address").fill("you@example.com"),
  },
}

/** The browser's own WebP of a PNG: a quarter of its size, and no tool to install. */
async function webp(browser: Browser, png: Buffer): Promise<Buffer> {
  const page = await browser.newPage()
  const data = await page.evaluate(async (b64) => {
    const img = new Image()
    img.src = `data:image/png;base64,${b64}`
    await img.decode()
    const canvas = document.createElement("canvas")
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    canvas.getContext("2d")!.drawImage(img, 0, 0)
    const blob = await new Promise<Blob>((done) => canvas.toBlob((b) => done(b!), "image/webp", 0.86))
    return await new Promise<string>((done) => {
      const reader = new FileReader()
      reader.onload = () => done(String(reader.result).split(",")[1])
      reader.readAsDataURL(blob)
    })
  }, png.toString("base64"))
  await page.close()
  return Buffer.from(data, "base64")
}

test.beforeAll(() => {
  const sizes = Object.fromEntries(Object.entries(SHOTS).map(([name, shot]) => [name, (shot.on ?? PHONE).viewport]))
  writeFileSync(new URL("sizes.json", OUT), `${JSON.stringify(sizes, null, 2)}\n`)
})

for (const [name, shot] of Object.entries(SHOTS)) {
  for (const theme of ["light", "dark"] as const) {
    test(`${name} ${theme}`, async ({ browser }) => {
      const context = await browser.newContext({
        ...(shot.on ?? PHONE),
        baseURL: "http://localhost:8799",
        colorScheme: theme,
        reducedMotion: "reduce",
        storageState: shot.who ? as(shot.who) : undefined,
      })
      const page = await context.newPage()
      await page.goto(shot.path())
      await page.locator("h1, h2").first().waitFor()
      // Every waveform drawn, and the fonts in.
      await page.waitForFunction(() =>
        [...document.querySelectorAll('[data-testid="wave"] svg')].every((svg) => svg.querySelector("rect"))
      )
      // Every track's own waveform in, too.
      await page.waitForLoadState("networkidle")
      await page.evaluate(() => document.fonts.ready)
      await shot.then?.(page)
      await page.waitForTimeout(300)
      writeFileSync(new URL(`${name}-${theme}.webp`, OUT), await webp(browser, await page.screenshot()))
      await context.close()
    })
  }
}
