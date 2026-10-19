import type { Meta, StoryObj } from "@storybook/react-vite"
import type { DriftBar } from "@/lib/drift"
import { DriftLine } from "./DriftLine"

/** Bars of 1.875 s (4/4 at 128) from a bar in, the band's tempo in each:
 *  steady, a chorus ahead, the bridge further, the outro sinking. */
function bars(tempos: (number | null)[]): DriftBar[] {
  return tempos.map((tempo, i) => ({ n: i + 1, start: 1.875 * (i + 1), end: 1.875 * (i + 2), tempo }))
}
const run = (n: number, from: number, to = from) =>
  Array.from({ length: n }, (_, i) => Math.round((from + ((to - from) * i) / Math.max(1, n - 1)) * 10) / 10)
const PALYN = bars([
  ...run(24, 127.6, 128.4),
  ...run(8, 133, 133.6),
  ...run(16, 129, 129.4),
  ...run(8, 132, 132.6),
  ...run(8, 134.8, 135.4),
  ...run(14, 131, 128.4),
  ...run(6, 125, 122.6),
])

const meta = {
  title: "Metronome/DriftLine",
  component: DriftLine,
  args: { bars: PALYN, aim: 128, signature: "4/4", tolerance: 0.02, from: 0, to: 160 },
  decorators: [
    (Story) => (
      <div className="relative w-[40rem] overflow-hidden rounded-md bg-well" style={{ height: "3.125rem" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DriftLine>

export default meta
type Story = StoryObj<typeof meta>

/** A take of Pałyn played against its 128: the choruses and the bridge
 *  ahead, the outro behind, each with its chip. */
export const Drifted: Story = {}

/** The same at 5%: only the bridge is far enough off to turn amber. */
export const WiderTolerance: Story = { args: { tolerance: 0.05 } }

/** A take that held the tempo: the line inside the band, nothing amber. */
export const Steady: Story = { args: { bars: bars(run(84, 127.6, 128.4)) } }

/** A two-bar stop in the middle: no tempo there, so the line breaks. */
export const AStop: Story = {
  args: { bars: bars([...run(30, 128), null, null, ...run(30, 128)]), to: 120 },
}
