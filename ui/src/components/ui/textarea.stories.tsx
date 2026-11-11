import type { Meta, StoryObj } from "@storybook/react-vite"
import { Textarea } from "./textarea"

const meta = {
  title: "UI/Textarea",
  component: Textarea,
  args: { placeholder: "A note", className: "w-72" },
} satisfies Meta<typeof Textarea>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** No frame: a line under it, brighter on hover, thicker while typed in. */
export const Line: Story = {
  args: { variant: "line", rows: 1, defaultValue: "Guitar, second verse" },
}

export const Invalid: Story = { args: { "aria-invalid": true } }
