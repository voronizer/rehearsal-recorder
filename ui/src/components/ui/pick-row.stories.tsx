import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { PickRow } from "./pick-row"

const meta = {
  title: "UI/PickRow",
  component: PickRow,
} satisfies Meta<typeof PickRow>

export default meta
type Story = StoryObj<typeof meta>

const SOUNDS = [
  { value: "click", label: "Click" },
  { value: "wood", label: "Woodblock" },
  { value: "hihat", label: "Hi-hat" },
]

function Picking<T extends string | number>({
  label,
  start,
  options,
}: {
  label: string
  start: T | null
  options: { value: T; label: string; name?: string; disabled?: boolean }[]
}) {
  const [value, setValue] = useState<T | null>(start)
  return <PickRow label={label} value={value} options={options} onChange={setValue} />
}

/** One of a few words, the chosen one the plate on the grey track. */
export const Default: Story = {
  args: { label: "Sound", value: "click", options: SOUNDS, onChange: () => {} },
  render: () => <Picking label="Sound" start="click" options={SOUNDS} />,
}

/** Before the setting is read, none is on. */
export const NotReadYet: Story = {
  args: { label: "Sound", value: null, options: SOUNDS, onChange: () => {} },
}

/** A choice the setting cannot take now is shown, and cannot be chosen. */
export const OneDisabled: Story = {
  args: {
    label: "Depth",
    value: 24,
    options: [
      { value: 16, label: "16 bit", disabled: true },
      { value: 24, label: "24 bit" },
    ],
    onChange: () => {},
  },
}

/** Rows one under another line up their switches: each name takes 5 rem at
 *  least. */
export const Rows: Story = {
  args: { label: "Sound", value: "click", options: SOUNDS, onChange: () => {} },
  render: () => (
    <div className="flex flex-col gap-4">
      <Picking label="Sound" start="wood" options={SOUNDS} />
      <Picking
        label="Count-in"
        start={1}
        options={[
          { value: 0, label: "None" },
          { value: 1, label: "1 bar" },
          { value: 2, label: "2 bars" },
        ]}
      />
    </div>
  ),
}
