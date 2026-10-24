import type { Meta, StoryObj } from "@storybook/react-vite"
import { BackingTakeRow } from "./BackingTakeRow"
import type { BackingState, MetronomeState } from "@/lib/api"

const PALYN_FILE = { name: "Pałyn backing.wav", seconds: 222, channels: 2 as const, tempo: 128, first_bar: 0.8, missing: false }

/** Python's answer while Pałyn's take records, its backing track heard. */
const TAKE: MetronomeState = {
  phase: "take",
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
    playing: true,
    position_sec: 72,
    output_missing: null,
    getting_ready: false,
    free: false,
  },
}

const withBacking = (patch: Partial<BackingState>): MetronomeState => ({ ...TAKE, backing: { ...TAKE.backing, ...patch } })

const meta = {
  title: "Backing track/BackingTakeRow",
  component: BackingTakeRow,
  args: { state: TAKE, onSwitch: () => {}, onVolume: () => {} },
  decorators: [
    (Story) => (
      <div className="w-[28.5rem]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BackingTakeRow>

export default meta
type Story = StoryObj<typeof meta>

/** Heard in the take: how far it has got, the switch and the volume. */
export const Heard: Story = {}

/** Switched off during the take: no longer heard, still in the take. */
export const SwitchedOff: Story = { args: { state: withBacking({ on: false }) } }

/** The take records without it (off at Record): nothing to switch. */
export const Without: Story = { args: { state: withBacking({ playing: false, on: false, position_sec: 0 }) } }
