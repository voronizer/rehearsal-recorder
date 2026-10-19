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
 *  click's output (the player's, until one is picked), the volume, the
 *  sound and the count-in. Each is saved at once; a sound picked, or the
 *  volume let go, plays a bar. */
export const Default: Story = {}
