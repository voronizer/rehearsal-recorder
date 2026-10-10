import { expect, openApp, setFake, startRehearsal, test } from "./app.ts"
import type { Locator, Page } from "@playwright/test"

// The recording screen with MIDI in the band. A Both track keeps its audio
// tile and gets a narrow column of notes beside the levels; a MIDI track gets
// a tile of its own, in band order. Each says how many notes it has had, and
// a fill in the accent jumps with each note's velocity. The fake kit plays
// from a quarter second into a take, on the drums; a keyboard stays quiet.

/** The kit on Both, a bass on audio alone, a keyboard on MIDI alone and a
 *  singer: the four kinds of tile in one row, a MIDI one between audio. */
const BAND = [
  { name: "Drums", channel: 1, icon: "drums", mode: "both", midi_port: { name: "TD-17" } },
  { name: "Bass", channel: 2, icon: "bass" },
  { name: "Keys", channel: null, icon: "keys", mode: "midi", midi_port: { name: "Launchkey Mini MK3" } },
  { name: "Vocals", channel: 3, icon: "vocals" },
]
const LEVELS = { Drums: [0.5], Bass: [0.5], Vocals: [0.5] }

/** Records a take of this band and leaves it recording. `before` sets up more
 *  of the fake ahead of the page, `after` changes one of its answers. */
async function recording(
  page: Page,
  { band = BAND, levels = LEVELS, before = "", after }: {
    band?: object[]
    levels?: object
    before?: string
    after?: string
  } = {}
) {
  await openApp(page, {
    before: `window.__SESSION_TRACKS__ = ${JSON.stringify(band)};
      window.__LEVELS__ = ${JSON.stringify(levels)}; ${before}`,
    after,
  })
  await startRehearsal(page)
  await page.getByRole("button", { name: /Record take 1/ }).click()
  await expect(page.getByRole("button", { name: /^Stop/ })).toBeVisible()
}

const tile = (page: Page, name: string) => page.getByRole("group", { name })
const tiles = (page: Page) => page.locator("main [role=group]")

/** The notes a tile says it has had: "12 notes", "1 note", "1,240 notes". */
async function notesOn(tileEl: Locator): Promise<number> {
  const text = await tileEl.innerText()
  const found = /([\d,]+)\s+notes?\b/.exec(text)
  return found ? Number(found[1].replace(/,/g, "")) : -1
}

/** What a colour looks like once the browser has it, so two that come from
 *  different places can be told apart or found the same. */
const colourOf = (page: Page, css: { color?: string; borderColor?: string; className?: string }) =>
  page.evaluate((c) => {
    const probe = document.createElement("i")
    if (c.className) probe.className = c.className
    if (c.color) probe.style.color = c.color
    if (c.borderColor) probe.style.borderColor = c.borderColor
    document.body.append(probe)
    const style = getComputedStyle(probe)
    const out = c.borderColor || c.className ? style.borderTopColor : style.color
    probe.remove()
    return out
  }, css)

const edgeOf = (tileEl: Locator) => tileEl.evaluate((el) => getComputedStyle(el).borderTopColor)

/** How the tile writes its track's name: up the tile, in one piece, from its
 *  bottom left corner, as the audio tiles do. Returns the ones that do not. */
const badNames = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("main [role=group]")]
      .map((t) => {
        const el = t.querySelector("[data-name]")
        const name = t.getAttribute("aria-label")
        if (!el) return { name, found: false }
        const box = t.getBoundingClientRect()
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        const size = parseFloat(cs.fontSize)
        return {
          name,
          found: true,
          upward: cs.writingMode === "vertical-rl" && cs.transform !== "none",
          oneLine: r.width < size * 1.6,
          whole: el.scrollHeight <= el.clientHeight + 1,
          corner: r.left - box.left < 24 && box.bottom - r.bottom < 24,
        }
      })
      .filter((n) => !Object.values(n).every(Boolean))
  )

/** Makes the fake say every track has had `window.__NOTES__` notes, so a
 *  count can stand at 99 or at 12,345 without waiting for a kit to get there. */
const COUNTS = `window.__NOTES__ = 99;
  const was = window.pywebview.api.midi_activity;
  window.pywebview.api.midi_activity = async (...a) => {
    const out = await was(...a);
    for (const t of Object.values(out)) t.notes = window.__NOTES__;
    return out;
  };`

/** Where the parts of a tile stand, down to the pixel: the tile, its icon
 *  and name, the header's column and what is in it (the figure, the count,
 *  the line for the port, "clipped"), and a Both tile's column. The digits of
 *  a count change its width, so for those only the height and the top count. */
const stand = (tileEl: Locator) =>
  tileEl.evaluate((el) => {
    const all = (q: string) => [...el.querySelectorAll(q)]
    const header = el.querySelector("[data-notes]")?.parentElement
    const lines = header ? [...header.children] : []
    const whole = (e: Element | null) => {
      const r = e?.getBoundingClientRect()
      return r ? [r.left, r.top, r.width, r.height].map(Math.round) : null
    }
    const tall = (e: Element | null) => {
      const r = e?.getBoundingClientRect()
      return r ? [r.top, r.height].map(Math.round) : null
    }
    return {
      tile: whole(el),
      icon: whole(el.querySelector("[data-icon]")),
      name: whole(el.querySelector("[data-name]")),
      column: whole(el.querySelector("[data-midi-column]")),
      header: tall(header ?? null),
      lines: lines.map(tall),
      notes: all("[data-notes]").map(tall),
      status: all("[data-status]").map(tall),
    }
  })

/** A band of `count` tracks: Drums on Both, Keys on MIDI alone, and audio
 *  tracks for the rest, as many as it takes to make the tiles this narrow.
 *  Drums clips, so that a line stands under its count. */
type Member = {
  name: string
  channel: number | null
  icon?: string
  mode?: string
  midi_port?: { name: string }
}
function bandOf(count: number) {
  const band: Member[] = [
    { name: "Drums", channel: 1, icon: "drums", mode: "both", midi_port: { name: "TD-17" } },
    {
      name: "Keys",
      channel: null,
      icon: "keys",
      mode: "midi",
      midi_port: { name: "Launchkey Mini MK3" },
    },
    ...Array.from({ length: count - 2 }, (_, i) => ({ name: `Tr ${i + 1}`, channel: i + 2 })),
  ]
  const levels = Object.fromEntries(
    band.filter((t) => t.mode !== "midi").map((t) => [t.name, [t.name === "Drums" ? 0.99 : 0.5]])
  )
  return { band, levels }
}

/** What the tooltip of a tile says of a port that is not plugged in (D7). */
const notThere = (port: string, track: string) =>
  `\u201c${port}\u201d is not connected. ${track} records its notes from the moment it is plugged in.`

test.describe("recording", () => {
  test("a MIDI track gets a tile in band order, as wide as the others", async ({ page }) => {
    await recording(page)
    await expect(tiles(page)).toHaveCount(4)
    expect(await tiles(page).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))).toEqual([
      "Drums",
      "Bass",
      "Keys",
      "Vocals",
    ])
    const widths = await tiles(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width))
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1)

    // Its icon stands in the corner, as an audio tile's does, and its name
    // runs up the tile from the bottom left.
    await expect(tile(page, "Keys").locator("[data-icon]").first()).toHaveAttribute("data-icon", "keys")
    expect(await badNames(page)).toEqual([])
  })

  test("a Both track keeps its audio tile and gets a dashed column labelled MIDI", async ({ page }) => {
    await recording(page)
    const drums = tile(page, "Drums")
    // Its audio is there as it always was.
    await expect(drums.locator("[data-side]")).toHaveCount(1)
    await expect(drums).toContainText("Input 1")
    const column = drums.locator("[data-midi-column]")
    await expect(column).toHaveCount(1)
    await expect(column).toContainText("MIDI")
    expect(await column.evaluate((el) => getComputedStyle(el).borderLeftStyle)).toBe("dashed")
    // Upright: written up the column, as the names are.
    expect(
      await column.getByText("MIDI", { exact: true }).evaluate((el) => getComputedStyle(el).writingMode)
    ).toBe("vertical-rl")
    // On the right of the levels, narrower than a side of its own.
    const box = (await drums.boundingBox())!
    const col = (await column.boundingBox())!
    const side = (await drums.locator("[data-side]").boundingBox())!
    expect(col.x + col.width).toBeGreaterThan(box.x + box.width - 2)
    expect(col.x).toBeGreaterThanOrEqual(side.x + side.width - 1)
    expect(col.width).toBeLessThan(box.width / 3)

    // An audio track has none; a MIDI track has no levels.
    await expect(tile(page, "Bass").locator("[data-midi-column]")).toHaveCount(0)
    await expect(tile(page, "Bass")).not.toContainText("notes")
    await expect(tile(page, "Keys").locator("[data-side]")).toHaveCount(0)
  })

  test("the column fills with the kit's velocity, in the accent rather than the level's green", async ({
    page,
  }) => {
    await recording(page)
    const drums = tile(page, "Drums")
    const column = drums.locator("[data-midi-column]")
    // The loudest hit since the last look: sampled for a few bars while the
    // kit plays, so the fill is seen jumping and falling back. Whenever there
    // is one it stands on the column's bottom edge and not above its top.
    const seen = await column.evaluate(
      (el) =>
        new Promise<{ level: number; fill: boolean; onBottom: boolean; inside: boolean }[]>((done) => {
          const out: { level: number; fill: boolean; onBottom: boolean; inside: boolean }[] = []
          const timer = setInterval(() => {
            const f = el.querySelector("[data-midi-fill]")
            const c = el.getBoundingClientRect()
            const r = f?.getBoundingClientRect()
            out.push({
              level: Number(el.getAttribute("data-level")),
              fill: !!f,
              onBottom: !r || Math.abs(r.bottom - c.bottom) < 2,
              inside: !r || r.top >= c.top - 1,
            })
          }, 20)
          setTimeout(() => {
            clearInterval(timer)
            done(out)
          }, 3000)
        })
    )
    const levels = seen.map((s) => s.level)
    // Crash, kick and snare are above 0.84 of full velocity.
    expect(Math.max(...levels)).toBeGreaterThanOrEqual(80)
    // Between hits it falls back, and a note below the quiet mark shows none.
    expect(Math.min(...levels.slice(10))).toBeLessThan(40)
    expect(new Set(levels).size).toBeGreaterThan(5)
    expect(seen.filter((s) => s.fill).length).toBeGreaterThan(20)
    expect(seen.every((s) => s.onBottom && s.inside)).toBe(true)

    // The accent, not the green of the levels beside it.
    const accent = await colourOf(page, { color: "var(--primary)" })
    const green = await colourOf(page, { color: "var(--signal)" })
    expect(accent).not.toBe(green)
    await expect
      .poll(() =>
        column.locator("[data-midi-fill]").evaluateAll((els) =>
          els.map((el) => getComputedStyle(el).borderTopColor)
        )
      )
      .toContain(accent)
    await expect
      .poll(() =>
        drums.locator("[data-side] [data-fill]").evaluateAll((els) =>
          els.map((el) => getComputedStyle(el).borderTopColor)
        )
      )
      .toContain(green)
  })

  test("the header says how many notes, and the count goes up while the kit plays", async ({ page }) => {
    await recording(page)
    const drums = tile(page, "Drums")
    await expect.poll(() => notesOn(drums)).toBeGreaterThan(0)
    const first = await notesOn(drums)
    await expect.poll(() => notesOn(drums)).toBeGreaterThan(first + 2)
    // The word is in the same line as the figure.
    await expect(drums).toContainText(/\d+ notes/)
    // A keyboard that is not played has none, and says so.
    await expect(tile(page, "Keys")).toContainText("0 notes")
    expect(await notesOn(tile(page, "Keys"))).toBe(0)
    // The audio-only tracks say nothing of notes.
    await expect(tile(page, "Vocals")).not.toContainText("notes")
  })

  test("a MIDI track says MIDI where an audio tile says its input, with the port for a tooltip", async ({
    page,
  }) => {
    await recording(page)
    const keys = tile(page, "Keys")
    await expect(keys).toContainText("MIDI")
    await expect(keys).not.toContainText("Input")
    await expect(keys).not.toContainText("No input")
    await expect(keys).toHaveAttribute("title", "Launchkey Mini MK3")
    await expect(tile(page, "Vocals")).toContainText("Input 3")
    await expect(tile(page, "Bass")).toContainText("Input 2")
    await expect(tile(page, "Vocals")).not.toHaveAttribute("title")
    // Its port is there, so its edge is a tile's usual one.
    expect(await edgeOf(keys)).toBe(await edgeOf(tile(page, "Vocals")))
  })

  test("a MIDI tile fills from its bottom edge with the notes of its own port", async ({ page }) => {
    // A MIDI track on the kit's port, since a keyboard stays quiet in the
    // fake: the tile has no levels, so the notes are all it shows.
    await recording(page, {
      band: [
        { name: "Bass", channel: 1, icon: "bass" },
        { name: "Pads", channel: null, icon: "drums", mode: "midi", midi_port: { name: "TD-17" } },
      ],
      levels: { Bass: [0.5] },
    })
    const pads = tile(page, "Pads")
    await expect.poll(() => notesOn(pads)).toBeGreaterThan(2)
    const seen = await pads.evaluate(
      (el) =>
        new Promise<{ fill: boolean; onBottom: boolean; inside: boolean; border: string }[]>((done) => {
          const out: { fill: boolean; onBottom: boolean; inside: boolean; border: string }[] = []
          const timer = setInterval(() => {
            const f = el.querySelector("[data-midi-fill]")
            const t = el.getBoundingClientRect()
            const r = f?.getBoundingClientRect()
            out.push({
              fill: !!f,
              onBottom: !r || Math.abs(r.bottom - t.bottom) < 3,
              inside: !r || r.top >= t.top - 1,
              border: f ? getComputedStyle(f).borderTopColor : "",
            })
          }, 20)
          setTimeout(() => {
            clearInterval(timer)
            done(out)
          }, 2500)
        })
    )
    expect(seen.filter((s) => s.fill).length).toBeGreaterThan(20)
    expect(seen.every((s) => s.onBottom && s.inside)).toBe(true)
    const accent = await colourOf(page, { color: "var(--primary)" })
    expect(new Set(seen.filter((s) => s.fill).map((s) => s.border))).toEqual(new Set([accent]))
  })

  test("a MIDI tile never turns grey when nothing plays", async ({ page }) => {
    await recording(page, { levels: { Drums: [0.5], Bass: [0.5], Vocals: [0.0005] } })
    // A dead input is dimmed after a moment; that is the audio's silence.
    await expect(tile(page, "Vocals")).toHaveAttribute("data-silent")
    // The keyboard has not played a note all that time, and is not grey.
    const keys = tile(page, "Keys")
    await expect(keys).not.toHaveAttribute("data-silent")
    await expect(keys).not.toContainText("silent")
    expect(await keys.evaluate((el) => getComputedStyle(el).opacity)).toBe("1")
    expect(await notesOn(keys)).toBe(0)
    // And not for a long while either.
    await page.waitForTimeout(2000)
    await expect(keys).not.toHaveAttribute("data-silent")
    expect(await keys.evaluate((el) => getComputedStyle(el).opacity)).toBe("1")
  })

  test("a port that is not connected gives an amber edge and says so", async ({ page }) => {
    await recording(page, { before: "window.__MIDI_GONE__ = ['Launchkey Mini MK3'];" })
    const keys = tile(page, "Keys")
    await expect(keys).toContainText("not connected")
    await expect(keys).toHaveAttribute("data-not-connected")
    const amber = await colourOf(page, { className: "border border-amber-500/60" })
    expect(await edgeOf(keys)).toBe(amber)
    // It is a pause in the notes, not a fault with the sound: not grey.
    await expect(keys).not.toHaveAttribute("data-silent")
    // The ones that are plugged in say nothing of it, and keep their edge.
    await expect(tile(page, "Drums")).not.toContainText("not connected")
    expect(await edgeOf(tile(page, "Drums"))).not.toBe(amber)
    expect(await edgeOf(tile(page, "Vocals"))).not.toBe(amber)

    // Plugged in: the notes start, and the tile is as any other.
    await setFake(page, "__MIDI_GONE__", [])
    await expect(keys).not.toHaveAttribute("data-not-connected")
    await expect(keys.getByText("not connected")).toBeHidden()
    expect(await edgeOf(keys)).not.toBe(amber)
    // And pulled out again, the tile waits again.
    await setFake(page, "__MIDI_GONE__", ["Launchkey Mini MK3"])
    await expect(keys).toHaveAttribute("data-not-connected")
    await expect(keys.getByText("not connected")).toBeVisible()
    expect(await edgeOf(keys)).toBe(amber)
  })

  test("a Both track whose port is gone keeps recording its audio and says it waits for the notes", async ({
    page,
  }) => {
    await recording(page, { before: "window.__MIDI_GONE__ = ['TD-17'];" })
    const drums = tile(page, "Drums")
    await expect(drums).toContainText("not connected")
    expect(await edgeOf(drums)).toBe(await colourOf(page, { className: "border border-amber-500/60" }))
    // Its levels are there as before.
    await expect(drums.locator("[data-side]")).toHaveCount(1)
    await expect(drums.locator("[data-side]")).toHaveAttribute("data-level", "50")
    await expect(drums.locator("[data-midi-column]")).toContainText("MIDI")
    expect(await notesOn(drums)).toBe(-1)
  })

  test("a clip on a Both tile whose port is gone keeps the red edge", async ({ page }) => {
    await recording(page, {
      levels: { Drums: [0.99], Bass: [0.5], Vocals: [0.5] },
      before: "window.__MIDI_GONE__ = ['TD-17'];",
    })
    const drums = tile(page, "Drums")
    // A clip cannot wait for the notes: it is the edge that shows, and the
    // tile still says why its notes are not coming.
    await expect(drums).toHaveAttribute("data-clipped")
    await expect(drums).toContainText("not connected")
    expect(await edgeOf(drums)).toBe(
      await colourOf(page, { className: "border border-destructive/70" })
    )
  })

  test("a port coming and going moves nothing on the tile", async ({ page }) => {
    await recording(page, { before: "window.__MIDI_GONE__ = ['Launchkey Mini MK3'];" })
    const keys = tile(page, "Keys")
    await expect(keys).toHaveAttribute("data-not-connected")
    const boxes = () =>
      keys.evaluate((el) => {
        const rect = (e: Element | null) => {
          const r = e?.getBoundingClientRect()
          return r ? [r.x, r.y, r.width, r.height].map(Math.round) : null
        }
        return [el, ...el.querySelectorAll("[data-name], [data-icon], [data-notes], [data-status]")].map(rect)
      })
    const gone = await boxes()
    await setFake(page, "__MIDI_GONE__", [])
    await expect(keys).not.toHaveAttribute("data-not-connected")
    expect(await boxes()).toEqual(gone)
  })

  test("notes arriving move nothing on a Both tile", async ({
    page,
  }) => {
    await recording(page)
    const drums = tile(page, "Drums")
    await expect.poll(() => notesOn(drums)).toBeGreaterThan(0)
    // Where the parts of the tile stand, every 50 ms for a few bars of the
    // kit: the figures change their digits and the fill its height, and
    // nothing else is allowed to move.
    const stood = await drums.evaluate(
      (el) =>
        new Promise<string[]>((done) => {
          const out = new Set<string>()
          const timer = setInterval(() => {
            const at = (q: string) => {
              const r = el.querySelector(q)?.getBoundingClientRect()
              return r ? [r.top, r.bottom, r.height].map(Math.round) : null
            }
            out.add(
              JSON.stringify(
                ["[data-icon]", "[data-name]", "[data-notes]", "[data-midi-column]"].map(at)
              )
            )
          }, 50)
          setTimeout(() => {
            clearInterval(timer)
            done([...out])
          }, 2500)
        })
    )
    expect(stood).toHaveLength(1)
  })

  test("on a narrow tile the MIDI label gives way to the dashed column", async ({ page }) => {
    // Sixteen to a row, the label would run into the name; what does not fit
    // goes, leaving the column's dashed edge and its fill to say it.
    const band = Array.from({ length: 16 }, (_, i) =>
      i === 0
        ? { name: "Kick", channel: 1, icon: "drums", mode: "both", midi_port: { name: "TD-17" } }
        : { name: `Tr ${i}`, channel: i + 1 }
    )
    await recording(page, { band, levels: {} })
    await page.setViewportSize({ width: 960, height: 700 })
    const kick = tile(page, "Kick")
    const column = kick.locator("[data-midi-column]")
    await expect(column).toBeVisible()
    await expect(kick.getByText("MIDI", { exact: true })).toBeHidden()
    await expect(kick.locator("[data-notes]")).toBeHidden()
    expect(await column.evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(12)
    // Its fill still jumps.
    await expect(column.locator("[data-midi-fill]")).toBeVisible()
  })

  // Tiles between 112 and 160 px wide are the 7 to 12 tracks of a band: the
  // header's column is under 90 px there, and what it says must fit on one
  // line or give way, so that nothing under it moves. From 152 px up the
  // Both tile's count gives its place to "not connected" in words.
  for (const [count, width, from, to, words] of [
    [8, 1180, 112, 160, false],
    [7, 960, 112, 160, false],
    [6, 1180, 152, 276, true],
  ] as const) {
    test(`the header keeps still at ${count} tracks and ${width} px, as notes arrive and a port comes and goes`, async ({
      page,
    }) => {
      const { band, levels } = bandOf(count)
      await recording(page, { band, levels, after: COUNTS })
      await page.setViewportSize({ width, height: 820 })
      const drums = tile(page, "Drums")
      const keys = tile(page, "Keys")
      // A clip stands under the Both tile's count: what would be pushed.
      await expect(drums).toHaveAttribute("data-clipped")
      const at = (await drums.boundingBox())!
      expect(at.width, "a tile of the width this is about").toBeGreaterThan(from)
      expect(at.width).toBeLessThan(to)
      await expect(drums).toContainText("99")
      await expect(keys).toContainText("99")
      const first = [await stand(drums), await stand(keys)]

      // From 99 to a thousand and more: one line, whatever the digits.
      for (const [notes, shown] of [
        [999, "999"],
        [1240, "1,240"],
        [12345, "12,345"],
      ] as const) {
        await setFake(page, "__NOTES__", notes)
        await expect(drums).toContainText(shown)
        await expect(keys).toContainText(shown)
        expect(await stand(drums), `Drums at ${shown}`).toEqual(first[0])
        expect(await stand(keys), `Keys at ${shown}`).toEqual(first[1])
      }

      // Both ports pulled out, and plugged in again.
      await setFake(page, "__MIDI_GONE__", ["TD-17", "Launchkey Mini MK3"])
      await expect(drums).toHaveAttribute("data-not-connected")
      await expect(keys).toHaveAttribute("data-not-connected")
      // Where it fits the Both tile says so in words in the count's place;
      // where it does not, the count stays and the edge and tooltip say it.
      const said = drums.locator("[data-notes]").getByText("not connected")
      if (words) await expect(said).toBeVisible()
      else await expect(said).toBeHidden()
      expect(await stand(drums), "Drums, port gone").toEqual(first[0])
      expect(await stand(keys), "Keys, port gone").toEqual(first[1])
      await setFake(page, "__MIDI_GONE__", [])
      await expect(drums).not.toHaveAttribute("data-not-connected")
      await expect(keys).not.toHaveAttribute("data-not-connected")
      await expect(said).toHaveCount(0)
      expect(await stand(drums), "Drums, port back").toEqual(first[0])
      expect(await stand(keys), "Keys, port back").toEqual(first[1])
    })
  }

  test("a port that is not plugged in says why in its tooltip, on a tile too narrow for words", async ({
    page,
  }) => {
    // Eight tracks at 1180 px: a tile of 133 px has no room for "not
    // connected", and Drums has clipped, so its edge is red and not amber.
    const { band, levels } = bandOf(8)
    await recording(page, { band, levels })
    await page.setViewportSize({ width: 1180, height: 820 })
    const drums = tile(page, "Drums")
    const keys = tile(page, "Keys")
    await expect(drums).toHaveAttribute("data-clipped")
    expect((await drums.boundingBox())!.width).toBeLessThan(152)
    await expect(drums).not.toHaveAttribute("title")
    await expect(keys).toHaveAttribute("title", "Launchkey Mini MK3")

    await setFake(page, "__MIDI_GONE__", ["TD-17", "Launchkey Mini MK3"])
    await expect(drums).toHaveAttribute("title", notThere("TD-17", "Drums"))
    await expect(keys).toHaveAttribute("title", notThere("Launchkey Mini MK3", "Keys"))
    await expect(drums.locator("[data-notes]").getByText("not connected")).toBeHidden()

    // Plugged in again: the Both tile has none, the MIDI tile its port's name.
    await setFake(page, "__MIDI_GONE__", [])
    await expect(drums).not.toHaveAttribute("title")
    await expect(keys).toHaveAttribute("title", "Launchkey Mini MK3")
  })

  test("a count that does not fit a narrow tile is hidden, never shown cut, and the tooltip has it", async ({
    page,
  }) => {
    // Sixteen tracks: a MIDI tile of 50 to 62 px, where "12,345" shows as "12".
    const { band, levels } = bandOf(16)
    await recording(page, { band, levels, after: COUNTS })
    for (const width of [1180, 960]) {
      await page.setViewportSize({ width, height: 820 })
      const keys = tile(page, "Keys")
      const count = keys.locator("[data-notes]")
      expect((await keys.boundingBox())!.width).toBeLessThan(77)
      let hidden = 0
      let whole = 0
      for (const [notes, shown] of [
        [9, "9"],
        [99, "99"],
        [999, "999"],
        [1000, "1,000"],
        [12345, "12,345"],
        [99999, "99,999"],
        [123456, "123,456"],
      ] as const) {
        await setFake(page, "__NOTES__", notes)
        // Until the count is this one and not the one before ("9" is in "99").
        await expect(count).toHaveText(new RegExp(`^${shown} notes?$`))
        const seen = await keys.evaluate((el) => {
          const chip = el.querySelector("[data-notes]")!
          return {
            visible: getComputedStyle(chip).visibility === "visible",
            inside: chip.getBoundingClientRect().right <= el.getBoundingClientRect().right,
            title: el.getAttribute("title"),
          }
        })
        if (seen.visible) {
          whole++
          // Seen, it is seen whole, inside the tile.
          expect(seen.inside, `${shown} at ${width} px`).toBe(true)
          expect(seen.title).toBe("Launchkey Mini MK3")
        } else {
          hidden++
          expect(seen.title, `${shown} at ${width} px`).toBe(`${shown} notes`)
        }
      }
      expect(whole, `some counts fit at ${width} px`).toBeGreaterThan(0)
      expect(hidden, `some counts do not at ${width} px`).toBeGreaterThan(0)

      // A port that is gone or held has its own sentence, hidden count or not.
      await setFake(page, "__NOTES__", 123456)
      await setFake(page, "__MIDI_GONE__", ["Launchkey Mini MK3"])
      await expect(keys).toHaveAttribute("title", notThere("Launchkey Mini MK3", "Keys"))
      await setFake(page, "__MIDI_GONE__", [])
      await setFake(page, "__MIDI_BUSY__", ["Launchkey Mini MK3"])
      await expect(keys).toHaveAttribute(
        "title",
        "\u201cLaunchkey Mini MK3\u201d is in use by another app."
      )
      await setFake(page, "__MIDI_BUSY__", [])
      await expect(keys).toHaveAttribute("title", "123,456 notes")
      await setFake(page, "__NOTES__", 99)
    }
  })

  test("a port another app holds reads not connected, and its tooltip says why", async ({ page }) => {
    await recording(page, { before: "window.__MIDI_BUSY__ = ['Launchkey Mini MK3', 'TD-17'];" })
    const keys = tile(page, "Keys")
    const drums = tile(page, "Drums")
    await expect(keys).toContainText("not connected")
    await expect(keys).toHaveAttribute("data-not-connected")
    await expect(keys).toHaveAttribute("title", "\u201cLaunchkey Mini MK3\u201d is in use by another app.")
    await expect(drums).toHaveAttribute("title", "\u201cTD-17\u201d is in use by another app.")
    // Let go of: the port's own name again, and none on a Both tile.
    await setFake(page, "__MIDI_BUSY__", [])
    await expect(keys).not.toHaveAttribute("data-not-connected")
    await expect(keys).toHaveAttribute("title", "Launchkey Mini MK3")
    await expect(drums).not.toHaveAttribute("title")
    // One that is not plugged in says nothing of another app.
    await setFake(page, "__MIDI_GONE__", ["Launchkey Mini MK3"])
    await expect(keys).toHaveAttribute("data-not-connected")
    await expect(keys).toHaveAttribute("title", notThere("Launchkey Mini MK3", "Keys"))
  })

  test("the tiles are polled with the levels, and no longer when the screen has gone", async ({
    page,
  }) => {
    const count = () =>
      page.evaluate(() => (window as unknown as { __MIDI_POLLS__: number }).__MIDI_POLLS__)
    await recording(page, {
      after: `window.__MIDI_POLLS__ = 0;
        const was = window.pywebview.api.midi_activity;
        window.pywebview.api.midi_activity = (...a) => { window.__MIDI_POLLS__++; return was(...a) };`,
    })
    await expect.poll(count).toBeGreaterThan(5)
    await page.getByRole("button", { name: /^Stop/ }).click()
    await expect(page.locator("[data-take-summary]")).toBeVisible()
    const stopped = await count()
    await page.waitForTimeout(600)
    expect(await count()).toBe(stopped)
  })

  test("a band with no MIDI asks for none and looks as it did", async ({ page }) => {
    const count = () =>
      page.evaluate(() => (window as unknown as { __MIDI_POLLS__: number }).__MIDI_POLLS__)
    await openApp(page, {
      after: `window.__MIDI_POLLS__ = 0;
        const was = window.pywebview.api.midi_activity;
        window.pywebview.api.midi_activity = (...a) => { window.__MIDI_POLLS__++; return was(...a) };`,
    })
    await startRehearsal(page)
    await page.getByRole("button", { name: /Record take 1/ }).click()
    await expect(tile(page, "Guitar")).toHaveAttribute("data-clipped")
    await page.waitForTimeout(600)
    expect(await count()).toBe(0)
    await expect(
      page.locator("main [data-midi-column], main [data-midi-tile], main [data-notes]")
    ).toHaveCount(0)
    await expect(tiles(page)).toHaveCount(2)
  })

  test("sixteen tracks with MIDI among them still fit in one row, at 960 px too", async ({ page }) => {
    const names = [
      "Kick", "Snare", "Hi-hat", "Tom 1", "Tom 2", "Floor tom", "Overheads", "Bass",
      "Guitar 1", "Guitar 2", "Keys", "Acoustic", "Vocals", "Backing 1", "Backing 2", "Sax",
    ]
    let channel = 1
    const band = names.map((name) => {
      const midi = name === "Keys" || name === "Sax"
      const port = { name: name === "Keys" ? "Launchkey Mini MK3" : "TD-17" }
      return {
        name,
        channel: midi ? null : channel++,
        ...(midi ? { icon: "keys", mode: "midi", midi_port: port } : {}),
        ...(name === "Kick" ? { icon: "drums", mode: "both", midi_port: port } : {}),
      }
    })
    const lit = Object.fromEntries(
      band.filter((t) => t.mode !== "midi").map((t) => [t.name, [0.4]])
    )
    await recording(page, { band, levels: lit })
    await expect(tiles(page)).toHaveCount(16)
    for (const [width, height] of [
      [1180, 820],
      [960, 700],
    ]) {
      await page.setViewportSize({ width, height })
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const all = [...document.querySelectorAll("main [role=group]")].map((el) =>
                el.getBoundingClientRect()
              )
              const main = document.querySelector("main")!
              const widths = all.map((r) => r.width)
              return {
                rows: new Set(all.map((r) => Math.round(r.top))).size,
                sameWidth: Math.max(...widths) - Math.min(...widths) < 1,
                inside: Math.max(...all.map((r) => r.right)) <= window.innerWidth,
                sideways: document.documentElement.scrollWidth > window.innerWidth,
                scrolls: main.scrollHeight > main.clientHeight + 1,
              }
            }),
          { message: `at ${width}x${height}` }
        )
        .toEqual({ rows: 1, sameWidth: true, inside: true, sideways: false, scrolls: false })
      // The names of the MIDI tiles are whole, as the audio ones are.
      const bad = (await badNames(page)).filter((n) => n.name === "Keys" || n.name === "Sax")
      expect(bad, `names at ${width}x${height}`).toEqual([])
    }
  })
})
