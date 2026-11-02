import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { Timeline } from "@/components/Timeline"
import type { MultitrackPlayer } from "@/hooks/useMultitrackPlayer"

// The app's stores (labels, the system's keys) give no snapshot of their own
// for a page drawn on a server; here the one they have does.
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
const player = {
  media: [
    {
      name: "Bass",
      url: null,
      frames: 4 * 48000,
      samplerate: 48000,
      duration_sec: 4,
      peaks: [[0.1, 0.4, 0.2, 0.3]],
    },
  ],
  duration: 4,
  position: 0,
  region: { a: null, b: null },
  view: null,
  playing: false,
  looping: false,
  master: 1,
  masterLevel: 0,
  peaksWindow: { from: 0, to: 4 },
  hasSolo: false,
  isMuted: () => false,
  isSoloed: () => false,
  getVolume: () => 1,
  getLevels: () => [0],
  seek: noop,
  setRegion: noop,
  clearRegion: noop,
  toggleLoop: noop,
  resetView: noop,
  setVolume: noop,
  persistVolumes: noop,
  toggleMute: noop,
  toggleSolo: noop,
  setMaster: noop,
  persistMaster: noop,
} as unknown as MultitrackPlayer

const timeline = (master?: boolean) =>
  renderToStaticMarkup(createElement(Timeline, { player, master }))

describe("the timeline's Master row", () => {
  it("is under the tracks by default", () => {
    const out = timeline()
    expect(out).toContain("data-master-group")
    expect(out).toContain("Bass")
  })

  it("is left out where the player has no master", () => {
    const out = timeline(false)
    expect(out).not.toContain("data-master-group")
    expect(out).not.toContain("data-master-band")
    expect(out).toContain("Bass")
  })
})
