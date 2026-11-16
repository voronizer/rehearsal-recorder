import { expect, test, type Page } from "@playwright/test"
import { asMember, band, BASE } from "./band"

/*
  The page a link to a take opens (#106), for someone outside the band: in
  a browser that never signed in. Each link is made through the band's API
  as Alex.
*/

type Heard = { volumes: Record<string, number>; muted: string[]; soloed: string[] }
type Asked = { shows: "mix" | "tracks" | "marks"; download?: "none" | "mix" | "all"; heard?: Heard }

const NONE: Heard = { volumes: {}, muted: [], soloed: [] }

/** A tracks or marks link to `take`, made by Alex: its id. */
async function link(take: string, { shows, download = "none", heard = NONE }: Asked): Promise<string> {
  const api = await asMember("alex")
  const res = await api.post(`/api/takes/${band().takes[take]}/links`, { data: { for: "Outside test", shows, download, lasts: "never", heard } })
  expect(res.ok()).toBe(true)
  return ((await res.json()) as { id: string }).id
}

/** A link that shows only the mix: its MP3 is the take's first track, as a member's page would have sent its mix. */
async function mixLink(take: string, download: "none" | "mix"): Promise<string> {
  const api = await asMember("alex")
  const uid = band().takes[take]
  const res = await api.post(`/api/takes/${uid}/links`, {
    data: { for: "Outside test", shows: "mix", download, lasts: "never", peaks: Array.from({ length: 1200 }, (_, i) => (i % 10) / 10) },
  })
  expect(res.ok()).toBe(true)
  const { id } = (await res.json()) as { id: string }
  const mp3 = await (await api.get(`/files/${uid}/1/1.mp3`)).body()
  expect((await api.put(`/api/links/${id}/mix`, { data: mp3, headers: { "Content-Type": "audio/mpeg" } })).ok()).toBe(true)
  return id
}

/** Every path the page asks of the band's service. */
function watch(page: Page): string[] {
  const asked: string[] = []
  page.on("request", (r) => {
    const u = new URL(r.url())
    if (u.origin === BASE) asked.push(u.pathname)
  })
  return asked
}

/** What a link's page may ask for: its own page, its answer, the band's name and picture, the files through the link, and its own code. */
const OPEN = /^\/(l\/[^/]+|api\/l\/[^/]+(\/played)?|api\/band|files\/l\/.+|files\/band\/picture|assets\/.+|[^/]+\.[a-z0-9]+)$/

test.use({ storageState: { cookies: [], origins: [] } })

test("a marks link of a take with a song, Backing and MIDI asks nothing of the band's routes", async ({ page }) => {
  const ira = await asMember("ira")
  const uid = band().takes["Viasna 11"]
  const { id: mark } = (await (await ira.post(`/api/takes/${uid}/marks`, { data: { at: 2, note: "Lovely here" } })).json()) as { id: number }
  expect((await ira.post(`/api/marks/${mark}/comments`, { data: { text: "Keep this one" } })).ok()).toBe(true)
  try {
    const id = await link("Viasna 11", { shows: "marks", download: "all", heard: { volumes: {}, muted: [], soloed: [] } })
    const asked = watch(page)
    await page.goto(`/l/${id}`)
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Viasna\s*#11/)
    const player = page.locator("[data-take-player]")
    const lanes = player.locator("[data-lane-row]")
    await expect(lanes.last()).toHaveAttribute("data-lane-row", "Backing")
    await expect(page.getByRole("toolbar", { name: "Transport" }).getByRole("button", { name: "To start" })).toBeEnabled()
    // The maker heard Backing: so does the person with the link.
    await expect(player.getByRole("button", { name: "Mute Backing" })).toHaveAttribute("aria-pressed", "false")
    await lanes.nth(2).getByRole("button", { name: "Keys notes" }).click()
    const keys = page.locator('[data-notes-lane="Keys"]')
    await expect(keys.getByText("C4", { exact: true })).toBeVisible()
    await expect(keys).not.toContainText("Notes file")
    const row = page.locator(`[data-mark="${mark}"]`)
    await expect(row).toContainText("Lovely here")
    await expect(row).toContainText("Ira")
    await expect(row).toContainText("Keep this one")
    await expect(page.getByRole("textbox", { name: "Your comment" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: /Done/ })).toHaveCount(0)
    await expect(page.getByRole("button", { name: /^What to do with/ })).toHaveCount(0)
    await page.waitForLoadState("networkidle")
    expect(new URL(page.url()).pathname).toBe(`/l/${id}`)
    expect(asked).toContain(`/api/l/${id}`)
    expect(asked.filter((path) => path.startsWith(`/files/l/${id}/`) && path.endsWith(".mid"))).toHaveLength(1)
    expect(asked.filter((path) => !OPEN.test(path))).toEqual([])
  } finally {
    await ira.delete(`/api/marks/${mark}`)
  }
})

test("a mix link plays the mix", async ({ page }) => {
  const id = await mixLink("Viasna 12", "none")
  await page.goto(`/l/${id}`)
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Viasna\s*#12/)
  await expect(page.getByTestId("wave")).toHaveCount(1)
  await expect(page.getByRole("button", { name: "Play “Viasna 12”" })).toBeVisible()
  await expect(page.getByRole("slider", { name: /volume$/ })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Download", exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Link for someone outside the band" })).toHaveCount(0)
})

test("a tracks link starts at the maker's levels and keeps nothing", async ({ page }) => {
  const id = await link("Viasna 12", { shows: "tracks", heard: { volumes: { Guitar: 0.3 }, muted: ["Bass"], soloed: [] } })
  const asked = watch(page)
  await page.goto(`/l/${id}`)
  const player = page.locator("[data-take-player]")
  const guitar = player.getByRole("slider", { name: "Guitar volume" })
  await expect(guitar).toHaveAttribute("aria-valuetext", "30%")
  await expect(player.getByRole("button", { name: "Mute Bass" })).toHaveAttribute("aria-pressed", "true")
  await page.waitForLoadState("networkidle")
  const before = asked.length
  await guitar.press("ArrowUp")
  await player.getByRole("button", { name: "Mute Bass" }).click()
  await page.waitForTimeout(1500)
  expect(asked.slice(before).filter((path) => path.startsWith("/api/"))).toEqual([])
  await expect(page.getByRole("button", { name: /Star/ })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Mark", exact: true })).toHaveCount(0)
  await expect(page.locator("[data-mark]")).toHaveCount(0)
})

test("Download follows the link", async ({ page }) => {
  const mix = await mixLink("Viasna 12", "mix")
  await page.goto(`/l/${mix}`)
  await page.getByRole("button", { name: "Download", exact: true }).click()
  const window = page.getByRole("dialog")
  await expect(window.getByText("The MP3 the band made for this link.")).toBeVisible()
  await expect(window.getByText("Tracks in MP3")).toHaveCount(0)
  await expect(window.getByText("Tracks in FLAC")).toHaveCount(0)
  const saving = page.waitForEvent("download")
  await window.getByText("The mix", { exact: true }).click()
  expect((await saving).suggestedFilename()).toBe("Viasna 12.mp3")

  const all = await link("Kupalle 2", { shows: "tracks", download: "all" })
  await page.goto(`/l/${all}`)
  await page.getByRole("button", { name: "Download", exact: true }).click()
  await page.getByRole("dialog").getByText("Tracks in FLAC").click()
  const list = page.getByRole("dialog")
  for (const file of await list.locator("[data-file]").all()) if ((await file.getAttribute("data-file")) !== "Drums") await file.click()
  const flac = page.waitForEvent("download")
  await list.getByRole("button", { name: "Download 1 file" }).click()
  const saved = await flac
  expect(saved.suggestedFilename()).toBe("Kupalle 2 - Drums.flac")
  const { readFile } = await import("node:fs/promises")
  expect(await readFile((await saved.path())!, "utf-8")).toBe("fLaC made up")
})

test("the first play counts once", async ({ page }) => {
  const id = await link("Viasna 12", { shows: "tracks" })
  await page.goto(`/l/${id}`)
  const transport = page.getByRole("toolbar", { name: "Transport" })
  await transport.getByRole("button", { name: "Play", exact: true }).click()
  await transport.getByRole("button", { name: "Pause", exact: true }).click()
  await transport.getByRole("button", { name: "Play", exact: true }).click()
  await expect(transport.getByRole("button", { name: "Pause", exact: true })).toBeVisible()
  await page.waitForTimeout(500)
  const api = await asMember("alex")
  const listed = (await (await api.get("/api/links")).json()) as { id: string; plays: number }[]
  expect(listed.find((l) => l.id === id)?.plays).toBe(1)
})

test("a closed link says it no longer works", async ({ page }) => {
  const id = await link("Viasna 12", { shows: "tracks" })
  await page.goto(`/l/${id}`)
  await expect(page.locator("[data-take-player]")).toBeVisible()
  const api = await asMember("alex")
  expect((await api.delete(`/api/links/${id}`)).ok()).toBe(true)
  await page.reload()
  await expect(page.getByText("This link no longer works.")).toBeVisible()
  await expect(page.locator("[data-take-player]")).toHaveCount(0)
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(0)
  expect(new URL(page.url()).pathname).toBe(`/l/${id}`)
})

test("a link page that cannot load says so", async ({ page }) => {
  const id = await link("Viasna 12", { shows: "tracks" })
  let broken = true
  await page.route("**/api/l/*", (route) => (broken ? route.fulfill({ status: 500, json: { error: "The band service is resting" } }) : route.continue()))
  await page.goto(`/l/${id}`)
  const again = page.getByRole("button", { name: "Try again" })
  await expect(again).toBeVisible({ timeout: 15_000 })
  broken = false
  await again.click()
  await expect(page.locator("[data-take-player]")).toBeVisible()
})

test("a take moved to another song has no note for the band, and search engines leave the page out", async ({ page }) => {
  const id = await link("Viasna 12", { shows: "tracks" })
  // As a member who moved it here would have it: РЭХА has not numbered it yet.
  await page.route(`**/api/l/${id}`, async (route) => {
    const res = await route.fetch()
    await route.fulfill({ response: res, json: { ...(await res.json()), moved: true } })
  })
  const res = await page.goto(`/l/${id}`)
  expect(res?.headers()["x-robots-tag"]).toBe("noindex")
  const title = page.getByRole("heading", { level: 1 })
  await expect(title).toContainText("Viasna")
  await expect(title).not.toContainText("number from")
})

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test("a tracks link on a phone has the tracks and the bar with the speed", async ({ page }) => {
    const id = await link("Viasna 12", { shows: "tracks" })
    await page.goto(`/l/${id}`)
    const tracks = page.getByRole("main").getByRole("region", { name: "Tracks" })
    await expect(tracks.getByRole("slider", { name: "Guitar volume" })).toBeVisible()
    const bar = page.getByRole("contentinfo", { name: "Player" })
    await expect(bar.getByRole("button", { name: /^Speed/ })).toBeVisible()
    await expect(bar.getByRole("link")).toHaveCount(0)
    await expect(bar).toContainText("Viasna")
    await expect(page.getByRole("button", { name: "Mark", exact: true })).toHaveCount(0)
    await expect(page.getByRole("button", { name: /Star/ })).toHaveCount(0)
  })
})
