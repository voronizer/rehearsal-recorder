import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { ToggleGroup, ToggleGroupItem } from "./toggle-group"

const meta = {
  title: "UI/ToggleGroup",
  component: ToggleGroup,
  args: { type: "single" },
} satisfies Meta<typeof ToggleGroup>

export default meta
type Story = StoryObj<typeof meta>

const MODES = ["Audio", "Both", "MIDI"] as const

function Modes({
  variant,
  className,
  disabled,
}: {
  variant: "default" | "outline" | "switch"
  className?: string
  disabled?: boolean
}) {
  const [mode, setMode] = useState("Both")
  return (
    <ToggleGroup
      type="single"
      variant={variant}
      aria-label="Track 1 records"
      value={mode}
      // Pressing the chosen one again would leave none chosen.
      onValueChange={(v) => v && setMode(v)}
      className={className}
      disabled={disabled}
    >
      {MODES.map((m) => (
        <ToggleGroupItem key={m} value={m}>
          {m}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

/** History's switch: a grey track and the chosen item a plate on it. The
 *  arrow keys move along it, Tab leaves it. */
export const Switch: Story = { render: () => <Modes variant="switch" /> }

/** It takes the width it is given, as History's does across its list. */
export const SwitchFullWidth: Story = {
  render: () => (
    <div className="w-80">
      <Modes variant="switch" className="w-full" />
    </div>
  ),
}

export const SwitchDisabled: Story = {
  render: () => <Modes variant="switch" disabled />,
}

/** Pick one, joined into a bar. On is the grey fill (F2). */
export const Default: Story = { render: () => <Modes variant="default" /> }

export const Outline: Story = { render: () => <Modes variant="outline" /> }

function SeveralOn() {
  const [kept, setKept] = useState(["Audio"])
  return (
    <ToggleGroup type="multiple" variant="outline" aria-label="Kept" value={kept} onValueChange={setKept}>
      {MODES.map((m) => (
        <ToggleGroupItem key={m} value={m}>
          {m}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

/** Any number of them on at once. */
export const Several: Story = { render: () => <SeveralOn /> }

/** Square items for icons. */
export const IconsOnly: Story = {
  render: () => (
    <ToggleGroup type="single" variant="outline" size="icon-row" aria-label="Alignment" defaultValue="l">
      <ToggleGroupItem value="l" aria-label="Left">
        L
      </ToggleGroupItem>
      <ToggleGroupItem value="c" aria-label="Centre">
        C
      </ToggleGroupItem>
      <ToggleGroupItem value="r" aria-label="Right">
        R
      </ToggleGroupItem>
    </ToggleGroup>
  ),
}

/** `rovingFocus={false}`: every item stays in the Tab order, for a grid that keeps its own arrow keys. */
export const OwnArrowKeys: Story = {
  render: () => (
    <ToggleGroup type="single" rovingFocus={false} aria-label="Pick one">
      {["A", "B", "C"].map((v) => (
        <ToggleGroupItem key={v} value={v}>
          {v}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  ),
}
