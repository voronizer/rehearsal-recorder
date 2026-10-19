import type { Meta, StoryObj } from "@storybook/react-vite"
import { MetronomeSettings } from "./MetronomeSettings"
import { stubBridge } from "./metronome/storyBridge"

const meta = {
  title: "Settings/MetronomeSettings",
  component: MetronomeSettings,
  decorators: [
    (Story) => {
      stubBridge()
      return (
        <div className="flex w-[42rem] flex-col gap-12">
          <Story />
        </div>
      )
    },
  ],
} satisfies Meta<typeof MetronomeSettings>

export default meta
type Story = StoryObj<typeof meta>

/** Settings › Metronome: the click's output, then its volume, sound and
 *  count-in, the same settings as behind the gear in the metronome's row,
 *  and the tab's own, the tempo in WAV files, on by default. */
export const Default: Story = {}

/** The WAV setting turned off: takes recorded from now on carry no tempo. */
export const NoTempoInWav: Story = {
  decorators: [
    (Story) => {
      stubBridge({ tempo_in_wav: false })
      return <Story />
    },
  ],
}
