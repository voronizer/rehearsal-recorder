import type { Meta, StoryObj } from "@storybook/react-vite"
import { SongBacking } from "./SongBacking"
import { stubBackingBridge } from "./storyBridge"

const PALYN = { name: "Pałyn backing.wav", seconds: 222, channels: 2 as const, tempo: 128, first_bar: 0.8, missing: false }

const meta = {
  title: "Backing track/SongBacking",
  component: SongBacking,
  args: {
    song: { id: 1, title: "Pałyn", tempo: 128, signature: "4/4", backing: PALYN },
    onTempo: () => {},
    onChanged: () => {},
    stopped: 0,
    onPlay: () => {},
  },
  decorators: [
    (Story) => {
      stubBackingBridge()
      return (
        <div className="w-[40rem]">
          <Story />
        </div>
      )
    },
  ],
} satisfies Meta<typeof SongBacking>

export default meta
type Story = StoryObj<typeof meta>

/** Counted at the song's tempo: bar 1 on the first strong beat, a beat
 *  earlier or later from the line, ▶ with the click from bar 1. */
export const AsTheSong: Story = {}

/** No backing track yet: Add backing track… counts the file's tempo. */
export const None: Story = {
  args: { song: { id: 4, title: "Dym", tempo: null, signature: null, backing: null } },
}

/** Counted at 126 while the song keeps 128, until the line's link. */
export const OtherTempo: Story = {
  args: {
    song: {
      id: 3,
      title: "Viasna",
      tempo: 128,
      signature: "4/4",
      backing: { ...PALYN, name: "Viasna backing.wav", seconds: 268, tempo: 126, first_bar: 0.45 },
    },
  },
}

/** Pads with no steady beat: the click keeps the song's 96. */
export const Pads: Story = {
  args: {
    song: {
      id: 2,
      title: "Sonca",
      tempo: 96,
      signature: "3/4",
      backing: { name: "Sonca pads.wav", seconds: 300, channels: 1, tempo: null, first_bar: 0, missing: false },
    },
  },
}

/** Its copy deleted from the Backing tracks folder by hand. */
export const Missing: Story = {
  args: {
    song: {
      id: 1,
      title: "Pałyn",
      tempo: 128,
      signature: "4/4",
      backing: { ...PALYN, seconds: null, channels: null, missing: true },
    },
  },
}
