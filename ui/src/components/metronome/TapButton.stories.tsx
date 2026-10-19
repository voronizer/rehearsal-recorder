import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { TapButton } from "./TapButton"
import type { Signature } from "@/lib/api"

const meta = {
  title: "Metronome/TapButton",
  component: TapButton,
  args: { signature: "4/4", onTempo: () => {} },
} satisfies Meta<typeof TapButton>

export default meta
type Story = StoryObj<typeof meta>

function Tapping({ signature }: { signature: Signature }) {
  const [tempo, setTempo] = useState<number | null>(null)
  return (
    <div className="flex items-center gap-3 text-sm">
      <TapButton signature={signature} onTempo={setTempo} />
      <span className="tnum text-muted-foreground">{tempo ?? "Tap a few times, or press T"}</span>
    </div>
  )
}

/** Tap, or T, in time a few times: the last four gaps make the tempo, and a
 *  pause of two seconds starts afresh. With the player's keys off in
 *  Settings › Keys, the chip goes and T does nothing. */
export const Default: Story = { render: () => <Tapping signature="4/4" /> }

/** In 6/8 a tap is an eighth. */
export const SixEight: Story = { render: () => <Tapping signature="6/8" /> }

export const Disabled: Story = { args: { disabled: true } }
