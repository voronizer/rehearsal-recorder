import type { Meta, StoryObj } from "@storybook/react-vite"
import { useEffect, useState } from "react"
import { EdgeLight } from "./EdgeLight"
import { accentOf } from "@/lib/metronome"

const meta = {
  title: "Metronome/EdgeLight",
  component: EdgeLight,
  args: { accent: 2 },
} satisfies Meta<typeof EdgeLight>

export default meta
type Story = StoryObj<typeof meta>

/** The first click of a bar: 14 px, full. */
export const FirstOfBar: Story = {}

/** The others: 7 px, paler. */
export const OtherClick: Story = { args: { accent: 0 } }

/** Between clicks it is dark. */
export const Dark: Story = { args: { accent: null } }

function Clicking() {
  const [accent, setAccent] = useState<0 | 1 | 2 | null>(null)
  useEffect(() => {
    let i = 0
    const on = window.setInterval(() => {
      setAccent(accentOf("4/4", i++))
      window.setTimeout(() => setAccent(null), 150)
    }, 500)
    return () => window.clearInterval(on)
  }, [])
  return <EdgeLight accent={accent} />
}

/** 4/4 at 120 a minute: on and off on the click, with no fade, under
 *  Reduce motion too. */
export const Running: Story = { render: () => <Clicking /> }
