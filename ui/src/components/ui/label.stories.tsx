import type { Meta, StoryObj } from "@storybook/react-vite"
import { Input } from "./input"
import { Label } from "./label"

const meta = {
  title: "UI/Label",
  component: Label,
  args: { children: "Song name" },
} satisfies Meta<typeof Label>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** The label beside the field it names; clicking it focuses the field. */
export const WithInput: Story = {
  render: (args) => (
    <div className="flex w-72 flex-col gap-2">
      <Label {...args} htmlFor="song" />
      <Input id="song" placeholder="Blue in Green" />
    </div>
  ),
}
