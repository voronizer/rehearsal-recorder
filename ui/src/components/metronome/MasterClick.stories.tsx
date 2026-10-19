import type { Meta, StoryObj } from "@storybook/react-vite"
import { MasterClick } from "./MasterClick"
import { stubBridge } from "./storyBridge"

const meta = {
  title: "Metronome/MasterClick",
  component: MasterClick,
  args: { take: { tempo: 128, signature: "4/4", click: true } },
  decorators: [
    (Story) => {
      stubBridge()
      return (
        <div className="flex h-4 w-44 items-center gap-2 text-sm">
          <span className="flex-1">Master</span>
          <Story />
        </div>
      )
    },
  ],
} satisfies Meta<typeof MasterClick>

export default meta
type Story = StoryObj<typeof meta>

/** A click take: pressed, the click plays with it. Grey when on, as every
 *  switch is, and its tip says the take's tempo. */
export const ClickTake: Story = {}

/** In 6/8 the tip draws the eighth. */
export const SixEight: Story = { args: { take: { tempo: 198, signature: "6/8", click: true } } }

/** A take recorded without the click has none to play. */
export const WithoutTheClick: Story = { args: { take: { tempo: null, signature: null, click: false } } }
