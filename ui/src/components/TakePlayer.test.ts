import { createElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { PlayerLine, TakePlayer } from "@/components/TakePlayer"
import type { MultitrackPlayer } from "@/hooks/useMultitrackPlayer"

const line = (said: { error?: string | null; status?: ReactNode; warning?: string | null }) =>
  renderToStaticMarkup(
    createElement(PlayerLine, { error: null, status: null, warning: null, ...said })
  )

const CROP = createElement("span", { "data-crop": true }, "Cropping… 40%")

describe("the player's line", () => {
  it("is always there, empty until something is said", () => {
    const out = line({})
    expect(out).toContain("data-player-line")
    expect(out).not.toContain("role=")
  })

  it("says the output's warning when it is all there is", () => {
    const out = line({ warning: "Playback stopped" })
    expect(out).toContain("Playback stopped")
    // The warning's own colour on its icon, as the shared Alert gives it.
    expect(out).toContain("[&amp;&gt;svg]:text-warn")
  })

  it("says how far a crop is over the output's warning", () => {
    const out = line({ status: CROP, warning: "Playback stopped" })
    expect(out).toContain("data-crop")
    expect(out).not.toContain("Playback stopped")
  })

  it("says a take that did not load over the output's warning", () => {
    const out = line({ error: "Track file not found", warning: "Playback stopped" })
    expect(out).toContain("Track file not found")
    expect(out).toContain("text-destructive")
    expect(out).not.toContain("text-warn")
    expect(out).not.toContain("Playback stopped")
  })

  it("says a take that did not load over a crop as well", () => {
    const out = line({ error: "Track file not found", status: CROP, warning: "Playback stopped" })
    expect(out).toContain("Track file not found")
    expect(out).not.toContain("data-crop")
    expect(out).not.toContain("Playback stopped")
  })
})

// The app's stores give no snapshot of their own for a page drawn on a
// server; here the one they have does.
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>()
  return {
    ...react,
    useSyncExternalStore: <T,>(
      subscribe: (onChange: () => void) => () => void,
      snapshot: () => T,
      server?: () => T,
    ) => react.useSyncExternalStore(subscribe, snapshot, server ?? snapshot),
  }
})

const noop = () => {}

// A take of one track, loaded and stopped, as the player's hook gives it.
const player = new Proxy(
  {
    media: [{ name: "Bass", url: null, frames: 4 * 48000, samplerate: 48000, duration_sec: 4, peaks: [[0.1, 0.4, 0.2, 0.3]] }],
    duration: 4,
    position: 0,
    region: { a: null, b: null },
    view: null,
    playing: false,
    looping: false,
    loading: false,
    loadError: null,
    outputWarning: null,
    master: 1,
    masterLevel: 0,
    peaksWindow: { from: 0, to: 4 },
    hasSolo: false,
    isMuted: () => false,
    isSoloed: () => false,
    getVolume: () => 1,
    getLevels: () => [0],
  } as Record<string, unknown>,
  // Every action the screen could call does nothing here.
  { get: (target, key: string) => (key in target ? target[key] : noop) },
) as unknown as MultitrackPlayer

describe("the take's marks under the player", () => {
  it("are each a chip, two at the same second as well", () => {
    const out = renderToStaticMarkup(
      createElement(TakePlayer, {
        player,
        onEditMarker: noop,
        markers: [
          { at: 2, label_id: 1, note: "Late" },
          { at: 2, label_id: 1, note: "Early" },
        ],
      }),
    )
    expect(out.match(/Edit mark at 0:02/g)).toHaveLength(2)
  })
})
