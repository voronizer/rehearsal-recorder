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

/** A take recorded without the click, whose files are not there: no
 *  stripes and no drift line, and the lane says so. */
export const WithoutTheClick: Story = { args: { take: { tempo: null, signature: null, click: false } } }

const bars = Array.from({ length: 16 }, (_, i) => ({
  n: i + 1,
  start: 1.875 * (i + 1),
  end: 1.875 * (i + 2),
  tempo: i >= 6 && i < 11 ? 134.6 : 128.2,
}))

/** A click take with the band's tempo over its stripes, which dim to a
 *  third: five bars ran ahead by 7. */
export const WithTheDrift: Story = {
  args: {
    drift: {
      counting: false,
      answer: {
        ok: true,
        source: "drums",
        per_bar: 4,
        middle: 128.2,
        aim: { tempo: 128, signature: "4/4", from: "click", song: null },
        bars,
      },
    },
  },
}

/** A take of a song played with the click off: its tempo from the song,
 *  and counted from the mix, no track having the drums icon. */
export const AgainstTheSong: Story = {
  args: {
    take: { tempo: null, signature: null, click: false },
    drift: {
      counting: false,
      answer: {
        ok: true,
        source: "mix",
        per_bar: 4,
        middle: 128.2,
        aim: { tempo: 128, signature: "4/4", from: "song", song: "Pałyn" },
        bars,
      },
    },
  },
}

/** Counting: after a second, a spinner in the tag's place. */
export const Counting: Story = { args: { drift: { counting: true, answer: null } } }

/** Too short to show a tempo along. */
export const TooShort: Story = { args: { drift: { counting: false, answer: { ok: false, why: "short" } } } }
