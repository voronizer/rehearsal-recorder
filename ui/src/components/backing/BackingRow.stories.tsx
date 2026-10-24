import type { Meta, StoryObj } from "@storybook/react-vite"
import { useEffect, useState } from "react"
import { BackingRow } from "./BackingRow"
import type { BackingState, MetronomeState } from "@/lib/api"

const PALYN_FILE = { name: "Pałyn backing.wav", seconds: 222, channels: 2 as const, tempo: 128, first_bar: 0.8, missing: false }

/** Python's answer for the rehearsal screen: Pałyn next, at 128, its
 *  backing track counted at 128, between takes. */
const PALYN: MetronomeState = {
  phase: "idle",
  tempo: 128,
  signature: "4/4",
  per_bar: 4,
  on: true,
  case: "song",
  song: { id: 1, title: "Pałyn", tempo: 128, signature: "4/4" },
  held: false,
  last_take: null,
  upcoming: [],
  count: 0,
  since_count_in_ms: null,
  output_missing: null,
  backing: {
    song: { ...PALYN_FILE, song_id: 1, title: "Pałyn" },
    on: true,
    volume: 0.8,
    row: true,
    playing: false,
    position_sec: 0,
    output_missing: null,
    getting_ready: false,
    free: false,
  },
}

const withBacking = (patch: Partial<BackingState>, state: Partial<MetronomeState> = {}): MetronomeState => ({
  ...PALYN,
  ...state,
  backing: { ...PALYN.backing, ...patch },
})

const meta = {
  title: "Backing track/BackingRow",
  component: BackingRow,
  args: {
    state: PALYN,
    name: "Pałyn",
    onSwitch: () => {},
    onVolume: () => {},
    onPlay: () => {},
  },
  decorators: [
    (Story) => (
      // As wide as the footer leaves it beside Finish and Record at 960.
      <div className="w-[28.5rem]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BackingRow>

export default meta
type Story = StoryObj<typeof meta>

/** The row kept here as Python would: the switch, the volume, and ▶,
 *  which plays the file from its start and counts how far it has got. */
function Live() {
  const [state, setState] = useState(PALYN)
  const set = (patch: Partial<BackingState>) => setState((s) => withBacking({ ...s.backing, ...patch }))
  const playing = state.backing.playing
  useEffect(() => {
    if (!playing) return
    const started = performance.now()
    const tick = window.setInterval(() => set({ position_sec: (performance.now() - started) / 1000 }), 250)
    return () => window.clearInterval(tick)
  }, [playing])
  return (
    <BackingRow
      state={state}
      name="Pałyn"
      onSwitch={(on) => set({ on })}
      onVolume={(volume) => set({ volume })}
      onPlay={() => set({ playing: !playing, position_sec: 0 })}
    />
  )
}

/** Pałyn's backing track, ready for the next take. */
export const Ready: Story = { render: () => <Live /> }

/** ▶ pressed: how far it has got, and ■ to stop it. */
export const Playing: Story = { args: { state: withBacking({ playing: true, position_sec: 12 }) } }

/** Switched off: the next takes record without it, and the file is dimmed. */
export const Off: Story = { args: { state: withBacking({ on: false }) } }

/** Its copy is missing: nothing to play. */
export const CopyMissing: Story = {
  args: { state: withBacking({ song: { ...PALYN_FILE, song_id: 1, title: "Pałyn", seconds: null, missing: true } }) },
}

/** A long file name gives way to the time. */
export const LongName: Story = {
  args: {
    state: withBacking({
      song: { ...PALYN_FILE, song_id: 1, title: "Pałyn", name: "Pałyn backing final mix for the gig on Saturday v3.wav" },
    }),
  },
}

/** Dym has none: the row says where it is added, with nothing to switch. */
export const SongWithout: Story = {
  args: {
    state: withBacking({ song: null }, { song: { id: 5, title: "Dym", tempo: null, signature: null } }),
    name: "Dym",
  },
}

/** A free take has none. */
export const FreeTake: Story = {
  args: { state: withBacking({ song: null, free: true }, { case: "free", song: null }), name: "Take 7" },
}
