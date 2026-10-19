import type { Meta, StoryObj } from "@storybook/react-vite"
import { MasterClickLane } from "./MasterClickLane"

const meta = {
  title: "Metronome/MasterClickLane",
  component: MasterClickLane,
  args: { from: 0, to: 30, position: 9.4, take: { tempo: 128, signature: "4/4", click: true } },
  decorators: [
    (Story) => (
      <div className="w-[40rem] rounded-lg bg-card p-[3px]" style={{ height: "3.5rem" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MasterClickLane>

export default meta
type Story = StoryObj<typeof meta>

/** Thirty seconds of a take at 128: every click, the bars taller, dimmed
 *  while the click is off. */
export const Clicks: Story = {}

/** Three minutes in view: only the bars. */
export const Bars: Story = { args: { to: 180, position: 60 } }

/** Fifteen minutes in view: every fourth bar. */
export const EveryFourthBar: Story = { args: { to: 900, position: 300 } }

/** A 6/8 at 198 eighths a minute, its tag with the drawn eighth. */
export const SixEight: Story = { args: { take: { tempo: 198, signature: "6/8", click: true } } }

/** A take recorded without the click: no stripes, and the lane says so. */
export const WithoutTheClick: Story = { args: { take: { tempo: null, signature: null, click: false } } }
