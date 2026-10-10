import type { Meta, StoryObj } from "@storybook/react-vite"
import { Input } from "./input"

const meta = {
  title: "UI/Input",
  component: Input,
  args: { placeholder: "Song name" },
  decorators: [
    (Story) => (
      <div className="w-72">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Input>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Filled: Story = { args: { defaultValue: "Blue in Green" } }
export const Invalid: Story = {
  args: { defaultValue: "Blue in Green", "aria-invalid": true },
}
export const Disabled: Story = { args: { disabled: true } }
