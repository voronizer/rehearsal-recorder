import { expect, openApp, startRehearsal, test } from "./app.ts"

// With the scrollbars a mouse shows, as on Windows, or on a Mac with a
// mouse plugged in. Playwright hides them unless told not to, and the
// option is the browser's own, so these tests need a file of their own.
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } })

const TWENTY = ["Pałyn", "Viasna", "Ahoń", "Sonca", "Dym", "Ptuška", "Daroha", "Rečka",
  "Vieter", "Zorka", "Kvietka", "Rassvet", "Lieta", "Zima", "Vosień", "Bierah", "Rečyšča",
  "Ranica", "Viečar", "Noč"]

test("no scrollbar under the songs: the wheel, the fade and ‹ › stand for it", async ({
  page,
}) => {
  await openApp(page, {
    after: `
      const api = window.pywebview.api; const start = api.start_rehearsal;
      api.start_rehearsal = async (...a) => { const r = await start(...a);
        for (const name of ${JSON.stringify(TWENTY)}) {
          const { take_number: n } = await api.start_take();
          await api.keep_take(n, '/tmp/draft', name, 6, [{name:'Guitar', file:'/rec/k' + n + '.wav'}], []);
        }
        return r; };
    `,
  })
  await startRehearsal(page, TWENTY.length + 1)
  const overview = page.locator("[aria-label='Rehearsal overview']")
  await overview.getByRole("button", { name: /^Take 1 / }).click()
  const strip = page.getByRole("group", { name: "Take strip" })
  await expect(strip.getByRole("button", { name: "Later songs" })).toBeVisible()
  const bar = await strip
    .locator("[data-tab]")
    .first()
    .locator("..")
    .evaluate(
      (el: HTMLElement) =>
        el.offsetHeight - el.clientHeight - parseFloat(getComputedStyle(el).borderBottomWidth)
    )
  expect(bar).toBe(0)
})
