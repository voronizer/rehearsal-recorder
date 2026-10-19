import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { SignatureSelect } from "./SignatureSelect"
import type { Signature } from "@/lib/api"

const meta = {
  title: "Metronome/SignatureSelect",
  component: SignatureSelect,
  args: { value: "4/4", onChange: () => {} },
} satisfies Meta<typeof SignatureSelect>

export default meta
type Story = StoryObj<typeof meta>

function Picking({ start }: { start: Signature }) {
  const [value, setValue] = useState(start)
  return <SignatureSelect value={value} onChange={setValue} />
}

/** One of the four, each as wide as the others. */
export const Default: Story = { render: () => <Picking start="4/4" /> }
export const SixEight: Story = { render: () => <Picking start="6/8" /> }
export const Disabled: Story = { args: { disabled: true } }
