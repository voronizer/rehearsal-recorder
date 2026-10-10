import type { Meta, StoryObj } from "@storybook/react-vite"
import { PlayIcon } from "lucide-react"
import { Button } from "./button"

const meta = {
  title: "UI/Button",
  component: Button,
  args: { children: "Button" },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Destructive: Story = { args: { variant: "destructive" } }
export const Outline: Story = { args: { variant: "outline" } }
export const Secondary: Story = { args: { variant: "secondary" } }
export const Ghost: Story = { args: { variant: "ghost" } }
export const Link: Story = { args: { variant: "link" } }
export const Disabled: Story = { args: { disabled: true } }

export const WithIcon: Story = {
  args: {
    children: (
      <>
        <PlayIcon /> Play
      </>
    ),
  },
}

/** Every size, side by side. */
export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-4">
      <Button {...args} size="xs">Extra small</Button>
      <Button {...args} size="sm">Small</Button>
      <Button {...args} size="default">Default</Button>
      <Button {...args} size="lg">Large</Button>
      <Button {...args} size="xl">Extra large</Button>
      <Button {...args} size="icon-xs" aria-label="Play"><PlayIcon /></Button>
      <Button {...args} size="icon-sm" aria-label="Play"><PlayIcon /></Button>
      <Button {...args} size="icon" aria-label="Play"><PlayIcon /></Button>
      <Button {...args} size="icon-lg" aria-label="Play"><PlayIcon /></Button>
    </div>
  ),
}
