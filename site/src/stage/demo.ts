// The app's Python side, on the site: the fake the interface's tests run
// against, with the band laid over it, and the few things a web page needs
// that a desktop window does not.
import fake from "../../../ui/e2e/fake-bridge.js?raw"
import band from "../../../ui/e2e/band.js?raw"

// The bridge's calls, as the fake answers them. Typed loosely: the
// interface's own `api()` is the typed way in.
type Call = (...args: any[]) => Promise<any>
export type DemoApi = Record<string, Call>

export const demoApi = () =>
  (window as unknown as { pywebview: { api: DemoApi } }).pywebview.api

/** When the guitarist leans in during a take, in seconds from its start. */
const CLIPS = [1.2, 2.2, 3.4]

/**
 * Whether the guitar is at full scale on a poll at `t`: each clip on the
 * first poll at or after its time, and never on two polls running, since the
 * app counts a clip where the level rises to the top. A window of time would
 * be missed by polls that come late, on a busy machine.
 */
export function clipSchedule(times: number[]): (t: number) => boolean {
  let next = 0
  let last = false
  return (t) => {
    last = !last && next < times.length && t >= times[next]
    if (last) next++
    return last
  }
}

export function installDemo(): void {
  // One classic script, as tests/docs_screenshots.py does it: the band sets
  // the fake's top-level `let`s, which only a script of the same page sees.
  const script = document.createElement("script")
  script.textContent = `${fake}\n${band}`
  document.head.append(script)
  script.remove()

  // Nobody reads the fake's log of calls here, and on a page left open it
  // would grow by a dozen calls a second.
  ;(window as unknown as { __CALLS__: unknown }).__CALLS__ = { push: () => 0, filter: () => [] }

  const api = demoApi()

  // The site is light, so the app is too, and changing it saves nothing.
  const settingsOf = api.get_settings
  api.get_settings = async () => ({ ...(await settingsOf()), theme: "light", ui_scale: 1 })
  api.save_appearance = async () => ({ ok: true })

  // There is no app server behind the site: the interface's polling, which
  // tries /api/ first, goes over the (fake) bridge, as in the tests, and
  // without asking the network.
  const realFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href)
    if (url.origin === location.origin && url.pathname.includes("/api/"))
      return Promise.resolve(new Response("", { status: 404 }))
    return realFetch(input, init)
  }

  // In a frame, the page around the app is what scrolls: a field the app
  // focuses, or a row it brings into view, must not drag the site along.
  if (window.parent !== window) {
    const realFocus = HTMLElement.prototype.focus
    HTMLElement.prototype.focus = function (options?: FocusOptions) {
      realFocus.call(this, { ...options, preventScroll: true })
    }
    Element.prototype.scrollIntoView = function () {}
  }

  // A drag the site makes has no real pointer to capture.
  for (const name of ["setPointerCapture", "releasePointerCapture"] as const) {
    const real = Element.prototype[name]
    Element.prototype[name] = function (id: number) {
      try {
        real.call(this, id)
      } catch {
        // a synthetic pointer
      }
    }
  }

  // The guitarist leans in three times during a take, so the story's "a tile
  // that clips turns red" has a red tile to point at.
  let takeStarted: number | null = null
  let clipping = clipSchedule(CLIPS)
  const startTake = api.start_take
  api.start_take = async (...args) => {
    const res = await startTake(...args)
    if (res?.ok) {
      takeStarted = performance.now()
      clipping = clipSchedule(CLIPS)
    }
    return res
  }
  const stopTake = api.stop_take
  api.stop_take = async (...args) => {
    takeStarted = null
    return stopTake(...args)
  }
  const levelsOf = api.get_levels
  api.get_levels = async (...args) => {
    const out = await levelsOf(...args)
    if (takeStarted === null || !Array.isArray(out?.Guitar)) return out
    if (clipping((performance.now() - takeStarted) / 1000)) out.Guitar = out.Guitar.map(() => 1)
    return out
  }
}
