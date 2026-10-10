import type { Meta, StoryObj } from "@storybook/react-vite"
import { Button } from "./button"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"

const meta = {
  title: "UI/Popover",
  component: Popover,
} satisfies Meta<typeof Popover>

export default meta
type Story = StoryObj<typeof meta>

const trigger = (
  <PopoverTrigger asChild>
    <Button variant="outline">Open</Button>
  </PopoverTrigger>
)

export const Closed: Story = {
  render: (args) => (
    <Popover {...args}>
      {trigger}
      <PopoverContent>Click the button again to close.</PopoverContent>
    </Popover>
  ),
}

export const Open: Story = {
  render: (args) => (
    <Popover {...args} defaultOpen>
      {trigger}
      <PopoverContent>Click the button again to close.</PopoverContent>
    </Popover>
  ),
  // The panel opens beside the button, outside the story's own box.
  decorators: [(Story) => <div className="h-24"><Story /></div>],
}
