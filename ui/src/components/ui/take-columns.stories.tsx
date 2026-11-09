import type { Meta, StoryObj } from "@storybook/react-vite"
import { TakeColumns, type TakeColumn } from "./take-columns"

const TONIGHT: TakeColumn[] = [
  { key: 1, sec: 192, starred: false, lit: false },
  { key: 2, sec: 178, starred: true, lit: false },
  { key: 3, sec: 120, starred: false, lit: false },
  { key: 4, sec: 204, starred: false, lit: true },
]

const meta = {
  title: "UI/TakeColumns",
  component: TakeColumns,
  args: { columns: TONIGHT, height: 36 },
} satisfies Meta<typeof TakeColumns>

export default meta
type Story = StoryObj<typeof meta>

/** A song's takes tonight. The lit one is in the text's colour; a ★ take
 *  is a paler green. */
export const Tonight: Story = {}

/** The lit take is starred: the star's green. */
export const LitAndStarred: Story = {
  args: { columns: TONIGHT.map((c) => (c.key === 2 ? { ...c, lit: true } : { ...c, lit: false })) },
}

/** Beside a song on Last time: smaller. The lit one is the take the play
 *  button plays. */
export const Small: Story = { args: { height: 24 } }

/** A very short take is still tall enough to see. */
export const AVeryShortTake: Story = {
  args: { columns: [...TONIGHT.slice(0, 2), { key: 3, sec: 2, starred: false, lit: true }] },
}

/** Drawn to a length the caller gives, as Last time does: every song to the
 *  scale of its longest take, so the songs can be compared. */
export const ToTheCallersScale: Story = { args: { height: 24, longest: 480 } }

/** Ten at the most are shown by the caller; this is the widest the piece gets. */
export const Ten: Story = {
  args: {
    columns: Array.from({ length: 10 }, (_, i) => ({
      key: i + 1,
      sec: 90 + ((i * 37) % 120),
      starred: i % 4 === 1,
      lit: i === 9,
    })),
  },
}
