import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { SpeedButton } from "./SpeedButton"

const meta = {
  title: "Service/SpeedButton",
  component: SpeedButton,
  args: { value: 1, onChange: () => {} },
} satisfies Meta<typeof SpeedButton>

export default meta
type Story = StoryObj<typeof meta>

/** As recorded: the outline button, with the gauge and the arrow. A press opens the ten speeds. */
export const AsRecorded: Story = {}

/** Slower: grey, as Repeat is when pressed. A pick here changes it. */
export const Slower: Story = {
  args: { value: 0.75 },
  render: (args) => <Picking {...args} />,
}

function Picking(props: Parameters<typeof SpeedButton>[0]) {
  const [value, setValue] = useState(props.value)
  return <SpeedButton {...props} value={value} onChange={setValue} />
}

/** The phone's bar: the number alone. */
export const Bare: Story = { args: { value: 0.75, bare: true } }

/** What keeps the key is loading: the gauge gives way to a spinner after a second. */
export const Loading: Story = { args: { value: 0.75, busy: true } }

/** It could not load: back at 100%, with the warning sign and its tip until the next pick. */
export const Failed: Story = { args: { value: 1, failed: true } }

/** The same in the phone's bar: the sign in front of the number. */
export const FailedBare: Story = { args: { value: 1, failed: true, bare: true } }

/** In a browser that cannot play the takes. */
export const Disabled: Story = { args: { disabled: true } }
