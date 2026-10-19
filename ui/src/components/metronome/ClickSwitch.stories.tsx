import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { ClickSwitch } from "./ClickSwitch"

const meta = {
  title: "Metronome/ClickSwitch",
  component: ClickSwitch,
  args: { on: true, onChange: () => {} },
} satisfies Meta<typeof ClickSwitch>

export default meta
type Story = StoryObj<typeof meta>

function Switching({ start }: { start: boolean }) {
  const [on, setOn] = useState(start)
  return <ClickSwitch on={on} onChange={setOn} />
}

/** On: Record clicks. Grey, as every switch that is on. */
export const On: Story = { render: () => <Switching start /> }

/** Off: takes record without the click. */
export const Off: Story = { render: () => <Switching start={false} /> }

/** A take with no click has nothing to switch. */
export const Disabled: Story = { args: { on: false, disabled: true } }
