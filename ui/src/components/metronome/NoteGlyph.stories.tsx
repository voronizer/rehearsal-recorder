import type { Meta, StoryObj } from "@storybook/react-vite"
import { MeterText, NoteGlyph, TempoUnit } from "./NoteGlyph"

const meta = {
  title: "Metronome/NoteGlyph",
  component: NoteGlyph,
} satisfies Meta<typeof NoteGlyph>

export default meta
type Story = StoryObj<typeof meta>

/** The drawn eighth, as tall as the figures it follows, in their colour. */
export const Sizes: Story = {
  render: () => (
    <div className="flex items-baseline gap-6">
      {(["text-xs", "text-sm", "text-base", "text-xl", "text-2xl"] as const).map((size) => (
        <span key={size} className={`tnum font-semibold ${size}`}>
          198 <NoteGlyph />
        </span>
      ))}
    </div>
  ),
}

/** After a tempo: "bpm" in x/4, the eighth in 6/8, each in the room "bpm"
 *  takes, with a tip that says what the number counts. */
export const Units: Story = {
  render: () => (
    <div className="flex flex-col gap-3 text-sm">
      <span className="tnum font-semibold">
        128 <TempoUnit signature="4/4" className="font-normal" />
      </span>
      <span className="tnum font-semibold">
        198 <TempoUnit signature="6/8" className="font-normal" />
      </span>
    </div>
  ),
}

/** A tempo and its signature in a line of words, as Master's tip and tag
 *  say them: "bpm" in x/4, the drawn eighth in 6/8. */
export const Meter: Story = {
  render: () => (
    <div className="flex flex-col gap-3 text-sm">
      <MeterText tempo={128} signature="4/4" />
      <MeterText tempo={96} signature="3/4" />
      <MeterText tempo={198} signature="6/8" />
    </div>
  ),
}
