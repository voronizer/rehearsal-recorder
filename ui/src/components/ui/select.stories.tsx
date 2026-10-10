import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "./select"

const meta = {
  title: "UI/Select",
  component: Select,
  render: (args) => (
    <Select {...args}>
      <SelectTrigger className="w-56">
        <SelectValue placeholder="Input" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Inputs</SelectLabel>
          <SelectItem value="room">Room mic</SelectItem>
          <SelectItem value="desk">Desk mixer</SelectItem>
          <SelectItem value="usb">USB interface</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  ),
} satisfies Meta<typeof Select>

export default meta
type Story = StoryObj<typeof meta>

export const Placeholder: Story = {}
export const WithValue: Story = { args: { defaultValue: "desk" } }
export const Disabled: Story = { args: { disabled: true } }

export const Open: Story = {
  args: { defaultOpen: true, defaultValue: "room" },
  // The list opens over the trigger, outside the story's own box.
  decorators: [(Story) => <div className="h-48"><Story /></div>],
}
