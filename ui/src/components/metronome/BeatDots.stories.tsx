import type { Meta, StoryObj } from "@storybook/react-vite"
import { useEffect, useState } from "react"
import { BeatDots } from "./BeatDots"
import { perBar } from "@/lib/metronome"
import type { Signature } from "@/lib/api"

const meta = {
  title: "Metronome/BeatDots",
  component: BeatDots,
  args: { signature: "4/4", lit: null },
} satisfies Meta<typeof BeatDots>

export default meta
type Story = StoryObj<typeof meta>

/** Dark between clicks: the first of the bar larger. */
export const Still: Story = {}

/** The first click of the bar, lit in the accent. */
export const FirstLit: Story = { args: { lit: 0 } }

/** 6/8 in two groups of three, the first and the fourth larger, in the
 *  room the row keeps for them whatever the signature. */
export const SixEight: Story = { args: { signature: "6/8", lit: 3 } }

const SIGNATURES: Signature[] = ["4/4", "3/4", "2/4", "6/8"]

function Clicking({ signature }: { signature: Signature }) {
  const [lit, setLit] = useState<number | null>(0)
  useEffect(() => {
    let i = 0
    const on = window.setInterval(() => {
      i = (i + 1) % perBar(signature)
      setLit(i)
      window.setTimeout(() => setLit(null), 150)
    }, 500)
    return () => window.clearInterval(on)
  }, [signature])
  return <BeatDots signature={signature} lit={lit} />
}

/** Each signature at 120 a minute, on and off with no fade. */
export const Running: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {SIGNATURES.map((s) => (
        <div key={s} className="flex items-center gap-3 text-sm">
          <span className="tnum w-8">{s}</span>
          <Clicking signature={s} />
        </div>
      ))}
    </div>
  ),
}
