import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { Slider } from "./slider"

const meta = {
  title: "UI/Slider",
  component: Slider,
  args: { "aria-label": "Click volume", min: 0, max: 1, step: 0.01, defaultValue: [0.7] },
  decorators: [
    (Story) => (
      <div className="w-64">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Slider>

export default meta
type Story = StoryObj<typeof meta>

/** The set part in the text's colour, not the accent: a setting, not what plays. */
export const Default: Story = {}

export const Empty: Story = { args: { defaultValue: [0] } }
export const Full: Story = { args: { defaultValue: [1] } }
export const Disabled: Story = { args: { disabled: true } }

function Committed() {
  const [value, setValue] = useState(0.7)
  const [let_, setLet] = useState(0.7)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Slider
          aria-label="Click volume"
          min={0}
          max={1}
          step={0.01}
          value={[value]}
          onValueChange={([v]) => setValue(v)}
          onValueCommit={([v]) => setLet(v)}
        />
        <span className="tnum w-10 shrink-0 text-right text-sm text-muted-foreground">
          {Math.round(value * 100)}%
        </span>
      </div>
      <p className="text-xs text-muted-foreground">Let go at {Math.round(let_ * 100)}%</p>
    </div>
  )
}

/** Moved, and let go: `onValueCommit` is the value a setting saves, and a
 *  bar of the click plays at it. */
export const LetGo: Story = { render: () => <Committed /> }
