import type { Meta, StoryObj } from "@storybook/react-vite"
import { Button } from "./button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./card"

const meta = {
  title: "UI/Card",
  component: Card,
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Card>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <Card {...args}>
      <CardHeader>
        <CardTitle>Thursday rehearsal</CardTitle>
        <CardDescription>6 songs, 2 hours 10 minutes</CardDescription>
      </CardHeader>
      <CardContent>The room mic was on all evening.</CardContent>
      <CardFooter>
        <Button size="sm">Open</Button>
      </CardFooter>
    </Card>
  ),
}

export const WithAction: Story = {
  render: (args) => (
    <Card {...args}>
      <CardHeader>
        <CardTitle>Thursday rehearsal</CardTitle>
        <CardDescription>6 songs, 2 hours 10 minutes</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm">Share</Button>
        </CardAction>
      </CardHeader>
    </Card>
  ),
}
