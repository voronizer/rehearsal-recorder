// The app's Python side, on the site: the fake the interface's tests run
// against, with the band laid over it, and the few things a web page needs
// that a desktop window does not.
import fake from "../../../ui/e2e/fake-bridge.js?raw"
import band from "../../../ui/e2e/band.js?raw"
import notes from "./notes.js?raw"
import type { TakeNotes } from "@/lib/api"

// The bridge's calls, as the fake answers them. Typed loosely: the
// interface's own `api()` is the typed way in.
type Call = (...args: any[]) => Promise<any>
export type DemoApi = Record<string, Call>

export const demoApi = () =>
  (window as unknown as { pywebview: { api: DemoApi } }).pywebview.api

/**
 * The notes of the MIDI tile, as take_notes reads them back for two lanes: the
 * stretch of the take they are shown for, and how far the playhead has got in
 * it. See notes.js.
 */
export type SiteNotes = {
  from: number
  to: number
  playhead: number
  lanes: { port: string; notes: TakeNotes }[]
}

export const siteNotes = () => (window as unknown as { __SITE_NOTES__: SiteNotes }).__SITE_NOTES__

/** When the guitarist leans in during a take, in seconds from when the band
 *  comes in: the count-in's end, or Record for a take with none. */
export const CLIPS = [1.2, 2.2, 3.4]

let cameIn: number | null = null

/** When the band came in on the take that is recording, on the page's clock
 *  (performance.now()); null between takes. The clips count from it. */
export const bandCameIn = () => cameIn

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
  // The fake keeps its settings and the band's sets in localStorage, which
  // the site's frames share and which outlives the page: a visitor who
  // switched the click off in the hero would have switched it off for the
  // story too, whose second step counts in. Each frame keeps its own, from
  // the band's, for as long as it is open.
  const kept = new Map<string, string>()
  const frameStorage = {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, String(value)),
  }
  const w = window as unknown as { __FRAME_STORAGE__?: typeof frameStorage }
  w.__FRAME_STORAGE__ = frameStorage

  // One classic script, as tests/docs_screenshots.py does it, wrapped in one
  // function whose `localStorage` is the frame's: the band sets the fake's
  // top-level `let`s, which only code in the same scope sees. The MIDI
  // tile's notes come after the band, made from its song form.
  const script = document.createElement("script")
  script.textContent = `(function (localStorage) {\n${fake}\n${band}\n${notes}\n})(window.__FRAME_STORAGE__)`
  document.head.append(script)
  script.remove()
  delete w.__FRAME_STORAGE__

  // Nobody reads the fake's log of calls here, and on a page left open it
  // would grow by a dozen calls a second.
  ;(window as unknown as { __CALLS__: unknown }).__CALLS__ = { push: () => 0, filter: () => [] }

  const api = demoApi()

  // The app's theme follows the system's, as the site round it does, and
  // changing it saves nothing.
  // History opens on Rehearsals every time, its marks grouped by rehearsal,
  // as the story's fourth step expects: a step back starts the frame again,
  // and finds it there.
  const settingsOf = api.get_settings
  api.get_settings = async () => ({
    ...(await settingsOf()),
    theme: "system",
    ui_scale: 1,
    history_view: "rehearsals",
    marks_grouping: "rehearsal",
  })
  api.save_appearance = async () => ({ ok: true })
  api.save_history_view = async () => ({ ok: true })
  api.save_marks_grouping = async () => ({ ok: true })

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
  // that clips turns red" has a red tile to point at: once the band has come
  // in, after the bar of clicks that counts it in, as the story tells it.
  // Python gives the time since the count-in ended, negative while it goes
  // on, and none for a take with no count-in.
  let clipping = clipSchedule(CLIPS)
  const startTake = api.start_take
  api.start_take = async (...args) => {
    const res = await startTake(...args)
    if (res?.ok) {
      const left = -((await api.metronome_state()).since_count_in_ms ?? 0)
      cameIn = performance.now() + Math.max(0, left)
      clipping = clipSchedule(CLIPS)
    }
    return res
  }
  const stopTake = api.stop_take
  api.stop_take = async (...args) => {
    cameIn = null
    return stopTake(...args)
  }
  const levelsOf = api.get_levels
  api.get_levels = async (...args) => {
    const out = await levelsOf(...args)
    if (cameIn === null || !Array.isArray(out?.Guitar)) return out
    if (clipping((performance.now() - cameIn) / 1000)) out.Guitar = out.Guitar.map(() => 1)
    return out
  }
}
