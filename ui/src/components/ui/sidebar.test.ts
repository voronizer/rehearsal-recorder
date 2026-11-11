import { createElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it } from "vitest"
import { Sidebar, SidebarProvider, useSidebar } from "@/components/ui/sidebar"

/* The tests run in Node, with no window: a matchMedia of the given width is
   put in its place for the render. */
function windowOf(width: number) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      matchMedia: (query: string) => {
        const max = Number(/max-width: ([\d.]+)px/.exec(query)?.[1])
        return { matches: width <= max, addEventListener() {}, removeEventListener() {} }
      },
    },
  })
}

/* The system's Reduce motion as motionOff() reads it, with a page that is not recording. */
function reduceMotion(on: boolean) {
  Object.defineProperty(globalThis, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: on && query.includes("prefers-reduced-motion") }),
  })
  Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement: { hasAttribute: () => false } } })
}

function Probe({ name, children }: { name: string; children?: ReactNode }) {
  const { isMobile, open } = useSidebar()
  return createElement("p", { "data-name": name }, `${name}:${isMobile ? "mobile" : "wide"}:${open ? "open" : "folded"}`, children)
}

afterEach(() => {
  for (const name of ["window", "matchMedia", "document"]) Reflect.deleteProperty(globalThis, name)
})

describe("SidebarProvider", () => {
  it("is mobile below mobileBelow, and not at it", () => {
    windowOf(700)
    expect(renderToStaticMarkup(createElement(SidebarProvider, { mobileBelow: 768 }, createElement(Probe, { name: "a" })))).toContain("a:mobile")
    windowOf(768)
    expect(renderToStaticMarkup(createElement(SidebarProvider, { mobileBelow: 768 }, createElement(Probe, { name: "a" })))).toContain("a:wide")
  })

  it("takes the width it is given", () => {
    windowOf(1000)
    const html = (below: number) =>
      renderToStaticMarkup(createElement(SidebarProvider, { mobileBelow: below }, createElement(Probe, { name: "a" })))
    expect(html(1100)).toContain("a:mobile")
    expect(html(900)).toContain("a:wide")
  })

  it("keeps the state of nested providers apart", () => {
    windowOf(1000)
    const html = renderToStaticMarkup(
      createElement(
        SidebarProvider,
        { defaultOpen: true },
        createElement(Probe, { name: "outer" }),
        createElement(SidebarProvider, { defaultOpen: false, mobileBelow: 1100 }, createElement(Probe, { name: "inner" }))
      )
    )
    expect(html).toContain("outer:wide:open")
    expect(html).toContain("inner:mobile:folded")
  })

  it("opens and folds at once under Reduce motion", () => {
    windowOf(1000)
    const html = () => renderToStaticMarkup(createElement(SidebarProvider, null, createElement(Sidebar, { collapsible: "icon" }, "Sections")))
    reduceMotion(false)
    expect(html()).toContain("transition-[left,right,width]")
    reduceMotion(true)
    expect(html()).not.toContain("transition-")
  })
})
