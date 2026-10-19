import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { TempoField } from "./TempoField"
import type { Signature } from "@/lib/api"

const meta = {
  title: "Metronome/TempoField",
  component: TempoField,
  args: { tempo: 128, signature: "4/4", onChange: () => {} },
} satisfies Meta<typeof TempoField>

export default meta
type Story = StoryObj<typeof meta>

function Typed({ start, signature }: { start: number | null; signature: Signature }) {
  const [tempo, setTempo] = useState(start)
  return <TempoField tempo={tempo} signature={signature} onChange={setTempo} />
}

/** Type a number and press Enter, or go a click a minute with − and +, or
 *  ↑ and ↓ in the field. Not a number puts the last one back. */
export const Default: Story = { render: () => <Typed start={128} signature="4/4" /> }

/** 6/8 counts eighths: the drawn eighth after it, 60 to 600. */
export const SixEight: Story = { render: () => <Typed start={198} signature="6/8" /> }

/** No tempo yet: − and + wait for one. */
export const Empty: Story = { render: () => <Typed start={null} signature="4/4" /> }

/** At the top of 4/4's range, + has nowhere to go. */
export const AtTheTop: Story = { render: () => <Typed start={300} signature="4/4" /> }

/** Before Python has answered. */
export const Disabled: Story = { args: { disabled: true } }
