import { test as base, expect, type Locator, type Page } from "@playwright/test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

export { expect }

/** How long the fake's own takes are: TAKE in fake-bridge.js. */
export const TAKE_SECONDS = 6

const FAKE = fileURLToPath(new URL("./fake-bridge.js", import.meta.url))
const BAND = fileURLToPath(new URL("./band.js", import.meta.url))
const STRESS = fileURLToPath(new URL("./stress.js", import.meta.url))
const STRESS_REHEARSAL = fileURLToPath(new URL("./stress-rehearsal.js", import.meta.url))
const STRESS_RECORDING = fileURLToPath(new URL("./stress-recording.js", import.meta.url))

/**
 * Every test fails on an error in the page: an exception, or anything the
 * app writes to the console as an error. /api/... is not served here, on
 * purpose — the interface polls over the bridge then — so the browser's own
 * complaint about that is not one.
 */
export const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ context }, use) => {
      const errors: string[] = []
      const watch = (page: Page) => {
        page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`))
        page.on("console", (m) => {
          if (
            m.type() === "error" &&
            !m.location().url.includes("/api/") &&
            !m.text().includes("Failed to load resource")
          ) {
            errors.push(`console.error: ${m.text()}`)
          }
        })
      }
      await context.addInitScript(() => {
        if (!Object.prototype.hasOwnProperty.call(navigator, "platform"))
          Object.defineProperty(navigator, "platform", { get: () => "Linux x86_64", configurable: true })
      })
      context.pages().forEach(watch)
      context.on("page", watch)
      await use(errors)
      expect(errors, "errors in the page").toEqual([])
    },
    { auto: true },
  ],
})

/**
 * For a test where an error in the console is the point: a call into Python
 * that fails is written there by the bridge. Checks it was, and takes it off
 * the list the test fails on.
 */
export function expectedError(errors: string[], pattern: RegExp) {
  expect(errors.some((e) => pattern.test(e)), `an error like ${pattern}`).toBe(true)
  for (let i = errors.length - 1; i >= 0; i--) if (pattern.test(errors[i])) errors.splice(i, 1)
}

/**
 * Opens the app against the fake Python side.
 *
 * `before` runs ahead of the fake, to set it up: window.__LEVELS__,
 * window.__DRAFTS__ and the rest that fake-bridge.js reads. `after` runs once
 * the fake is in place, to change one of its answers.
 *
 * With `stress: "recording"`, the band and stress-rehearsal.js are under the
 * fake and stress-recording.js over them: take 33, the second of the longest
 * song name, is recording when the app comes up, and this returns once its
 * clock is on screen. `before` and `after` still wrap it.
 */
export async function openApp(
  page: Page,
  {
    before,
    after,
    stress,
    waitUntil = "load",
  }: {
    before?: string
    after?: string
    stress?: "recording"
    waitUntil?: "load" | "domcontentloaded" | "networkidle"
  } = {}
) {
  if (before) await page.addInitScript(before)
  if (stress) {
    // One script, not two, as in openBandApp: the fake's top-level `let`s are
    // not seen from a second init script.
    const source = [FAKE, BAND, STRESS_REHEARSAL, STRESS_RECORDING]
      .map((f) => readFileSync(f, "utf-8"))
      .join("\n")
    await page.addInitScript(source)
  } else {
    await page.addInitScript({ path: FAKE })
  }
  if (after) await page.addInitScript(after)
  await page.goto("/", { waitUntil })
  // The fixture presses Record itself, and keeps trying for 10 s: the screen
  // is up once the clock is.
  if (stress) await expect(page.locator("[role=timer]")).toBeVisible({ timeout: 10_000 })
}

/**
 * Opens the app with the band laid over the fake: four musicians, their
 * song and their past rehearsals, as the docs' pictures and the site show
 * them. See band.js. With `stress: true`, stress.js is laid over the band:
 * long names, thirteen songs last time, seven not played, five tracks. With
 * `stress: "rehearsal"`, stress-rehearsal.js is: a rehearsal of 32 takes,
 * eight tracks with one on MIDI alone, and a set of ten songs.
 */
export async function openBandApp(
  page: Page,
  { stress = false }: { stress?: boolean | "rehearsal" } = {}
) {
  // One script, not two: the band sets the fake's top-level `let`s, which a
  // second init script would not see.
  const laid = stress === "rehearsal" ? [STRESS_REHEARSAL] : stress ? [STRESS] : []
  const source = [FAKE, BAND, ...laid].map((f) => readFileSync(f, "utf-8")).join("\n")
  await page.addInitScript(source)
  await page.goto("/")
}

type Call = { name: string; args: unknown[] }

/** The calls the interface made into the fake Python side, by name. */
export function calls(page: Page, name: string): Promise<Call[]> {
  return page.evaluate(
    (n) => (window as unknown as { __CALLS__: Call[] }).__CALLS__.filter((c) => c.name === n),
    name
  )
}

/** How many times the interface has called that, for expect.poll. */
export async function callCount(page: Page, name: string): Promise<number> {
  return (await calls(page, name)).length
}

/**
 * Holds the fake's answer to `name` where it is until `letGo` lets it
 * through: the call is made, and counted, and waits (window.__HOLD__, which
 * fake-bridge.js reads). Anything else held stays held.
 */
export async function hold(page: Page, name: string) {
  await page.evaluate((n) => {
    const w = window as unknown as {
      __HOLD__?: Record<string, Promise<void>>
      __RELEASE__?: Record<string, () => void>
    }
    w.__HOLD__ = w.__HOLD__ || {}
    w.__RELEASE__ = w.__RELEASE__ || {}
    w.__HOLD__[n] = new Promise<void>((r) => (w.__RELEASE__![n] = r))
  }, name)
}

/** Lets the calls to `name` that `hold` held through, and the next ones. */
export async function letGo(page: Page, name: string) {
  await page.evaluate((n) => {
    const w = window as unknown as {
      __HOLD__: Record<string, Promise<void>>
      __RELEASE__: Record<string, () => void>
    }
    delete w.__HOLD__[n]
    w.__RELEASE__[n]()
  }, name)
}

/**
 * Holds the fake's answers to `name` for one `arg`, its first argument,
 * until `letThrough`, and answers every other call to it at once: one
 * song's or label's read left waiting while the others come back. The
 * fake logs a held call only once it is let through, so `calls` and
 * `callCount` do not see it before; `waitingFor` says how many are held,
 * and is back to 0 once they have been answered.
 */
export async function holdFor(page: Page, name: string, arg: unknown) {
  await page.evaluate(
    ([n, a]) => {
      const w = window as unknown as {
        pywebview: { api: Record<string, (...args: unknown[]) => Promise<unknown>> }
        __WAITING__?: number
        __LET_THROUGH__?: () => void
      }
      const api = w.pywebview.api
      const answer = api[n as string]
      const gate = new Promise<void>((r) => (w.__LET_THROUGH__ = r))
      w.__WAITING__ = 0
      api[n as string] = async (...args) => {
        if (args[0] !== a) return answer(...args)
        w.__WAITING__! += 1
        await gate
        const said = await answer(...args)
        w.__WAITING__! -= 1
        return said
      }
    },
    [name, arg] as const
  )
}

/** How many of the calls `holdFor` holds are not answered yet. */
export const waitingFor = (page: Page) =>
  page.evaluate(() => (window as unknown as { __WAITING__?: number }).__WAITING__ ?? 0)

/** Lets the calls `holdFor` held through, and the next ones. */
export async function letThrough(page: Page) {
  await page.evaluate(() => (window as unknown as { __LET_THROUGH__: () => void }).__LET_THROUGH__())
}

/** The key a button shows it answers to, or null when it shows none: a chip
 *  kept unseen, holding the button's width, shows none. */
export async function keyOn(button: Locator): Promise<string | null> {
  const key = button.locator(":is(kbd, [data-key])").filter({ visible: true })
  return (await key.count()) ? (await key.first().innerText()).trim() : null
}

/** The setup screen, as the app opens on it. */
export function startButton(page: Page): Locator {
  return page.getByRole("button", { name: /Start rehearsal/ })
}

/**
 * The setup screen's Last time button, in the header of a window too narrow
 * for Last time beside the setup. Hidden from a screen reader with the rest
 * of the page while its panel is open, as a modal hides it.
 */
export function lastTimeButton(page: Page): Locator {
  return page.locator("header").getByRole("button", { name: /^Last time/, includeHidden: true })
}

/**
 * History, from the setup screen. It opens on the newest rehearsal, beside
 * the list; `name` chooses another from the list. Returns the list.
 */
export async function openHistory(page: Page, name?: string): Promise<Locator> {
  await page.getByRole("button", { name: "History", exact: true }).click()
  const list = page.getByRole("navigation", { name: "Rehearsals" })
  await expect(list).toBeVisible()
  if (name) await list.getByRole("button", { name: new RegExp(`^${name}`) }).click()
  return list
}

/** From the setup screen into a rehearsal, ready to record take `n`, once
 *  the Next take panel has risen into place: a box in it is measured then. */
export async function startRehearsal(page: Page, n = 1) {
  await startButton(page).click()
  await expect(page.getByRole("button", { name: new RegExp(`Record take ${n}`) })).toBeVisible()
  await settled(page)
}

/** Records take `n` and stops it, leaving it up for review once the
 *  player's groups have risen into place: a box in them is measured then. */
export async function recordTake(page: Page, n = 1) {
  await page.getByRole("button", { name: new RegExp(`Record take ${n}`) }).click()
  await page.getByRole("button", { name: /^Stop/ }).click()
  await expect(page.locator("[data-take-summary]")).toBeVisible()
  await settled(page)
}

/** Names the take on the screen after it, through its pencil and Rename
 *  take, and leaves it up for review. */
export async function nameTake(page: Page, name: string) {
  await page.locator("[data-take-summary]").getByRole("button", { name: "Rename take" }).click()
  const dialog = page.getByRole("dialog", { name: "Rename take" })
  await dialog.locator("#take-name").fill(name)
  await page.keyboard.press("Enter")
  await expect(dialog).toHaveCount(0)
}

/** Draws a region across the timeline, the way a person does: pressed,
 *  dragged and let go, between two fractions of its width. */
export async function dragRegion(page: Page, from: number, to: number) {
  const box = (await page.getByRole("group", { name: "Take timeline" }).boundingBox())!
  const y = box.y + box.height / 2
  await page.mouse.move(box.x + box.width * from, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * to, y, { steps: 10 })
  await page.mouse.up()
}

/** The bar across the top that says something failed in Python. */
export function problemBar(page: Page): Locator {
  return page.locator("[role='alert'][aria-label='Something went wrong']")
}

/** The notices in the corner, or those of one kind. */
export function notices(page: Page, kind?: string): Locator {
  return page.locator(
    kind
      ? `section[aria-label='Notifications'] [data-notice='${kind}']`
      : "section[aria-label='Notifications'] [data-notice]"
  )
}

/** `text` as a regular expression that matches it literally. */
export function literally(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Sets something on the fake while the page runs: window.__IFACE_GONE__
 *  and the rest in fake-bridge.js. */
export async function setFake(page: Page, name: string, value: unknown) {
  await page.evaluate(
    ([n, v]) => {
      ;(window as unknown as Record<string, unknown>)[n as string] = v
    },
    [name, value] as const
  )
}

/**
 * Tonight is ten takes, the rehearsal started with them already in it:
 *   1 Pałyn 3:20 ★          2 Pałyn 0:12 ★         3 Viasna 0:12, a mark
 *   4 Pałyn 0:12            5 Viasna 3:00 ★ mix    6 Take 6 2:30
 *   7 Viasna 3:10           8 Pałyn 3:30           9 Sonca 2:50 ★ tracks
 *  10 Take 10 0:08
 * So with the 30 s default 4 and 10 are false starts, and 1 and 2 are the
 * ★ takes with nothing in the cloud folder.
 */
export const TONIGHT = [
  { name: "Pałyn", duration_sec: 200, starred: true },
  { name: "Pałyn", duration_sec: 12, starred: true },
  { name: "Viasna", duration_sec: 12, markers: [{ at: 4, note: "", label_id: 1 }] },
  { name: "Pałyn", duration_sec: 12 },
  { name: "Viasna", duration_sec: 180, starred: true, cloud: { mix: "/cloud/Viasna 2.mp3" } },
  { name: "Take 6", duration_sec: 150 },
  { name: "Viasna", duration_sec: 190 },
  { name: "Pałyn", duration_sec: 210 },
  { name: "Sonca", duration_sec: 170, starred: true, cloud: { tracks: "/cloud/Sonca 1" } },
  { name: "Take 10", duration_sec: 8 },
]

/** Opens a rehearsal with `tonight`'s takes in it and a cloud folder set, and
 *  returns the overview of the evening. `before` runs ahead of the fake. */
export async function openEvening(page: Page, before = "", tonight: object[] = TONIGHT) {
  await openApp(page, {
    before: `window.__TONIGHT__ = ${JSON.stringify(tonight)};
             window.__CLOUD_DIR__ = '/cloud'; ${before}`,
  })
  await startRehearsal(page, tonight.length + 1)
  const overview = page.locator("[aria-label='Rehearsal overview']")
  await expect(overview).toBeVisible()
  return overview
}

/** A song set as the fake's library keeps it. */
export type SetSeed = { id: number; name: string; songs: string[] }

/** A set of four songs, the one the set tests play by. */
export const GIG: SetSeed = {
  id: 1,
  name: "Gig on the 25th",
  songs: ["Pałyn", "Viasna", "Ahoń", "Sonca"],
}

/** A page script: the library has these sets and Start plays by `chosen`.
 *  `more` runs after it. */
export function withSets(sets: SetSeed[] = [GIG], chosen: number | null = 1, more = "") {
  return (
    `window.__SETS__ = ${JSON.stringify(sets)};` +
    `localStorage.setItem("mock-python-config", JSON.stringify(` +
    `{theme: "dark", ui_scale: 1, next_set: ${JSON.stringify(chosen)}}));` +
    more
  )
}

/** A page script: Space and Esc (`space`), or the player's keys (`player`),
 *  turned on or off in Settings › Keys. Merged into the config the fake
 *  keeps, so it comes after withSets, scaled or themed: they write it whole. */
export function withKeys({ space, player }: { space?: boolean; player?: boolean }) {
  const keys = JSON.stringify({ space_keys: space, player_keys: player })
  return (
    `localStorage.setItem("mock-python-config", JSON.stringify({` +
    `...(JSON.parse(localStorage.getItem("mock-python-config")) || {theme: "dark", ui_scale: 1}),` +
    `...${keys}}));`
  )
}

/** From now on, at every frame, which page head is drawn: its title (the
 *  h2's name), or null in a frame with none. `headsSeen` stops and says them. */
export const watchHeads = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __HEADS__: (string | null)[]; __WATCHING__: boolean }
    w.__HEADS__ = []
    w.__WATCHING__ = true
    const look = () => {
      if (!w.__WATCHING__) return
      w.__HEADS__.push(document.querySelector("[data-pane-head] h2")?.getAttribute("aria-label") ?? null)
      requestAnimationFrame(look)
    }
    requestAnimationFrame(look)
  })
export const headsSeen = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __HEADS__: (string | null)[]; __WATCHING__: boolean }
    w.__WATCHING__ = false
    return w.__HEADS__
  })

/** Until the screen's groups have risen into place: a box measured while one
 *  rises is up to 12 px off. */
export const settled = (page: Page) =>
  page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => (a as CSSAnimation).animationName !== "rise" || a.playState === "finished")
  )

/** The Appearance scale, as Settings stores it: the root font size follows. */
export const scaled = (scale: number) =>
  `window.localStorage.setItem('mock-python-config', JSON.stringify({theme:'dark', ui_scale:${scale}}));`

/** The theme, as Settings stores it, at the scale of 1. Run before the fake
 *  reads it; dark is also what the fake has when nothing is stored. */
export const themed = (theme: "dark" | "light") =>
  `window.localStorage.setItem('mock-python-config', JSON.stringify({theme:'${theme}', ui_scale:1}));`

/** A colour the theme defines, as the browser computes it. */
export const colour = (page: Page, token: string) =>
  page.evaluate((t) => {
    const probe = document.createElement("div")
    probe.style.backgroundColor = `var(${t})`
    document.body.append(probe)
    const value = getComputedStyle(probe).backgroundColor
    probe.remove()
    return value
  }, token)

export const style = (el: Locator, ...props: string[]) =>
  el.evaluate((e, ps) => {
    const cs = getComputedStyle(e)
    return Object.fromEntries(ps.map((p) => [p, cs.getPropertyValue(p)]))
  }, props)

/** A theme colour mixed with nothing, `percent` strong, as the browser computes it. */
export const mixed = (page: Page, token: string, percent: number) =>
  page.evaluate(
    ([t, p]) => {
      const probe = document.createElement("div")
      probe.style.backgroundColor = `color-mix(in oklab, var(${t}) ${p}%, transparent)`
      document.body.append(probe)
      const value = getComputedStyle(probe).backgroundColor
      probe.remove()
      return value
    },
    [token, percent] as const
  )

/** The four sides of a box, for `style`: its edge's colour and width. */
export const EDGE = ["top", "right", "bottom", "left"].flatMap((s) => [`border-${s}-color`, `border-${s}-width`])

/** A dash set in a sentence: an em dash, or an en dash or a hyphen with a
 *  space on each side. A range, as in "1–2", and a hyphen in a word are not. */
export const DASH = /—|\s[–-]\s/

/**
 * The lines of the tooltip `el` shows once the pointer rests on it, one to a
 * line; none when it shows none, long after one would have. It goes away
 * first, so each call reads the tooltip afresh: poll it for one that changes.
 */
export async function tipLines(page: Page, el: Locator): Promise<string[]> {
  const tip = page.getByRole("tooltip")
  // Away in steps: a tooltip waits for the pointer to leave the way to it.
  await page.mouse.move(0, 0, { steps: 8 })
  await expect(tip).toHaveCount(0)
  await el.hover()
  // A tooltip shows 400 ms after the pointer comes; by twice that, none is none.
  const shown = await tip.waitFor({ state: "attached", timeout: 800 }).then(
    () => true,
    () => false
  )
  if (!shown) return []
  return tip.evaluate((t) =>
    [...t.children].filter((c) => c.tagName === "DIV").map((c) => c.textContent ?? "")
  )
}

/**
 * How each tile on the recording screen draws its track's name, in order:
 * - `px`, its size as drawn;
 * - `lines`, the lines it is drawn on (up the tile a line is as wide as its
 *   line height), and `said`, the lines it says it has (data-lines);
 * - `cut`, whether it says it is cut (data-cut);
 * - `whole`: not cut, all of it, on two lines at most, no taller than its
 *   box;
 * - `upward` and `corner`: written up the tile from its bottom left corner;
 * - `text`, what is drawn.
 */
export const tileNames = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("main [role=group]")].map((t) => {
      const name = t.getAttribute("aria-label") ?? ""
      const el = t.querySelector("[data-name]")
      if (!el)
        return { name, text: "", px: 0, lines: 0, said: 0, cut: false, whole: false, upward: false, corner: false }
      const cs = getComputedStyle(el)
      const tile = t.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      const lines = Math.round(r.width / parseFloat(cs.lineHeight))
      const cut = el.hasAttribute("data-cut")
      const text = el.textContent ?? ""
      return {
        name,
        text,
        px: parseFloat(cs.fontSize),
        lines,
        said: Number(el.getAttribute("data-lines")),
        cut,
        whole: !cut && text === name && lines <= 2 && el.scrollHeight <= el.clientHeight + 1,
        upward: cs.writingMode === "vertical-rl" && cs.transform !== "none",
        corner: r.left - tile.left < 24 && tile.bottom - r.bottom < 24,
      }
    })
  )

/** How each tile writes its track's name: up the tile, whole, from its
 *  bottom left corner, on the lines it says it has, and on two only where it
 *  has a space to break at — "Overheads" broken into "Overhea / ds" across a
 *  narrow tile is what this replaced. Returns the ones that do not. */
export const badNames = async (page: Page) =>
  (await tileNames(page))
    .map((n) => ({
      name: n.name,
      upward: n.upward,
      lines: n.lines >= 1 && n.said === n.lines && (n.lines === 1 || /\s/.test(n.text)),
      whole: n.whole,
      corner: n.corner,
    }))
    .filter((n) => !Object.values(n).every(Boolean))

/**
 * Sets the window to `size`, when given, and waits for the tiles' names to
 * be fitted to their room: a fit lands after a resize, through the tile's
 * ResizeObserver, so until two reads of every name, two frames apart, agree.
 * A screen with no names drawn is not fitted: it fails, rather than pass on
 * no tiles at all.
 */
export async function fitted(page: Page, size?: { width: number; height: number }) {
  if (size) await page.setViewportSize(size)
  await settled(page)
  const read = () =>
    page.evaluate(
      () =>
        new Promise<string>((done) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() =>
              done(
                JSON.stringify(
                  [...document.querySelectorAll("main [data-name]")].map((el) => {
                    const r = el.getBoundingClientRect()
                    return [
                      el.getAttribute("data-name-px"),
                      el.getAttribute("data-lines"),
                      el.hasAttribute("data-cut"),
                      r.x,
                      r.y,
                      r.width,
                      r.height,
                    ]
                  })
                )
              )
            )
          )
        )
    )
  let was = await read()
  await expect
    .poll(
      async () => {
        const now = await read()
        const state = now === "[]" ? "no names drawn" : now === was ? "fitted" : "moving"
        was = now
        return state
      },
      { message: "names fitted" }
    )
    .toBe("fitted")
}

/**
 * A page script, run ahead of the app: notes each state `read` finds (an
 * expression run in the page, null while there is nothing to note), with the
 * frames begun since the first state (0 for the first), and whether it came
 * in a ResizeObserver, where a frame is laid out but not yet drawn. A state
 * in the observers of frame 1 is drawn with that frame; one after them, or
 * later, comes after a frame was drawn with the state before. Read back with
 * `drawnLate`.
 */
export const watchDrawn = (read: string) => `{
  window.__DRAWN__ = [];
  let frames = 0;
  let first = null;
  const note = (observing) => {
    const state = ${read};
    if (state == null || window.__DRAWN__.at(-1)?.state === state) return;
    if (first === null) first = frames;
    window.__DRAWN__.push({ state, frame: frames - first, observing });
  };
  const tick = () => {
    frames++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const Observer = window.ResizeObserver;
  window.ResizeObserver = class extends Observer {
    constructor(callback) {
      super((...seen) => {
        callback(...seen);
        note(true);
      });
    }
  };
  new MutationObserver(() => note(false)).observe(document, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });
}`

/** What `watchDrawn` noted: the last state, and the states that came after
 *  a frame was drawn with the one before. */
export async function drawnLate(page: Page) {
  type Drawn = { state: string; frame: number; observing: boolean }
  const all = await page.evaluate(() => (window as unknown as { __DRAWN__: Drawn[] }).__DRAWN__)
  return {
    last: all.at(-1)?.state,
    late: all.filter((d) => d.frame > 1 || (d.frame === 1 && !d.observing)),
  }
}
