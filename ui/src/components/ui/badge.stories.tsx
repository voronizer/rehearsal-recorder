import type { Meta, StoryObj } from "@storybook/react-vite"
import { Badge } from "./badge"

const meta = {
  title: "UI/Badge",
  component: Badge,
  args: { children: "Badge" },
} satisfies Meta<typeof Badge>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Secondary: Story = { args: { variant: "secondary" } }
export const Destructive: Story = { args: { variant: "destructive" } }
export const Outline: Story = { args: { variant: "outline" } }
export const Ghost: Story = { args: { variant: "ghost" } }
export const Link: Story = { args: { variant: "link" } }
export const Signal: Story = { args: { variant: "signal" } }
export const Warn: Story = { args: { variant: "warn" } }
