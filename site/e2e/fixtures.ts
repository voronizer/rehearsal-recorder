import { test as base, expect, type Page } from "@playwright/test"

export { expect }

/**
 * Every test fails on an error in the page or in a frame of it: an
 * exception, or anything written to the console as an error. The fonts come
 * from Google, which a test machine may not reach; that is not an error of
 * the site's.
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
            !m.location().url.includes("fonts.g") &&
            !m.text().includes("Failed to load resource")
          ) {
            errors.push(`console.error: ${m.text()}`)
          }
        })
      }
      context.pages().forEach(watch)
      context.on("page", watch)
      await use(errors)
      expect(errors, "errors in the page").toEqual([])
    },
    { auto: true },
  ],
})
