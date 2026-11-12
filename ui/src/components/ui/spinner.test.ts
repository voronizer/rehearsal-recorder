import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { Spinner } from "@/components/ui/spinner"

describe("Spinner", () => {
  it("is a status called Loading, turning", () => {
    const html = renderToStaticMarkup(createElement(Spinner, { after: 0 }))
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-label="Loading"')
    expect(html).toContain("animate-spin")
  })

  it("is not read out when quiet: the words beside it say it", () => {
    const html = renderToStaticMarkup(createElement(Spinner, { after: 0, quiet: true }))
    expect(html).toContain('aria-hidden="true"')
    expect(html).not.toContain('role="status"')
    expect(html).not.toContain("Loading")
    expect(html).toContain("animate-spin")
  })

  it("is there but not seen until its time (B5), so nothing moves when it shows (B4)", () => {
    // The first render, before any timer has run.
    const html = renderToStaticMarkup(createElement(Spinner))
    expect(html).toContain("invisible")
    expect(html).toContain("animate-spin")
  })

  it("is seen at once when it is told to wait for nothing", () => {
    expect(renderToStaticMarkup(createElement(Spinner, { after: 0 }))).not.toContain("invisible")
  })
})
