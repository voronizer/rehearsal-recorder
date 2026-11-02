import type { Meta, StoryObj } from "@storybook/react-vite"
import { Mic } from "lucide-react"
import { useState } from "react"
import { Toggle } from "./toggle"

const meta = {
  title: "UI/Toggle",
  component: Toggle,
  args: { children: "Stereo", "aria-label": "Stereo" },
} satisfies Meta<typeof Toggle>

export default meta
type Story = StoryObj<typeof meta>

const VARIANTS = ["default", "outline"] as const

/** Off: a bare button that stays pressed when it is pressed (`aria-pressed`). */
export const Default: Story = {}

/** On is a grey fill, never the accent (F2). */
export const On: Story = { args: { defaultPressed: true } }

export const Outline: Story = { args: { variant: "outline" } }
export const OutlineOn: Story = { args: { variant: "outline", defaultPressed: true } }

export const WithIcon: Story = {
  args: {
    variant: "outline",
    children: (
      <>
        <Mic /> Stereo
      </>
    ),
  },
}

/** A square one for an icon, with its name in `aria-label`. */
export const IconOnly: Story = {
  args: { size: "icon-row", variant: "outline", children: <Mic />, "aria-label": "Microphone" },
}

/** Off, on and switched off, in both variants. */
export const States: Story = {
  render: (args) => (
    <div className="grid grid-cols-[auto_auto_auto_auto] items-center justify-start gap-4">
      {VARIANTS.map((variant) => (
        <div key={variant} className="contents">
          <Toggle {...args} variant={variant}>
            {variant}
          </Toggle>
          <Toggle {...args} variant={variant} defaultPressed>
            {variant} on
          </Toggle>
          <Toggle {...args} variant={variant} disabled>
            {variant} off
          </Toggle>
          <Toggle {...args} variant={variant} defaultPressed disabled>
            {variant} on
          </Toggle>
        </div>
      ))}
    </div>
  ),
}

function Pressing() {
  const [on, setOn] = useState(false)
  return (
    <div className="flex items-center gap-4">
      <Toggle variant="outline" pressed={on} onPressedChange={setOn}>
        Stereo
      </Toggle>
      <span className="text-sm text-muted-foreground">{on ? "on" : "off"}</span>
    </div>
  )
}

/** Controlled: what is on or off is the page's, and the toggle's words stay
 *  the same either way, as a toggle's name must. A button whose words say
 *  what pressing it does, as Check signal and Stop checking do, is a Button,
 *  not a Toggle. */
export const Controlled: Story = { render: () => <Pressing /> }

/** Pressing one changes nothing beside it: both states have the same frame
 *  and weight, so the width is the same (as Button's variants are, C1). */
export const NothingMoves: Story = {
  render: (args) => (
    <div className="flex w-fit items-center gap-2 rounded-md border border-dashed p-2">
      <Toggle {...args}>Stereo</Toggle>
      <Toggle {...args} defaultPressed>
        Stereo
      </Toggle>
    </div>
  ),
}

/** `row` is 32 px, as Button's; `icon-row` is a 32 px square; `lane` is the
 *  20 px square of M and S on a track's plate. */
export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-4">
      <Toggle {...args} size="row" variant="outline">
        row
      </Toggle>
      <Toggle {...args} size="icon-row" variant="outline" aria-label="Microphone">
        <Mic />
      </Toggle>
      <Toggle {...args} size="lane" variant="outline" aria-label="Mute">
        M
      </Toggle>
    </div>
  ),
}

/** M and S as a track's plate has them: 20 px, 4 px corners, 6 px apart, the
 *  letter in 12 px semibold. Pressed, M is the accent blue and S amber. */
export const Lane: Story = {
  render: (args) => (
    <div className="flex gap-1.5">
      <Toggle {...args} size="lane" variant="outline" tone="mute" className="font-semibold" defaultPressed aria-label="Mute">
        M
      </Toggle>
      <Toggle
        {...args}
        size="lane"
        variant="outline"
        tone="solo"
        className="font-semibold"
        defaultPressed
        aria-label="Solo"
      >
        S
      </Toggle>
    </div>
  ),
}
export const LaneLight: Story = { ...Lane, globals: { theme: "light" } }
