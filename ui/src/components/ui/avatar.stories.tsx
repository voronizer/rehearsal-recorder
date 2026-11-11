import type { Meta, StoryObj } from "@storybook/react-vite"
import { Avatar, AvatarFallback, AvatarGroup } from "./avatar"

const meta = {
  title: "UI/Avatar",
  component: Avatar,
} satisfies Meta<typeof Avatar>

export default meta
type Story = StoryObj<typeof meta>

/** A member with no picture: their initials. */
export const Default: Story = {
  render: () => (
    <Avatar>
      <AvatarFallback>AB</AvatarFallback>
    </Avatar>
  ),
}

export const Group: Story = {
  render: () => (
    <AvatarGroup>
      {["AB", "CD", "EF"].map((n) => (
        <Avatar key={n}>
          <AvatarFallback>{n}</AvatarFallback>
        </Avatar>
      ))}
    </AvatarGroup>
  ),
}
