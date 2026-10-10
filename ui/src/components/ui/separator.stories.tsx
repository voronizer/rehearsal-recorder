import type { Meta, StoryObj } from "@storybook/react-vite"
import { Separator } from "./separator"

const meta = {
  title: "UI/Separator",
  component: Separator,
} satisfies Meta<typeof Separator>

export default meta
type Story = StoryObj<typeof meta>

export const Horizontal: Story = {
  render: (args) => (
    <div className="w-72 text-sm">
      Above
      <Separator {...args} className="my-3" />
      Below
    </div>
  ),
}

export const Vertical: Story = {
  args: { orientation: "vertical" },
  render: (args) => (
    <div className="flex h-5 items-center gap-3 text-sm">
      Left
      <Separator {...args} />
      Right
    </div>
  ),
}
