import type { Meta, StoryObj } from "@storybook/react-vite"
import { SongTempoRow } from "./SongTempoRow"
import { stubBridge } from "./storyBridge"
import type { SongGo } from "@/lib/api"

/** A take of Dym at a rehearsal. */
const go = (n: number, created_at: string, starred = false): SongGo => ({
  folder: `/rec/${created_at.slice(0, 10)}`,
  rehearsal: "Tuesday jam",
  created_at,
  missing: false,
  take: { take_number: n, name: n === 1 ? "Dym" : `Dym ${n}`, starred, duration_sec: 270, tracks: [] },
})
const TAKES = [
  go(1, "2026-09-15T19:00:00"),
  go(2, "2026-09-19T15:00:00"),
  go(3, "2026-09-19T15:00:00"),
  go(5, "2026-09-19T15:00:00", true),
]

const meta = {
  title: "Metronome/SongTempoRow",
  component: SongTempoRow,
  args: { song: { id: 5, title: "Dym", tempo: null, signature: null }, takes: TAKES },
  decorators: [
    (Story) => {
      stubBridge()
      return (
        <div className="w-[36rem]">
          <Story />
        </div>
      )
    },
  ],
} satisfies Meta<typeof SongTempoRow>

export default meta
type Story = StoryObj<typeof meta>

/** A song with no tempo yet: type or tap one, or count it from one of its
 *  takes, the starred first, then the newest. A count offers halve and
 *  double. */
export const NoTempo: Story = {}

/** A song with its tempo: a change is saved to it at once, and ▶ runs the
 *  click at it. */
export const WithTempo: Story = {
  args: { song: { id: 1, title: "Pałyn", tempo: 128, signature: "4/4" } },
}

/** In 6/8 the number counts eighths, and the drawn eighth follows it. */
export const SixEight: Story = {
  args: { song: { id: 3, title: "Ahoń", tempo: 198, signature: "6/8" } },
}
