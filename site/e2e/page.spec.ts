import type { Page } from "@playwright/test"
import { readFileSync } from "node:fs"
import { changelogHead, displayVersion, latestNews, latestVersion } from "../src/content/changelog.ts"
import { test, expect } from "./fixtures.ts"

const CHANGELOG = readFileSync(new URL("../../CHANGELOG.md", import.meta.url), "utf-8")
// What the build was given: a release's tag, or none for CHANGELOG's newest.
const TAG = process.env.VITE_SITE_VERSION || latestVersion(CHANGELOG)
const VERSION = displayVersion(TAG)
// A release with nothing new in the app shows the news of the one before.
const NEWS = latestNews(changelogHead(CHANGELOG, process.env.VITE_SITE_VERSION || undefined))
const RELEASES = "https://github.com/voronizer/rehearsal-recorder/releases"
const MAC_ZIP = `${RELEASES}/latest/download/RehearsalRecorder-macos.zip`
const WIN_ZIP = `${RELEASES}/latest/download/RehearsalRecorder-windows.zip`

/** The frame showing `scene` of stage.html, and what it is showing. */
const frame = (page: Page, scene: string) => page.locator(`iframe[src$="#${scene}"]`)
const sceneIn = (page: Page, scene: string) =>
  frame(page, scene)
    .contentFrame()
    .locator("html")
    .getAttribute("data-scene")
    .catch(() => null)
const heldIn = (page: Page, scene: string) =>
  frame(page, scene).contentFrame().locator("html").getAttribute("data-held").catch(() => null)

/** The story's frame on show (a fresh one may be starting under it), and
 *  one of its marks: data-scene, the step it last ran through; data-moment,
 *  the moment it keeps still at; data-held. */
const storyFrame = (page: Page) => page.locator("#how iframe[data-shown='true']")
const story = (page: Page, mark: "scene" | "moment" | "held") =>
  storyFrame(page)
    .contentFrame()
    .locator("html")
    .getAttribute(`data-${mark}`)
    .catch(() => null)
/** Each of the story's frames: its place, whether it is on show, and its
 *  marks, so that a test waiting on them says where each frame got to. */
const storyFrames = (page: Page) =>
  page.locator("#how iframe").evaluateAll((els) =>
    els.map((el) => {
      const marks = (el as HTMLIFrameElement).contentDocument?.documentElement?.dataset
      return {
        place: el.getAttribute("src")?.split("#")[1],
        shown: el.getAttribute("data-shown"),
        scene: marks?.scene ?? null,
        moment: marks?.moment ?? null,
        held: marks?.held ?? null,
      }
    })
  )
/** A tile or card of the steps, by its title. */
const item = (page: Page, title: string) => page.locator("#how").getByRole("button", { name: title, exact: true })
const pressed = (page: Page) => page.locator("#how .items [aria-pressed='true']")
/** Puts a step's top at the top of the screen, as the rail does. */
const toStep = (page: Page, n: number) =>
  page.locator("#how .step").nth(n).evaluate((el) => window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - 24))

test("the page has its heading", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Multitrack recording for band rehearsals"
  )
})

test("the news line is the newest change that is news, with its notes", async ({ page }) => {
  await page.goto("/")
  const ribbon = page.locator(".ribbon")
  await expect(ribbon).toHaveText(
    NEWS ? `New in ${NEWS.version}. ${NEWS.lead} Release notes` : `New in ${VERSION}. Release notes`
  )
  await expect(ribbon.getByRole("link", { name: "Release notes" })).toHaveAttribute(
    "href",
    `${RELEASES}/tag/${NEWS && NEWS.version !== VERSION ? NEWS.version : TAG}`
  )
})

test("on a Mac, the Mac download is the button", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(Navigator.prototype, "platform", { get: () => "MacIntel" })
  )
  await page.goto("/")
  // On the first screen, and again at the end of the page.
  for (const at of [page.locator(".hero"), page.locator(".get-it")]) {
    await expect(at.locator(".btn")).toHaveText("Download for macOS")
    await expect(at.locator(".btn")).toHaveAttribute("href", MAC_ZIP)
    await expect(at.getByRole("link", { name: "Download for Windows" })).toHaveAttribute("href", WIN_ZIP)
    await expect(at.getByText(`Version ${VERSION} · Open source`)).toBeVisible()
  }
})

test("on Windows, the Windows download is the button", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(Navigator.prototype, "platform", { get: () => "Win32" })
  )
  await page.goto("/")
  for (const at of [page.locator(".hero"), page.locator(".get-it")]) {
    await expect(at.locator(".btn")).toHaveText("Download for Windows")
    await expect(at.locator(".btn")).toHaveAttribute("href", WIN_ZIP)
    await expect(at.getByRole("link", { name: "Download for macOS" })).toHaveAttribute("href", MAC_ZIP)
  }
})

test("the page ends with the downloads again, after the questions", async ({ page }) => {
  await page.goto("/")
  const end = page.locator(".get-it")
  await expect(end.getByRole("heading", { level: 2 })).toHaveText("Record the next rehearsal.")
  await expect(end.locator(".lede")).toHaveText("Free, for macOS and Windows. Plug in the interface, press Record take, play.")
  await expect(end.locator(".lede strong, .lede b")).toHaveText("Record take")
  const at = await page.evaluate(() => ({
    faq: document.querySelector("#faq")!.getBoundingClientRect().bottom,
    end: document.querySelector(".get-it")!.getBoundingClientRect(),
    oss: document.querySelector(".oss")!.getBoundingClientRect().top,
  }))
  expect(at.end.top).toBeGreaterThanOrEqual(at.faq)
  expect(at.end.bottom).toBeLessThanOrEqual(at.oss)
})

// A laptop's first screen shows a good part of the app, not just its top.
test("at 1440 by 900 the first screen shows 300 px of the app", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/")
  await expect(page.locator(".hero .eyebrow")).toHaveText("Our band's recorder, free for yours.")
  const top = await page.locator(".hero .live").evaluate((el) => el.getBoundingClientRect().top)
  expect(900 - top).toBeGreaterThanOrEqual(300)
})

/** How far apart two colours are for reading, as WCAG counts it. */
function contrast(a: number[], b: number[]) {
  const lum = (c: number[]) => {
    const [r, g, bl] = c.map((v) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// The red words over a heading read at 4.5:1, on white and on a tile.
test("the red words over the headings read at 4.5:1 where they stand", async ({ page }) => {
  await page.goto("/")
  for (const sel of [".hero .eyebrow", "#stories .eyebrow"]) {
    const [fg, bg] = await page.locator(sel).evaluate((el) => {
      // The colour as the browser draws it, in sRGB, whatever the CSS wrote.
      const rgb = (css: string) => {
        const c = document.createElement("canvas").getContext("2d")!
        c.fillStyle = css
        c.fillRect(0, 0, 1, 1)
        return [...c.getImageData(0, 0, 1, 1).data.slice(0, 3)]
      }
      let under: Element | null = el
      while (under && getComputedStyle(under).backgroundColor === "rgba(0, 0, 0, 0)") under = under.parentElement
      return [rgb(getComputedStyle(el).color), rgb(under ? getComputedStyle(under).backgroundColor : "#fff")]
    })
    expect(contrast(fg, bg), sel).toBeGreaterThanOrEqual(4.5)
  }
})

// Small links still take a finger: 24 px high at least.
test("the ribbon's and the footer's links are 24 px high", async ({ page }) => {
  await page.goto("/")
  const links = page.locator(".ribbon a, .footer a")
  expect(await links.count()).toBeGreaterThanOrEqual(4)
  for (const height of await links.evaluateAll((all) => all.map((a) => a.getBoundingClientRect().height)))
    expect(height).toBeGreaterThanOrEqual(24)
})

test("the controller has a block of its own after the steps, its photo beside its words", async ({ page }) => {
  await page.goto("/")
  const block = page.locator("#controller")
  await expect(block.getByRole("heading", { level: 2 })).toHaveText("Start a take without going to the laptop.")
  await expect(block.getByRole("link", { name: "Victor Baikov's controller on GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/viktor-baikov/reha-controller"
  )
  const photo = block.getByRole("img", { name: /^Victor Baikov's controller: a red REC button/ })
  await expect(photo).toBeVisible()
  await expect.poll(() => photo.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(1000)
  const at = await page.evaluate(() => ({
    steps: document.querySelector("#how")!.getBoundingClientRect().bottom,
    block: document.querySelector("#controller")!.getBoundingClientRect(),
    next: document.querySelector("#faq")!.getBoundingClientRect().top,
    copy: document.querySelector("#controller .copy")!.getBoundingClientRect(),
    photo: document.querySelector("#controller img")!.getBoundingClientRect(),
  }))
  expect(at.block.top).toBeGreaterThanOrEqual(at.steps)
  expect(at.block.bottom).toBeLessThanOrEqual(at.next)
  // Its four lines, the count-in last.
  await expect(block.locator("ul li")).toHaveCount(4)
  await expect(block.locator("ul li").last()).toHaveText(/^With the click on, REC counts the band in/)
  expect(at.copy.right).toBeLessThanOrEqual(at.photo.left)
  // The photo goes to the block's right edge, on the page's white: the
  // tiles are for the stories and the steps.
  expect(Math.abs(at.photo.right - at.block.right)).toBeLessThanOrEqual(1)
  await expect(block).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
})

// On a phone the photo is under the words, across the whole block, and the
// link still fits.
for (const width of [320, 390]) {
  test(`at ${width} px the controller's photo is across the block, and the page does not scroll sideways`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto("/")
    const block = (await page.locator("#controller").boundingBox())!
    const photo = (await page.locator("#controller img").boundingBox())!
    expect(Math.abs(photo.x - block.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(photo.x + photo.width - (block.x + block.width))).toBeLessThanOrEqual(1)
    expect(Math.abs(photo.y + photo.height - (block.y + block.height))).toBeLessThanOrEqual(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
  })
}

test("the steps follow the scroll, and the rail goes back", async ({ page }) => {
  await page.goto("/")
  const scenes = ["before", "during", "after", "later"]
  for (let i = 0; i < scenes.length; i++) {
    await toStep(page, i)
    await expect(page.locator(".rail button").nth(i)).toHaveAttribute("aria-current", "step")
    await expect.poll(() => story(page, "scene"), { timeout: 60_000 }).toBe(scenes[i])
  }
  await page.locator(".rail button").first().click()
  await expect(page.locator(".rail button").first()).toHaveAttribute("aria-current", "step")
  await expect.poll(() => story(page, "scene"), { timeout: 30_000 }).toBe("before")
  await expect(page.locator("#how iframe")).toHaveCount(1)
})

test("a click on a tile shows its piece over the app, lights the tile, and holds the app", async ({ page }) => {
  await page.goto("/")
  await toStep(page, 0)
  const set = item(page, "Rehearse the set, in order.")
  await set.click()
  await expect(set).toHaveAttribute("aria-pressed", "true")
  await expect(pressed(page)).toHaveCount(1)
  await expect(page.locator("#how .over").getByRole("img", { name: /Gig on the 25th/ })).toBeVisible()
  await expect.poll(() => story(page, "held")).toBe("true")
  // A card after it with a moment of the live app takes the piece away.
  await item(page, "Hear where you left off.").click()
  await expect(page.locator("#how .over")).toHaveCount(0)
  await expect(set).toHaveAttribute("aria-pressed", "false")
  await expect.poll(() => story(page, "held")).toBe("false")
})

test("a click on a card shows its moment of the live app", async ({ page }) => {
  await page.goto("/")
  await toStep(page, 0)
  await item(page, "Hear where you left off.").click()
  await expect.poll(() => story(page, "moment"), { timeout: 30_000 }).toBe("0.3")
  const frame = storyFrame(page).contentFrame()
  await expect(frame.locator("[aria-label='Last time'] button[aria-label^='Pause Pałyn 7']")).toBeVisible()
})

test("scrolling within a step keeps the window, and the next step clears it", async ({ page }) => {
  await page.goto("/")
  await toStep(page, 0)
  await item(page, "Hear where you left off.").click()
  await expect.poll(() => story(page, "moment"), { timeout: 30_000 }).toBe("0.3")
  await page.mouse.wheel(0, 100)
  await page.waitForTimeout(800)
  expect(await story(page, "moment")).toBe("0.3")
  await expect(item(page, "Hear where you left off.")).toHaveAttribute("aria-pressed", "true")

  await toStep(page, 1)
  await expect(pressed(page)).toHaveCount(0)
  await expect.poll(() => story(page, "scene"), { timeout: 60_000 }).toBe("during")
  await expect(page.locator("#how iframe")).toHaveCount(1)
})

// The review focus of the plan: things a visitor does that no step above
// does on its own.
test("two quick clicks on moments behind the app end on the second", async ({ page }) => {
  await page.goto("/")
  await toStep(page, 1)
  await expect.poll(() => story(page, "scene"), { timeout: 60_000 }).toBe("during")
  await item(page, "A count-in in big digits.").click()
  await item(page, "How long it took last time.").click()
  await expect
    .poll(() => storyFrames(page), { timeout: 45_000 })
    .toEqual([expect.objectContaining({ shown: "true", moment: "1.1" })])
  await page.waitForTimeout(1_500)
  expect(await story(page, "moment")).toBe("1.1")
  await expect(page.locator("#how iframe")).toHaveCount(1)
  await expect(item(page, "How long it took last time.")).toHaveAttribute("aria-pressed", "true")
})

test("a click before the app is up shows its moment once it is", async ({ page }) => {
  // The app's frames get their page only after the click.
  let open = () => {}
  const clicked = new Promise<void>((done) => (open = done))
  await page.route(/\/stage\.html/, async (route) => {
    await clicked
    await route.continue()
  })
  await page.goto("/", { waitUntil: "domcontentloaded" })
  await toStep(page, 0)
  await item(page, "Each interface knows its inputs.").click()
  open()
  await expect.poll(() => story(page, "moment"), { timeout: 30_000 }).toBe("0.1")
})

test("a card whose moment is in the next step keeps it while scrolling in its own", async ({ page }) => {
  await page.goto("/")
  await toStep(page, 2)
  await item(page, "The same bar in the next take.").click()
  await expect.poll(() => story(page, "moment"), { timeout: 90_000 }).toBe("3.4")
  await page.mouse.wheel(0, 120)
  await page.waitForTimeout(800)
  expect(await story(page, "moment")).toBe("3.4")
  await expect(page.locator(".rail button").nth(2)).toHaveAttribute("aria-current", "step")
  await expect(page.locator("#how iframe")).toHaveCount(1)
})

test("a piece on show stays in the window when the window narrows to a phone's", async ({ page }) => {
  await page.goto("/")
  await toStep(page, 0)
  await item(page, "Rehearse the set, in order.").click()
  const over = page.locator("#how .over")
  await expect(over.getByRole("img")).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(over.getByRole("img")).toBeVisible()
  const found = await page.evaluate(() => {
    const box = (s: string) => document.querySelector(s)!.getBoundingClientRect()
    return { view: box("#how .view"), over: box("#how .over"), piece: box("#how .over .piece") }
  })
  expect(found.over).toEqual(found.view)
  expect(found.piece.left).toBeGreaterThanOrEqual(found.over.left)
  expect(found.piece.right).toBeLessThanOrEqual(found.over.right)
  expect(found.piece.top).toBeGreaterThanOrEqual(found.over.top)
  expect(found.piece.bottom).toBeLessThanOrEqual(found.over.bottom)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
})

test("Space on a card shows its moment and does not scroll the page", async ({ page }) => {
  await page.goto("/")
  await toStep(page, 0)
  const card = item(page, "Hear where you left off.")
  await card.focus()
  const before = await page.evaluate(() => window.scrollY)
  await page.keyboard.press("Space")
  await expect(card).toHaveAttribute("aria-pressed", "true")
  expect(await page.evaluate(() => window.scrollY)).toBe(before)
  await expect.poll(() => story(page, "moment"), { timeout: 30_000 }).toBe("0.3")
})

test("a card brings the window near what it is about, and says more under it", async ({ page }) => {
  await page.goto("/")
  await toStep(page, 1)
  const about = page.locator("#how .about")
  await expect(about.locator("h4")).toHaveText("While you record.")
  await item(page, "A count-in in big digits.").click()
  await expect(about.locator("h4")).toHaveText("A count-in in big digits.")
  await expect(about.locator("p")).toContainText("With the click on, Record take counts the band in")
  await expect.poll(() => story(page, "moment"), { timeout: 60_000 }).toBe("1.0")
  // The frame is drawn 1.7 times nearer than the whole screen in the window.
  await expect
    .poll(() =>
      storyFrame(page).evaluate((el) => {
        const near = new DOMMatrix(getComputedStyle(el).transform).a
        return Math.round((near * 1180 * 100) / el.parentElement!.clientWidth) / 100
      })
    )
    .toBe(1.7)
  await toStep(page, 2)
  await expect(about.locator("h4")).toHaveText("After the take.")
})

// Lineups (lineups spec, section 4): a fourth tile in Before you play, whose
// moment is the band's tracks with the window near the lineup's title.
test("the lineups' tile is Before you play's fourth, and brings the window near Full band", async ({
  page,
}) => {
  await page.goto("/")
  await toStep(page, 0)
  await expect(page.locator("#how .step").first().locator("article.item.tile h4")).toHaveText([
    "Rehearse the set, in order.",
    "Every song keeps its tempo.",
    "A song brings its backing track.",
    "A lineup for each evening.",
  ])
  await item(page, "A lineup for each evening.").click()
  const about = page.locator("#how .about")
  await expect(about.locator("h4")).toHaveText("A lineup for each evening.")
  await expect(about.locator("p")).toContainText("Update keeps a change for good")
  await expect.poll(() => story(page, "moment"), { timeout: 30_000 }).toBe("0.1")
  // The title over the tracks, Full band of the band's three, in the window.
  const title = storyFrame(page).contentFrame().locator("[data-lineup]")
  await expect(title).toHaveAccessibleName("Full band")
  const seen = (await title.boundingBox())!
  const window = (await storyFrame(page).locator("..").boundingBox())!
  expect(seen.x).toBeGreaterThanOrEqual(window.x)
  expect(seen.y).toBeGreaterThanOrEqual(window.y)
  expect(seen.x + seen.width).toBeLessThanOrEqual(window.x + window.width)
  expect(seen.y + seen.height).toBeLessThanOrEqual(window.y + window.height)
})

/** Shows the piece an item is drawn with over the app, and finds it. A click
 *  as the button gets it: on a phone the window held at the top of the
 *  screen may be over the button. */
async function showPiece(page: Page, title: string) {
  await item(page, title).dispatchEvent("click")
  const piece = page.locator("#how .over .piece")
  await expect(piece).toBeVisible()
  return piece
}

/** The items drawn with a piece of their own, and what each piece is of. */
const PIECES: [string, RegExp][] = [
  ["Rehearse the set, in order.", /Gig on the 25th/],
  ["Tap the tempo on a pad.", /^The metronome's row with Pałyn picked, just after the drummer tapped/],
  ["A song brings its backing track.", /^Pałyn's backing track on its page in History: .*bar 1 at 0:00\.80$/],
  ["A tempo from an old take.", /^Pałyn's tempo on its page in History, counted from Pałyn 4/],
  ["The first take sets the tempo.", /^The metronome's row for a song with no tempo yet/],
  ["Notes too, from an e-kit or a keyboard.", /TD-17.*Launchkey Mini MK3/],
  ["The laptop stays awake.", /^A warning: “The laptop went to sleep at 21:14/],
  ["An unplugged interface ends the take.", /^A warning: “Recording stopped: no sound/],
  ["Disk space in hours.", /^Interface connected, room for about/],
  ["Marks say what happened.", /^Four takes of the song Pałyn/],
  ["Where the band ran ahead.", /^The Master row in the player under Pałyn 2's tracks/],
  ["Undo, for 10 seconds.", /^A notice that Pałyn 5 went to the (Trash|Recycle Bin), with Undo$/],
  ["Send takes to the band.", /^Settings › Folders at the cloud folder/],
  ["The cloud copy keeps up.", /marked as the one to keep, in the cloud$/],
  ["The tempo inside the WAVs.", /Write the tempo into WAV files ticked$/],
]

// Each piece is made smaller to fit the window where it is bigger than it,
// as the live app is: none goes past the window, on a laptop or a phone.
for (const width of [1280, 390]) {
  test(`at ${width} px every piece is the one its item says, and fits the window`, async ({ page }) => {
    await page.setViewportSize({ width, height: width > 900 ? 860 : 844 })
    await page.goto("/")
    for (const [title, label] of PIECES) {
      const piece = await showPiece(page, title)
      await expect(piece).toHaveAttribute("aria-label", label)
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const over = document.querySelector("#how .over")!.getBoundingClientRect()
              const piece = document.querySelector("#how .over .piece")!.getBoundingClientRect()
              return (
                piece.left >= over.left - 0.5 &&
                piece.right <= over.right + 0.5 &&
                piece.top >= over.top - 0.5 &&
                piece.bottom <= over.bottom + 0.5
              )
            }),
          { message: title }
        )
        .toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    }
  })
}

// What the window says of an item fits under it, never cut short.
for (const width of [1280, 390]) {
  test(`at ${width} px what the window says of every item fits under it`, async ({ page }) => {
    await page.setViewportSize({ width, height: width > 900 ? 860 : 844 })
    await page.goto("/")
    const titles = await page.locator("#how .items h4").allTextContents()
    expect(titles).toHaveLength(31)
    const about = page.locator("#how .about")
    for (const title of titles) {
      await item(page, title).dispatchEvent("click")
      await expect(about.locator("h4")).toHaveText(title)
      expect(await about.evaluate((el) => el.scrollHeight <= el.clientHeight), title).toBe(true)
    }
  })
}

test("the set's piece shows a rehearsal mid-set, the panel's line between the field and the set", async ({
  page,
}) => {
  await page.goto("/")
  const piece = await showPiece(page, "Rehearse the set, in order.")
  await expect(piece.locator("textarea")).toHaveValue("Viasna")
  const card = piece.locator("[data-set-card]")
  await expect(card.locator("h2")).toHaveText("Gig on the 25th · 1 of 6 played")
  await expect(card.locator("[data-set-song]")).toHaveText([
    /^1Pałyn4 takes$/,
    /^2Viasna$/,
    /^3Ahońnext$/,
    /^4Sonca$/,
    /^5Dym$/,
    /^6Ptuška$/,
  ])
  await expect(card.locator("[data-set-song='Viasna']")).toHaveAttribute("aria-current", "true")
  // The part the set sits in is the box the line is drawn on, as in the app.
  await expect(card.locator("xpath=..")).toHaveCSS("border-top-width", "1px")
})

test("the MIDI piece shows two lanes of notes, each with its plate, the part heard in the accent", async ({
  page,
}) => {
  await page.goto("/")
  const piece = await showPiece(page, "Notes too, from an e-kit or a keyboard.")
  const drums = piece.locator("[data-notes-plate='Drums']")
  await expect(drums).toContainText("TD-17")
  await expect(drums).toContainText("Saved as .mid, not played here")
  const keys = piece.locator("[data-notes-plate='Keys']")
  await expect(keys).toContainText("Launchkey Mini MK3")
  await expect(keys).toContainText("Saved as .mid, not played here")
  await expect(piece.locator("[data-notes-lane]")).toHaveCount(2)
  // The drums' rows are named, and the keys' octaves.
  await expect(piece.locator("[data-notes-lane='Drums']")).toContainText("Crash")
  await expect(piece.locator("[data-notes-lane='Drums']")).toContainText("Kick")
  await expect(piece.locator("[data-notes-lane='Keys']")).toContainText("C4")
  for (const name of ["Drums", "Keys"]) {
    const canvas = piece.locator(`[data-notes-lane='${name}'] canvas`)
    // Where the accent ends and the grey begins, as a share of the lane.
    const edge = () =>
      canvas.evaluate((el: HTMLCanvasElement) => {
        const { data, width, height } = el.getContext("2d")!.getImageData(0, 0, el.width, el.height)
        let lastAccent = -1
        let firstGrey = width
        for (let x = 0; x < width; x++)
          for (let y = 0; y < height; y++) {
            const i = (y * width + x) * 4
            if (data[i + 3] < 40) continue
            // The accent is blue, the unheard notes a dark grey; the lines
            // between the rows are a light one.
            if (data[i + 2] - data[i] > 60) lastAccent = Math.max(lastAccent, x)
            else if (data[i] < 150) firstGrey = Math.min(firstGrey, x)
          }
        return { accent: lastAccent / width, grey: firstGrey / width }
      })
    await expect.poll(async () => (await edge()).accent, { message: name }).toBeGreaterThan(0.5)
    const { accent, grey } = await edge()
    // A bar into the bridge of eight bars, five eighths of the way.
    expect(accent).toBeLessThan(0.7)
    expect(grey).toBeGreaterThanOrEqual(accent - 0.01)
    expect(grey).toBeLessThan(1)
  }
  // Nothing moves: the notes are drawn once.
  const drawn = () =>
    piece.locator("canvas").evaluateAll((all) => all.map((c) => (c as HTMLCanvasElement).toDataURL()).join())
  const before = await drawn()
  await page.waitForTimeout(500)
  expect(await drawn()).toBe(before)
})

// The name on a plate is whole from the narrowest phone to a wide screen:
// none of its words is broken across lines or sticks out of it. The item's
// title keeps e-kit whole too, rather than end a line on "e-".
for (const width of [320, 390, 1280]) {
  test(`at ${width} px the Launchkey Mini MK3 is whole on its plate, and e-kit in the title`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto("/")
    const piece = await showPiece(page, "Notes too, from an e-kit or a keyboard.")
    const plate = piece.locator("[data-notes-plate='Keys']")
    await expect(plate).toContainText("Launchkey Mini MK3")
    const found = await plate.evaluate((el) => {
      const box = el.getBoundingClientRect()
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      const broken: string[] = []
      const outside: string[] = []
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (const word of node.textContent!.matchAll(/\S+/g)) {
          const range = document.createRange()
          range.setStart(node, word.index!)
          range.setEnd(node, word.index! + word[0].length)
          if (range.getClientRects().length > 1) broken.push(word[0])
          const r = range.getBoundingClientRect()
          if (r.left < box.left - 0.5 || r.right > box.right + 0.5) outside.push(word[0])
        }
      }
      return { broken, outside, overflow: el.scrollWidth - el.clientWidth }
    })
    expect(found).toEqual({ broken: [], outside: [], overflow: 0 })
    const lines = await item(page, "Notes too, from an e-kit or a keyboard.").evaluate((el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node.textContent!.indexOf("e-kit")
        if (at < 0) continue
        const range = document.createRange()
        range.setStart(node, at)
        range.setEnd(node, at + "e-kit".length)
        return range.getClientRects().length
      }
      return 0
    })
    expect(lines).toBe(1)
  })
}

test("the tap's piece is the row just after a tap, and ends under its line", async ({ page }) => {
  await page.goto("/")
  const piece = await showPiece(page, "Tap the tempo on a pad.")
  const row = piece.locator("section[aria-label='Metronome']")
  await expect(row.locator("input[aria-label='Tempo']")).toHaveValue("131")
  await expect(row.locator("[aria-label='Time signature']")).toHaveText("4/4")
  const line = row.locator("[data-status-line]")
  await expect(line).toContainText("this holds until another song.")
  await expect(line.getByRole("button", { name: "Save to song" })).toBeVisible()
  // The row's line keeps two lines' room in the app, so a longer one moves
  // nothing under it. A still picture has nothing to keep still for.
  const found = await line.evaluate((el) => {
    const words = document.createRange()
    words.selectNodeContents(el)
    return { box: el.getBoundingClientRect().height, words: words.getBoundingClientRect().height }
  })
  expect(found.box).toBeLessThanOrEqual(found.words + 1)
})

test("the backing track's piece is Palyn's page: the file, bar 1 at 0:00.80, the bars over the file's start", async ({
  page,
}) => {
  await page.goto("/")
  const piece = await showPiece(page, "A song brings its backing track.")
  await expect(piece.locator("[data-backing-file]")).toContainText("Pałyn backing.wav")
  await expect(piece.locator("input[aria-label='Bar 1 at']")).toHaveValue("0:00.80")
  const start = piece.locator("[data-file-start]")
  await expect(start.locator("canvas")).toHaveCount(1)
  await expect(start.locator("[data-bar]").first()).toBeVisible()
  await expect(piece.locator("[data-backing-line]")).not.toBeEmpty()
})

test("on a phone the backing track's piece wraps its first row: the name shows, nothing on top of it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/")
  const piece = await showPiece(page, "A song brings its backing track.")
  const found = await piece.evaluate((el) => {
    const file = el.querySelector("[data-backing-file]")!.getBoundingClientRect()
    const name = el.querySelector("[data-backing-file] > span")!.getBoundingClientRect()
    const field = el.querySelector("input[aria-label='Bar 1 at']")!.getBoundingClientRect()
    return { name: name.width, fileRight: file.right, fileBottom: file.bottom, fieldLeft: field.left, fieldTop: field.top }
  })
  expect(found.name).toBeGreaterThan(40)
  expect(found.fileBottom <= found.fieldTop || found.fileRight <= found.fieldLeft).toBe(true)
})

test("a piece is a picture: nothing plays, nothing to press, and T taps nothing", async ({ page }) => {
  await page.goto("/")
  const piece = await showPiece(page, "Tap the tempo on a pad.")
  await expect(piece.locator("[inert]")).toHaveCount(1)
  await expect(page.locator("#how .over").locator("audio, video")).toHaveCount(0)
  // T is Tap's key in the app, anywhere outside a field. What the page
  // asks of the fake bridge about the click is noted from here on.
  await page.evaluate(() => {
    type Bridge = Record<string, (...args: unknown[]) => unknown>
    const w = window as unknown as { pywebview: { api: Bridge }; __asked: string[] }
    w.__asked = []
    const bridge = w.pywebview.api
    for (const name of Object.keys(bridge).filter((n) => /metronome|click/.test(n))) {
      const real = bridge[name]
      bridge[name] = (...args) => {
        w.__asked.push(name)
        return real(...args)
      }
    }
  })
  await page.keyboard.press("t")
  await page.waitForTimeout(500)
  expect(await page.evaluate(() => (window as unknown as { __asked: string[] }).__asked)).toEqual([])
})

// The Master row of Pałyn 2 (drift spec, "On reha.stream"): the band's tempo
// bar by bar on its lane, its plate left out as the player leaves it out
// where the lane would be too short for its tag and its chips.
for (const width of [1280, 390]) {
  test(`at ${width} px the drift's piece shows Master's lane of Palyn 2 with where the band drifted`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto("/")
    const piece = await showPiece(page, "Where the band ran ahead.")
    await expect(piece).toHaveAttribute(
      "aria-label",
      /Tempo: ahead 6 bpm, bars \d+ to \d+; ahead 7 bpm, bars \d+ to \d+; behind 5 bpm, bars \d+ to \d+\.$/
    )
    const lane = piece.locator("[data-master-lane]")
    await expect(lane.locator("[data-click-tag]")).toHaveText("No click · 128 bpm · 4/4")
    await expect(piece.locator("[data-master-plate]")).toHaveCount(0)
    await expect(lane.locator("[data-drift-chip]")).toHaveText(["+6", "+7", "−5"])
    await expect(lane.locator("[data-drift-stretch]")).toHaveCount(3)
    const found = await piece.evaluate((el) => {
      const box = (e: Element) => e.getBoundingClientRect()
      return { lane: box(el.querySelector("[data-master-lane]")!), chips: [...el.querySelectorAll("[data-drift-chip]")].map(box) }
    })
    for (const c of found.chips) {
      expect(c.left).toBeGreaterThanOrEqual(found.lane.left)
      expect(c.right).toBeLessThanOrEqual(found.lane.right)
      expect(c.top).toBeGreaterThanOrEqual(found.lane.top)
      expect(c.bottom).toBeLessThanOrEqual(found.lane.bottom)
    }
  })
}

// The app's line holds, unseen, the room of the longest thing it can say,
// so that it never moves during a take. A still picture has nothing to keep
// still for: its box ends where its words do.
test("the disk's piece is as wide as its words, with no room held for a longer sentence", async ({ page }) => {
  await page.goto("/")
  const piece = await showPiece(page, "Disk space in hours.")
  const health = piece.locator("[data-health]")
  const words = health.getByText("Interface connected · room for")
  await expect(words).toBeVisible()
  const said = (await words.locator("..").boundingBox())!
  const box = (await health.boundingBox())!
  expect(box.width).toBeLessThanOrEqual(said.width + 2)
  expect(box.height).toBeLessThanOrEqual(said.height + 2)
})

test("at 1920 px the page is 1440 px wide, in the middle", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto("/")
  const wrap = (await page.locator(".wrap").boundingBox())!
  expect(wrap.width).toBe(1440)
  expect(wrap.x).toBe(240)
})

test("a frame scrolled past holds still", async ({ page }) => {
  await page.goto("/")
  await expect.poll(() => heldIn(page, "hero"), { timeout: 20_000 }).toBe("false")
  await page.locator("#faq").evaluate((el) => el.scrollIntoView())
  await expect.poll(() => heldIn(page, "hero")).toBe("true")
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect.poll(() => heldIn(page, "hero")).toBe("false")
})

// Vercel's scripts themselves are only on Vercel, once the project has Web
// Analytics and Speed Insights switched on; here they are missing files.
test("the page counts its visit and its speed with Vercel's scripts, the app in it does not", async ({ page }) => {
  const scripts = ['script[src="/_vercel/insights/script.js"]', 'script[src="/_vercel/speed-insights/script.js"]']
  await page.goto("/")
  for (const script of scripts) await expect(page.locator(script)).toHaveCount(1)
  await expect.poll(() => sceneIn(page, "hero"), { timeout: 20_000 }).toBe("hero")
  for (const script of scripts) await expect(frame(page, "hero").contentFrame().locator(script)).toHaveCount(0)
})

// All of it is in the HTML as the build wrote it, for readers that run no
// script: search engines, AI crawlers, and chats drawing a card for a link.
test("the page tells search engines and chats what it is", async ({ page, request }) => {
  await page.goto("/")
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", "https://reha.stream/og.png")
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image")
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://reha.stream/")
  const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!)
  expect(ld.softwareVersion).toBe(VERSION)
  expect(await page.locator("noscript").textContent()).toContain(MAC_ZIP)
  expect(await (await request.get("/robots.txt")).text()).toContain("Sitemap: https://reha.stream/sitemap.xml")
  expect(await (await request.get("/sitemap.xml")).text()).toContain("<loc>https://reha.stream/</loc>")
})

// Google's results show a site's icon only from the formats it lists (BMP,
// GIF, ICO, PNG, JPEG, PPM, TIFF; not SVG), square and best over 48 px; the
// home page's <link rel="icon"> says where it is.
test("the page names an icon Google's results can show", async ({ page, request }) => {
  await page.goto("/")
  const href = await page.locator('link[rel="icon"][type="image/png"]').getAttribute("href")
  const png = await (await request.get(href!)).body()
  expect(png.subarray(1, 4).toString()).toBe("PNG")
  const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)]
  expect(height).toBe(width)
  expect(width).toBeGreaterThan(48)
  expect(width % 48).toBe(0)
  // Where browsers and crawlers look when a page names no icon.
  const ico = await request.get("/favicon.ico")
  expect(ico.status()).toBe(200)
  expect([...(await ico.body()).subarray(0, 4)]).toEqual([0, 0, 1, 0])
})

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test("the page fits, and the app in it only shows", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
    await expect(frame(page, "hero")).toHaveCSS("pointer-events", "none")
    await expect(page.getByText("Try it on a computer.")).toBeVisible()
  })

  // Nothing is held at the top of the screen: the window stands in the room
  // at the top of the step on show, and the rail, with the steps one under
  // another, is not there.
  test("the window stands at the top of the step on show", async ({ page }) => {
    await page.goto("/")
    await expect(page.locator(".rail")).toBeHidden()
    for (let i = 0; i < 4; i++) {
      await toStep(page, i)
      await expect(page.locator(".rail button").nth(i)).toHaveAttribute("aria-current", "step")
      await expect
        .poll(() =>
          page.evaluate((n) => {
            const stage = document.querySelector("#how .stage")!.getBoundingClientRect()
            const slot = document.querySelectorAll("#how .slot")[n].getBoundingClientRect()
            return Math.abs(stage.top - slot.top) <= 1 && Math.abs(stage.height - slot.height) <= 1
          }, i)
        )
        .toBe(true)
    }
    await expect(page.locator("#how .stage")).toHaveCSS("position", "absolute")
  })

  // The card at the top of the screen, its step's window above it, off the
  // screen: a tap brings the window back, in the card's step, showing it.
  test("a card far under the window brings the window back, showing it", async ({ page }) => {
    await page.goto("/")
    const card = item(page, "Disk space in hours.")
    await card.evaluate((el) => window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - 40))
    await card.tap()
    await expect(page.locator("#how .about h4")).toHaveText("Disk space in hours.")
    await expect
      .poll(() =>
        page.evaluate(() => {
          const stage = document.querySelector("#how .stage")!.getBoundingClientRect()
          const slot = document.querySelectorAll("#how .slot")[1].getBoundingClientRect()
          return Math.abs(stage.top - slot.top) <= 1 && stage.top >= 0 && stage.bottom <= window.innerHeight
        })
      )
      .toBe(true)
    await expect(card).toHaveAttribute("aria-pressed", "true")
  })
})

// The headings in Geologica, from the site itself, on every page that has
// them; and the icon's red as a dot before the words over a heading.
for (const path of ["/", "/stories", "/stories/tempo-drift", "/404.html"]) {
  test(`on ${path} the headings are in Geologica, from the site, with the red dot over them`, async ({ page }) => {
    const away: string[] = []
    page.on("request", (r) => {
      if (/fonts\.(googleapis|gstatic)\.com/.test(r.url())) away.push(r.url())
    })
    await page.goto(path)
    const heading = page.getByRole("heading", { level: 1 })
    await expect(heading).toHaveCSS("font-family", /^"?Geologica"?,/)
    await page.evaluate(() => document.fonts.ready)
    const loaded = await page.evaluate(() =>
      [...document.fonts].some((f) => f.family.replace(/"/g, "") === "Geologica" && f.status === "loaded")
    )
    expect(loaded).toBe(true)
    expect(away).toEqual([])
    const dot = await page
      .locator(".eyebrow")
      .first()
      .evaluate((el) => {
        const s = getComputedStyle(el, "::before")
        return { color: s.backgroundColor, width: s.width, radius: s.borderRadius }
      })
    expect(dot).toEqual({ color: "rgb(229, 72, 77)", width: "9px", radius: "50%" })
  })
}
