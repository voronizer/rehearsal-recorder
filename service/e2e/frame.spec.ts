import { expect, test, type Locator, type Page } from "@playwright/test"
import { as, band } from "./band"

test.use({ storageState: as("alex") })

const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

/** Where a box starts from the left and how wide it is, in whole px. The callers poll it where the columns open and fold over 200 ms. */
const box = async (l: Locator) => {
  const b = (await l.boundingBox())!
  return { x: Math.round(b.x), width: Math.round(b.width) }
}

test("the frame has its sections, and a panel closes with its X, Esc and another section", async ({ page }) => {
  await page.goto("/")
  const sections = page.getByRole("navigation", { name: "Sections" })
  await expect(sections.getByRole("link")).toHaveText(["Home", "Rehearsals", "Songs", "Sets", /^Marks\s*\d+$/, "Members", "Trash"])
  await expect(page.getByLabel("Player")).toBeVisible()

  // A mark's panel, from Latest marks.
  const mark = page.getByRole("region", { name: "Latest marks" }).getByRole("button", { name: /Too quiet here/ })
  const panel = page.getByLabel("Panel")
  await mark.click()
  await expect(panel.getByRole("heading", { level: 2 }).first()).toHaveText(/^Mark at 0:03$/)
  await panel.getByRole("button", { name: "Close", exact: true }).click()
  await expect(panel).toHaveCount(0)

  await mark.click()
  await expect(panel).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(panel).toHaveCount(0)

  await mark.click()
  await expect(panel).toBeVisible()
  await sections.getByRole("link", { name: "Songs" }).click()
  await expect(page).toHaveURL("/songs")
  await expect(panel).toHaveCount(0)
})

test("a press on a take's wave opens its page and plays nothing", async ({ page }) => {
  await page.goto(`/rehearsals/${band().rehearsals.second}`)
  const wave = page.locator('[data-take="Viasna 11"]').getByTestId("wave")
  const box = (await wave.boundingBox())!
  await wave.click({ position: { x: box.width * 0.5, y: box.height / 2 } })
  await expect(page).toHaveURL(`/takes/${band().takes["Viasna 11"]}`)
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Viasna")
  await expect(page.getByLabel("Panel", { exact: true })).toHaveCount(0)
  await expect(page.getByLabel("Player", { exact: true }).getByRole("button", { name: /^Pause/ })).toHaveCount(0)
})

test("a press on the bar moves the take to that spot, between whole seconds; the arrows move it a second, Shift ten, Home and End to its ends; a drag moves it once, let go", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("region", { name: "The last rehearsal" }).locator('[data-take="Viasna 11"]').getByRole("button", { name: "Play “Viasna 11”" }).click()
  const bar = page.getByLabel("Player", { exact: true })
  await bar.getByRole("button", { name: "Pause “Viasna 11”" }).click()
  await expect(bar.getByRole("button", { name: "Play “Viasna 11”" })).toBeVisible()
  const line = bar.getByTestId("bar-line")
  const where = line.getByRole("slider", { name: "Viasna 11" })
  const now = async () => Number(await where.getAttribute("aria-valuenow"))
  // 37% of the take's 10.032 s is 3.71 s, where a whole second's step would give 4.
  const b = (await line.boundingBox())!
  await page.mouse.click(b.x + b.width * 0.37, b.y + b.height / 2)
  await expect.poll(now).toBeCloseTo(3.71, 1)
  const pressed = await now()
  await expect(where).toBeFocused()
  for (const [key, to] of [
    ["ArrowRight", pressed + 1],
    ["ArrowLeft", pressed],
    ["Shift+ArrowLeft", 0],
  ] as const) {
    await page.keyboard.press(key)
    await expect.poll(now, key).toBeCloseTo(to, 2)
  }
  await page.keyboard.press("End")
  await expect.poll(now, "End").toBeCloseTo(10.032, 1)
  const end = await now()
  for (const [key, to] of [
    ["Shift+ArrowLeft", end - 10],
    ["ArrowRight", end - 9],
    ["Home", 0],
  ] as const) {
    await page.keyboard.press(key)
    await expect.poll(now, key).toBeCloseTo(to, 2)
  }
  // A drag: the thumb follows the pointer, and the take moves once, where it is let go, since a seek starts every track again.
  const time = bar.getByTestId("bar-time")
  await expect(time).toHaveText("0:00")
  await page.mouse.move(b.x + b.width * 0.3, b.y + b.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width * 0.75, b.y + b.height / 2, { steps: 10 })
  await expect.poll(now).toBeCloseTo(7.52, 1)
  await expect(time).toHaveText("0:00")
  await page.mouse.up()
  await expect(time).toHaveText("0:07")
  await expect.poll(now).toBeCloseTo(7.52, 1)
})

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test("a wave in a list lets a finger scroll, and a tap opens its take's page", async ({ page }) => {
    await page.goto(`/rehearsals/${band().rehearsals.second}`)
    const wave = page.locator('[data-take="Viasna 11"]').getByTestId("wave")
    await expect(wave).not.toHaveCSS("touch-action", "none")
    await wave.tap()
    await expect(page).toHaveURL(`/takes/${band().takes["Viasna 11"]}`)
    await expect(page.getByLabel("Player", { exact: true }).getByRole("button", { name: /^Pause/ })).toHaveCount(0)
  })

  test("a take's name opens its page, and Mark in the bar opens a new mark", async ({ page }) => {
    await page.goto("/")
    await page.getByRole("region", { name: "The last rehearsal" }).getByRole("link", { name: "Viasna 11", exact: true }).click()
    await expect(page).toHaveURL(`/takes/${band().takes["Viasna 11"]}`)
    await expect(page.getByLabel("Panel", { exact: true })).toHaveCount(0)
    const bar = page.getByLabel("Player")
    await expect(bar.getByRole("button", { name: "Viasna 11", exact: true })).toBeVisible()
    await bar.getByRole("button", { name: "Mark", exact: true }).click()
    await expect(page.getByLabel("Panel")).toContainText(/New mark at \d:\d\d/)
  })

  test("a long song title in the bar is cut, and Mark stays in the bar", async ({ page }) => {
    const long = "Dancing barefoot on the roof of the old brewery till the morning"
    // The take as the service sends it, with its song's title made long.
    await page.route(/\/api\/takes\/[^/?]+$/, async (route) => {
      if (route.request().method() !== "GET") return route.continue()
      const res = await route.fetch()
      const take = (await res.json()) as { name: string; song: { id: number; title: string } | null }
      await route.fulfill({ response: res, json: { ...take, name: take.name.replace(/^Viasna/, long), song: take.song && { ...take.song, title: long } } })
    })
    await page.goto(`/takes/${band().takes["Viasna 11"]}`)
    const bar = page.getByLabel("Player", { exact: true })
    const name = bar.getByRole("button", { name: `${long} 11`, exact: true })
    await expect(name).toBeVisible()
    const time = bar.getByTestId("bar-time")
    const mark = bar.getByRole("button", { name: "Mark", exact: true })
    const [n, t, m, b] = await Promise.all([name, time, mark, bar].map(async (l) => (await l.boundingBox())!))
    expect(n.x + n.width).toBeLessThanOrEqual(t.x)
    expect(t.x + t.width).toBeLessThanOrEqual(m.x)
    expect(m.x + m.width).toBeLessThanOrEqual(b.x + b.width)
    await page.unrouteAll({ behavior: "ignoreErrors" })
  })

  test("New song from a take's line opens its page with the name field", async ({ page }) => {
    await page.goto("/songs")
    await page.getByRole("region", { name: "Not named" }).getByRole("button", { name: "What to do with Take 3", exact: true }).click()
    await page.getByRole("menuitem", { name: "Move to song" }).click()
    await page.getByRole("option", { name: "New song…" }).click()
    await expect(page).toHaveURL(`/takes/${band().takes["Take 3"]}`)
    await expect(page.getByRole("main").getByRole("textbox", { name: "New song" })).toBeVisible()
    await expect(page.getByLabel("Panel", { exact: true })).toHaveCount(0)
  })

  test("the menu comes out 256 px wide, named Menu, and Esc closes it", async ({ page }) => {
    await page.goto("/")
    const button = page.getByRole("button", { name: "Menu", exact: true })
    await button.click()
    const menu = page.getByRole("dialog", { name: "Menu" })
    await expect(menu.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Songs" })).toBeVisible()
    await expect.poll(() => box(menu)).toEqual({ x: 0, width: 256 })
    await page.keyboard.press("Escape")
    await expect(menu).toHaveCount(0)
    await expect(button).toBeFocused()
    await expect(page).toHaveURL("/")
  })

  test("with a mark's panel open, the bar under it still plays", async ({ page }) => {
    await page.goto(`/takes/${band().takes["Viasna 11"]}`)
    const bar = page.getByLabel("Player", { exact: true })
    await bar.getByRole("button", { name: "Mark", exact: true }).click()
    const panel = page.getByLabel("Panel", { exact: true })
    await expect(panel).toContainText(/New mark at \d:\d\d/)
    // Between the header and the bar, the phone's whole width, with no veil over the bar.
    const [over, under] = [(await panel.boundingBox())!, (await bar.boundingBox())!]
    expect(Math.round(over.width)).toBe(390)
    expect(over.y + over.height).toBeLessThanOrEqual(under.y)
    await bar.getByRole("button", { name: "Play “Viasna 11”" }).click()
    await expect(bar.getByTestId("bar-time")).toHaveText(/^0:0[1-9] \//, { timeout: 10_000 })
    await expect(panel).toBeVisible()
    await bar.getByRole("button", { name: "Pause “Viasna 11”" }).click()
  })
})

test("Esc in a menu inside a panel closes the menu, not the panel", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("region", { name: "Latest marks" }).getByRole("button", { name: /The bridge drags here/ }).click()
  const panel = page.getByLabel("Panel")
  // Alex's comment on Dzima's mark has its ⋯.
  await panel.getByRole("button", { name: "What to do with your comment" }).click()
  await expect(page.getByRole("menu")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("menu")).toHaveCount(0)
  await expect(panel).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(panel).toHaveCount(0)
})

test("a computer's windows fit every section", async ({ page }) => {
  for (const [width, height] of [
    [1180, 820],
    [960, 680],
  ]) {
    await page.setViewportSize({ width, height })
    for (const path of ["/", "/rehearsals", "/songs", "/sets", "/marks", "/members", "/trash"]) {
      await page.goto(path)
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
      expect(await fits(page), `${path} at ${width}`).toBe(true)
    }
  }
})

test("a phone keeps the sections behind the menu", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/")
  const sections = page.getByRole("navigation", { name: "Sections" })
  await expect(sections).toHaveCount(0)
  // No handle folds the menu here, in the page or in the menu.
  const handle = page.getByRole("button", { name: /^(Fold|Open) the menu$/ })
  await expect(handle).toHaveCount(0)
  await page.getByRole("button", { name: "Menu" }).click()
  await expect(sections).toBeVisible()
  await expect(handle).toHaveCount(0)
  await sections.getByRole("link", { name: "Songs" }).click()
  await expect(sections).toHaveCount(0)
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Songs")
  for (const path of ["/", "/rehearsals", "/songs", "/sets", "/marks", "/members", "/trash", `/takes/${band().takes["Viasna 12"]}`]) {
    await page.goto(path)
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    expect(await fits(page), path).toBe(true)
  }
})

test.describe("the two columns", () => {
  const take = () => `/takes/${band().takes["Kupalle 2"]}`

  test("on a take's page the panel opens beside the page, 400 px past its strip, and folds back into it; no key folds either", async ({ page }) => {
    await page.goto(take())
    const main = page.getByRole("main")
    const strip = page.getByLabel("Strip")
    const panel = page.getByLabel("Panel", { exact: true })
    await expect(strip.getByRole("button", { name: "Open the panel" })).toBeVisible()
    // 48 px with the column's line on its left.
    await expect.poll(() => box(strip)).toEqual({ x: 1180 - 47, width: 47 })
    await expect.poll(() => box(main)).toEqual({ x: 224, width: 1180 - 224 - 48 })
    const folded = await box(main)
    // shadcn's own key for its sidebar is not ours.
    for (const key of ["Control+b", "Meta+b"]) await page.keyboard.press(key)
    await expect(panel).toHaveCount(0)
    expect(await box(main)).toEqual(folded)

    await strip.getByRole("button", { name: "Open the panel" }).click()
    await expect(panel.getByRole("heading", { name: "Marks", exact: true })).toBeVisible()
    await expect(strip).toHaveCount(0)
    await expect.poll(() => box(panel)).toEqual({ x: 1180 - 447, width: 447 })
    await expect.poll(() => box(main)).toEqual({ x: 224, width: folded.width - 400 })

    await panel.getByRole("button", { name: "Fold the panel" }).click()
    await expect(panel).toHaveCount(0)
    await expect.poll(() => box(strip)).toEqual({ x: 1180 - 47, width: 47 })
    await expect.poll(() => box(main)).toEqual(folded)
  })

  test("on Songs, Statuses takes 448 px from the page, and closed the panel is gone", async ({ page }) => {
    await page.goto("/songs")
    const main = page.getByRole("main")
    await expect(main.getByRole("heading", { level: 1 })).toBeVisible()
    await expect.poll(() => box(main)).toEqual({ x: 224, width: 1180 - 224 })
    await page.getByRole("button", { name: "Statuses", exact: true }).click()
    const panel = page.getByLabel("Panel", { exact: true })
    await expect(panel.getByRole("heading", { name: "Statuses", exact: true })).toBeVisible()
    // 448 px with the column's line on its left.
    await expect.poll(() => box(panel)).toEqual({ x: 1180 - 447, width: 447 })
    await expect.poll(() => box(main)).toEqual({ x: 224, width: 1180 - 224 - 448 })
    await page.keyboard.press("Escape")
    await expect(panel).toHaveCount(0)
    await expect.poll(() => box(main)).toEqual({ x: 224, width: 1180 - 224 })
  })

  test("on Marks at 1180 px, a mark's words stay in the page beside its open panel", async ({ page }) => {
    await page.goto("/marks")
    const main = page.getByRole("main")
    const words = main.locator("[data-mark]").first().getByRole("button").first()
    await words.click()
    await expect(page.getByLabel("Panel", { exact: true }).getByRole("heading", { level: 2 }).first()).toHaveText(/^Mark at/)
    await expect.poll(() => box(main)).toEqual({ x: 224, width: 1180 - 224 - 448 })
    await expect(words).toBeVisible()
    const [line, room] = [await box(words), await box(main)]
    expect(line.width).toBeGreaterThan(0)
    expect(line.x + line.width).toBeLessThanOrEqual(room.x + room.width)
  })

  test("at 768 px a mark's panel lies over the page, which keeps its width; at 820 px the page narrows beside it", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 680 })
    await page.goto("/marks")
    const main = page.getByRole("main")
    const panel = page.getByLabel("Panel", { exact: true })
    const songs = page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Songs" })
    await expect.poll(() => box(main)).toEqual({ x: 224, width: 768 - 224 })
    await main.locator("[data-mark]").first().getByRole("button").first().click()
    await expect(panel.getByRole("heading", { level: 2 }).first()).toHaveText(/^Mark at/)
    // 448 px from the right over the page, with its line; the sections stay open, as the page keeps its room.
    await expect.poll(() => box(panel)).toEqual({ x: 768 - 447, width: 447 })
    expect(await box(main)).toEqual({ x: 224, width: 768 - 224 })
    expect(await box(songs)).toEqual({ x: 12, width: 200 })

    await page.setViewportSize({ width: 820, height: 680 })
    await expect.poll(() => box(main)).toEqual({ x: 48, width: 820 - 48 - 448 })
    await expect.poll(() => box(panel)).toEqual({ x: 820 - 447, width: 447 })
  })

  test("at 768 px on a take's page the panel opens over the page from its strip, the page keeps its width, and it folds back", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 680 })
    await page.goto(take())
    const main = page.getByRole("main")
    const strip = page.getByLabel("Strip")
    const panel = page.getByLabel("Panel", { exact: true })
    await expect.poll(() => box(main)).toEqual({ x: 224, width: 768 - 224 - 48 })
    await strip.getByRole("button", { name: "Open the panel" }).click()
    await expect(panel.getByRole("heading", { name: "Marks", exact: true })).toBeVisible()
    await expect.poll(() => box(panel)).toEqual({ x: 768 - 447, width: 447 })
    expect(await box(main)).toEqual({ x: 224, width: 768 - 224 - 48 })
    await panel.getByRole("button", { name: "Fold the panel" }).click()
    await expect(panel).toHaveCount(0)
    await expect.poll(() => box(strip)).toEqual({ x: 768 - 47, width: 47 })
    expect(await box(main)).toEqual({ x: 224, width: 768 - 224 - 48 })
  })

  test("a comment being typed stays as the window crosses 820 px and back", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 680 })
    await page.goto("/marks")
    await page.getByRole("main").locator("[data-mark]").first().getByRole("button").first().click()
    const comment = page.getByLabel("Panel", { exact: true }).getByRole("textbox", { name: "Your comment" }).last()
    await comment.fill("Slower into the bridge")
    await page.setViewportSize({ width: 820, height: 680 })
    await expect.poll(() => box(page.getByRole("main"))).toEqual({ x: 48, width: 820 - 48 - 448 })
    await expect(comment).toHaveValue("Slower into the bridge")
    await page.setViewportSize({ width: 768, height: 680 })
    await expect.poll(() => box(page.getByRole("main"))).toEqual({ x: 224, width: 768 - 224 })
    await expect(comment).toHaveValue("Slower into the bridge")
  })

  test("on Home at 1180 px, a mark pressed in Latest marks stays in view as its panel opens and the page goes to one column", async ({ page }) => {
    await page.goto("/")
    const mark = page.getByRole("region", { name: "Latest marks" }).getByRole("button", { name: /Too quiet here/ })
    await expect(mark).toBeInViewport()
    await mark.click()
    await expect(page.getByLabel("Panel", { exact: true }).getByRole("heading", { level: 2 }).first()).toHaveText(/^Mark at 0:03$/)
    await expect.poll(() => box(page.getByRole("main"))).toEqual({ x: 224, width: 1180 - 224 - 448 })
    await expect(mark).toBeInViewport({ ratio: 1 })
  })

  test("a panel closed after the page was scrolled away from the row that opened it leaves the page where it is", async ({ page }) => {
    // `top`: where the band scrolls to with the panel open, up among the songs, the mark out of view. Once the
    // panel closes, the mark is above the view at 1180, where the page has two columns again, and below it at 960.
    for (const [width, height, left, top] of [
      [1180, 820, 224, 250],
      [960, 680, 48, 0],
    ]) {
      await page.setViewportSize({ width, height })
      await page.goto("/")
      const main = page.getByRole("main")
      const panel = page.getByLabel("Panel", { exact: true })
      const mark = page.getByRole("region", { name: "Latest marks" }).getByRole("button", { name: /Too quiet here/ })
      await mark.click()
      await expect(panel.getByRole("heading", { level: 2 }).first()).toHaveText(/^Mark at 0:03$/)
      // The page has its room beside the panel, Latest marks under the songs, the mark kept in view.
      await expect.poll(() => box(main)).toEqual({ x: left, width: width - left - 448 })
      await expect(mark).toBeInViewport()
      // Up among the songs: the mark is out of view.
      await main.evaluate((m, top) => m.scrollTo({ top, behavior: "instant" }), top)
      await expect(mark).not.toBeInViewport()
      await panel.getByRole("button", { name: "Close", exact: true }).click()
      await expect(panel).toHaveCount(0)
      await expect.poll(() => box(main)).toEqual({ x: 224, width: width - 224 })
      expect(await main.evaluate((m) => m.scrollTop), `at ${width}`).toBe(top)
    }
  })

  test("under Reduce motion both columns fold and open at once", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.setViewportSize({ width: 960, height: 680 })
    await page.goto(take())
    const main = page.getByRole("main")
    const panel = page.getByLabel("Panel", { exact: true })
    await expect.poll(() => box(main)).toEqual({ x: 224, width: 960 - 224 - 48 })
    await page.getByLabel("Strip").getByRole("button", { name: "Open the panel" }).click()
    await expect(panel).toBeVisible()
    // Not polled: with motion off the page has its new room as soon as the panel is there.
    expect(await box(main)).toEqual({ x: 48, width: 960 - 48 - 448 })
    await panel.getByRole("button", { name: "Fold the panel" }).click()
    await expect(panel).toHaveCount(0)
    expect(await box(main)).toEqual({ x: 224, width: 960 - 224 - 48 })
  })

  test("the handle folds the sections to their icons and opens them, the page takes the room, and a reload keeps the fold", async ({ page }) => {
    await page.goto("/")
    const main = page.getByRole("main")
    const songs = page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Songs" })
    const fold = page.getByRole("button", { name: "Fold the menu", exact: true })
    const open = page.getByRole("button", { name: "Open the menu", exact: true })
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    await expect.poll(() => box(main)).toEqual({ x: 224, width: 1180 - 224 })
    await expect.poll(() => box(songs)).toEqual({ x: 12, width: 200 })
    const y = (await songs.boundingBox())!.y

    // First for Tab, with its tip at once.
    await page.keyboard.press("Tab")
    await expect(fold).toBeFocused()
    await expect(page.getByRole("tooltip")).toHaveText("Fold the menu")
    await page.keyboard.press("Enter")
    // The same button, on the column's new edge, keeps the focus.
    await expect(open).toBeFocused()
    await expect.poll(() => box(main)).toEqual({ x: 48, width: 1180 - 48 })
    await expect.poll(() => box(songs)).toEqual({ x: 6, width: 36 })
    // The sections stand where they stood.
    expect((await songs.boundingBox())!.y).toBe(y)

    await page.reload()
    await expect(open).toBeVisible()
    await expect.poll(() => box(main)).toEqual({ x: 48, width: 1180 - 48 })
    await open.click()
    await expect(fold).toBeVisible()
    await expect.poll(() => box(main)).toEqual({ x: 224, width: 1180 - 224 })
    await page.reload()
    await expect(fold).toBeVisible()
    await expect.poll(() => box(main)).toEqual({ x: 224, width: 1180 - 224 })
  })

  test("at 960 px a column folded by hand stays folded beside the panel and after it; while the panel folds it, there is no handle", async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 680 })
    await page.goto(take())
    const main = page.getByRole("main")
    const panel = page.getByLabel("Panel", { exact: true })
    const fold = page.getByRole("button", { name: "Fold the menu", exact: true })
    const open = page.getByRole("button", { name: "Open the menu", exact: true })
    const strip = page.getByLabel("Strip").getByRole("button", { name: "Open the panel" })
    await expect(fold).toBeVisible()

    // The panel folds the column by itself, and the handle goes until it closes.
    await strip.click()
    await expect(panel).toBeVisible()
    await expect.poll(() => box(main)).toEqual({ x: 48, width: 960 - 48 - 448 })
    await expect(fold).toHaveCount(0)
    await expect(open).toHaveCount(0)
    await panel.getByRole("button", { name: "Fold the panel" }).click()
    await expect(panel).toHaveCount(0)
    await expect.poll(() => box(main)).toEqual({ x: 224, width: 960 - 224 - 48 })
    await expect(fold).toBeVisible()

    // Folded by hand, it stays folded with the panel and after it.
    await fold.click()
    await expect.poll(() => box(main)).toEqual({ x: 48, width: 960 - 48 - 48 })
    await strip.click()
    await expect(panel).toBeVisible()
    await expect.poll(() => box(main)).toEqual({ x: 48, width: 960 - 48 - 448 })
    await expect(open).toHaveCount(0)
    await panel.getByRole("button", { name: "Fold the panel" }).click()
    await expect(panel).toHaveCount(0)
    await expect.poll(() => box(main)).toEqual({ x: 48, width: 960 - 48 - 48 })
    await expect(open).toBeVisible()
  })

  test("at 960 px the sections fold to their icons while the panel is open, names in tips, and open when it closes", async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 680 })
    await page.goto(take())
    const main = page.getByRole("main")
    const songs = page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Songs" })
    await expect.poll(() => box(main)).toEqual({ x: 224, width: 960 - 224 - 48 })
    await expect.poll(() => box(songs)).toEqual({ x: 12, width: 200 })

    await page.getByLabel("Strip").getByRole("button", { name: "Open the panel" }).click()
    const panel = page.getByLabel("Panel", { exact: true })
    await expect.poll(() => box(main)).toEqual({ x: 48, width: 960 - 48 - 448 })
    await expect.poll(() => box(songs)).toEqual({ x: 6, width: 36 })
    await expect(songs).toHaveAttribute("aria-current", "page")
    // The section lit is the one a screen reader hears as this page, and the only one.
    await expect(page.getByRole("navigation", { name: "Sections" }).locator("[aria-current=page], [data-active=true]")).toHaveCount(1)
    await songs.hover()
    await expect(page.getByRole("tooltip")).toHaveText("Songs")

    await panel.getByRole("button", { name: "Fold the panel" }).click()
    await expect(panel).toHaveCount(0)
    await expect.poll(() => box(main)).toEqual({ x: 224, width: 960 - 224 - 48 })
    await expect.poll(() => box(songs)).toEqual({ x: 12, width: 200 })
  })
})
