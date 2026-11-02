import type { Meta, StoryObj } from "@storybook/react-vite"
import { TakeWave } from "./take-wave"

// A take's shape as Python sends it: 120 values in 0..1, quiet at the count-in,
// a chorus, a quieter bridge and a last chorus.
const SHAPE = Array.from({ length: 120 }, (_, i) => {
  const t = i / 119
  const swell = t < 0.06 ? 0.15 : t < 0.35 ? 0.6 : t < 0.55 ? 0.95 : t < 0.7 ? 0.45 : 1
  return Math.round(Math.min(1, swell * (0.75 + 0.25 * Math.abs(Math.sin(i * 1.7)))) * 100) / 100
})

const meta = {
  title: "UI/TakeWave",
  component: TakeWave,
  args: { shape: SHAPE, duration: 200, onPress: () => {} },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TakeWave>

export default meta
type Story = StoryObj<typeof meta>

/** A take in a list: its shape, grey. A press plays it from there. */
export const AtRest: Story = {}

/** Starred: green. */
export const Starred: Story = { args: { starred: true } }

/** A false start, or a take not on disk: pale. */
export const Quiet: Story = { args: { quiet: true } }

/** Playing, a third in: the part played darker, and the playhead. */
export const Playing: Story = { args: { played: 0.33 } }

/** Its marks, each a line in its label's colour with a diamond on top. */
export const WithMarks: Story = {
  args: {
    marks: [
      { at: 58, colour: "red" },
      { at: 134, colour: "amber" },
    ],
  },
}

/** Before its shape is in: a flat line, as long as the take, so the row
 *  does not move when it comes. */
export const NotInYet: Story = { args: { shape: null } }
