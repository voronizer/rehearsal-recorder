import type { Meta, StoryObj } from "@storybook/react-vite"
import { TakeRow } from "./TakeRow"
import type { MetronomeState } from "@/lib/api"

/** A take of Pałyn at 128 in 4/4, clicking. */
const CLICKING: MetronomeState = {
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
  since_count_in_ms: 12_000,
  output_missing: null,
  // No song has a backing track yet: the row is not shown.
  backing: {
    song: null,
    on: true,
    volume: 0.8,
    row: false,
    playing: false,
    position_sec: 0,
    output_missing: null,
    getting_ready: false,
    free: false,
  },
}

const meta = {
  title: "Metronome/TakeRow",
  component: TakeRow,
  args: { state: CLICKING, lit: null, onSwitch: () => {} },
  decorators: [
    (Story) => (
      // As wide as the footer leaves it beside the status and Stop at 960.
      <div className="w-[19rem]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TakeRow>

export default meta
type Story = StoryObj<typeof meta>

/** Clicking to Stop, the first of the bar lit. */
export const Clicking: Story = { args: { lit: 0 } }

/** The count-in. */
export const CountIn: Story = {
  args: { state: { ...CLICKING, phase: "count", count: 2, since_count_in_ms: -940 }, lit: 1 },
}

/** Ahoń in 6/8. */
export const SixEight: Story = {
  args: { state: { ...CLICKING, tempo: 198, signature: "6/8", per_bar: 6 }, lit: 3 },
}

/** Switched off mid-take: the tempo still goes into the take. */
export const SwitchedOff: Story = { args: { state: { ...CLICKING, on: false } } }

/** The click's output is not there. */
export const OutputMissing: Story = {
  args: { state: { ...CLICKING, signature: "6/8", per_bar: 6, tempo: 198, output_missing: "Headphone amp" } },
}

/** A take with no tempo: no beat, and nothing to switch. */
export const NoClick: Story = {
  args: { state: { ...CLICKING, tempo: null, case: "free", song: null, since_count_in_ms: null } },
}
