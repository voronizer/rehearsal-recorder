import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { FileStart } from "./FileStart"
import type { Signature } from "@/lib/api"
import { drawnRange } from "@/lib/backing"

/** Peaks with a hit on every beat at `tempo` after a lead-in to `bar`. */
function peaksOf(end: number, bar: number, tempo: number | null): number[][] {
  const row = Array.from({ length: 320 }, (_, i) => {
    const t = ((i + 0.5) * end) / 320
    if (t < bar) return 0.02
    if (tempo === null) return 0.25 + 0.15 * Math.sin(t * 1.3) ** 2
    const p = (t - bar) % (60 / tempo)
    return 0.18 + 0.6 * Math.exp(-p / 0.06)
  })
  return [row, row.map((v) => v * 0.85)]
}

function Drawn({
  start,
  tempo,
  signature,
  playhead = null,
}: {
  start: number
  tempo: number | null
  signature: Signature
  playhead?: number | null
}) {
  const [firstBar, setFirstBar] = useState(start)
  const [end] = useState(() => drawnRange(start, tempo, signature).end)
  const [peaks] = useState(() => peaksOf(end, start, tempo))
  return (
    <div className="w-[36rem]">
      <FileStart
        peaks={peaks}
        length={222}
        firstBar={firstBar}
        tempo={tempo}
        signature={signature}
        end={end}
        playhead={playhead}
        onFirstBar={setFirstBar}
      />
    </div>
  )
}

const meta = {
  title: "Backing track/FileStart",
  component: FileStart,
  args: {
    peaks: null,
    length: 222,
    firstBar: 0.8,
    tempo: 128,
    signature: "4/4",
    end: 8.3,
    playhead: null,
    onFirstBar: () => {},
  },
} satisfies Meta<typeof FileStart>

export default meta
type Story = StoryObj<typeof meta>

/** Pałyn's file at 128: drag bar 1, or focus its marker and use ← and →, a
 *  tenth with Shift. The scale stays as it is while bar 1 moves. */
export const Default: Story = { render: () => <Drawn start={0.8} tempo={128} signature="4/4" /> }

/** 3/4 at 96: a bar every three beats. */
export const ThreeFour: Story = { render: () => <Drawn start={0} tempo={96} signature="3/4" /> }

/** No tempo: no bars to draw, bar 1 alone. */
export const NoTempo: Story = { render: () => <Drawn start={0} tempo={null} signature="4/4" /> }

/** ▶ has got to 3.1 s: the playhead, and the part played in the accent. */
export const Playing: Story = {
  render: () => <Drawn start={0.8} tempo={128} signature="4/4" playhead={3.1} />,
}

/** Before the peaks are read: the well alone, at its height. */
export const Reading: Story = {}
