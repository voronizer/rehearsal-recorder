import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { BarOneField } from "./BarOneField"

const meta = {
  title: "Backing track/BarOneField",
  component: BarOneField,
  args: { value: 0.8, length: 222, onChange: () => {} },
} satisfies Meta<typeof BarOneField>

export default meta
type Story = StoryObj<typeof meta>

function Typed({ start, length }: { start: number; length: number | null }) {
  const [value, setValue] = useState(start)
  return <BarOneField value={value} length={length} onChange={setValue} />
}

/** Type "0:01.27" or "1.27" and press Enter, or go a hundredth at a time
 *  with − and +, or ↑ and ↓ in the field, a tenth with Shift. Not a time
 *  puts back what it had. */
export const Default: Story = { render: () => <Typed start={0.8} length={222} /> }

/** At the file's start, − has nowhere to go. */
export const AtTheStart: Story = { render: () => <Typed start={0} length={222} /> }

/** Past a minute in, as a long lead-in has it. */
export const PastAMinute: Story = { render: () => <Typed start={62.5} length={222} /> }
