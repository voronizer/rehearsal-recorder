// The picture a chat shows for a link to reha.stream (og:image in
// index.html): og.html from the build in dist/, photographed into
// dist/og.png at 1200 by 630. Run after `npm run build`; Playwright's
// Chromium has to be installed (npx playwright install chromium).
//
// It waits for the app in the picture to be playing and for the fonts, and
// fails rather than leave a half-drawn picture, one in the wrong font, or
// none.
import { fileURLToPath } from "node:url"
import { chromium } from "@playwright/test"
import { preview } from "vite"

const root = fileURLToPath(new URL("..", import.meta.url))
const out = fileURLToPath(new URL("../dist/og.png", import.meta.url))

let server
let browser
try {
  server = await preview({ root, logLevel: "warn", preview: { host: "127.0.0.1", port: 0, open: false } })
  const { port } = server.httpServer.address()
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })
  await page.goto(`http://127.0.0.1:${port}/og.html`)
  const app = page.frameLocator('iframe[src$="#hero"]')
  await app.locator('html[data-scene="hero"]').waitFor({ state: "attached", timeout: 30_000 })
  await app.locator("html").evaluate(() => document.fonts.ready)
  // The page says whether its font came (src/og/main.tsx).
  await page.locator("html[data-og]").waitFor({ state: "attached", timeout: 30_000 })
  if ((await page.locator("html").getAttribute("data-og")) !== "ready") {
    throw new Error("the page's font (Instrument Sans) did not load")
  }
  await page.screenshot({ path: out })
  console.log(`Drew ${out}`)
} catch (e) {
  console.error(`No link picture: ${e instanceof Error ? e.message : e}`)
  process.exitCode = 1
} finally {
  await browser?.close()
  await server?.close()
}
