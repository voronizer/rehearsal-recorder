import type { Meta, StoryObj } from "@storybook/react-vite"
import { BackingSettings } from "./BackingSettings"
import { stubBridge } from "@/components/metronome/storyBridge"

const meta = {
  title: "Backing track/BackingSettings",
  component: BackingSettings,
  decorators: [
    (Story) => {
      stubBridge()
      return (
        <div className="flex w-[42rem] flex-col gap-4">
          <Story />
        </div>
      )
    },
  ],
} satisfies Meta<typeof BackingSettings>

export default meta
type Story = StoryObj<typeof meta>

/** Settings › Click & backing track: where the player plays until an
 *  output of its own is picked, then the volume. */
export const Default: Story = {}

/** Behind the metronome's gear: the output alone. */
export const Compact: Story = { args: { compact: true } }

/** One output picked: a stereo file is played in mono. */
export const OneOutput: Story = {
  decorators: [
    (Story) => {
      stubBridge({ backing_device_index: 3, backing_channels: [5] })
      return <Story />
    },
  ],
}

/** Its output is not plugged in: kept under its own name. */
export const OutputMissing: Story = {
  decorators: [
    (Story) => {
      stubBridge({ backing_device_index: 7, backing_device_missing: "Scarlett 2i2", backing_channels: [1, 2] })
      return <Story />
    },
  ],
}
