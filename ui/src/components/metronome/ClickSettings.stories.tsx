import type { Meta, StoryObj } from "@storybook/react-vite"
import { ClickSettings } from "./ClickSettings"
import { stubBridge } from "./storyBridge"

const meta = {
  title: "Metronome/ClickSettings",
  component: ClickSettings,
  decorators: [
    (Story) => {
      stubBridge()
      return (
        <div className="w-[23rem] rounded-md border bg-popover p-4">
          <Story />
        </div>
      )
    },
  ],
} satisfies Meta<typeof ClickSettings>

export default meta
type Story = StoryObj<typeof meta>

/** The four settings as the gear in the metronome's row shows them: the
 *  click's output (where the player plays, until one is picked, with the
 *  player's outputs), the volume, the sound and the count-in. Each is saved
 *  at once; a sound picked, or the volume let go, plays a bar. */
export const Default: Story = {}

/** An output of the click's own, the laptop's speakers. */
export const OwnOutput: Story = {
  decorators: [
    (Story) => {
      stubBridge({ click_device_index: 1, click_channels: [1, 2] })
      return <Story />
    },
  ],
}

/** The click's own output saved, and not plugged in: it keeps its place
 *  under its own name, and its outputs cannot be changed until it is back. */
export const Unplugged: Story = {
  decorators: [
    (Story) => {
      stubBridge({ click_device_index: 7, click_channels: [3, 4] }, "Headphone amp")
      return <Story />
    },
  ],
}
