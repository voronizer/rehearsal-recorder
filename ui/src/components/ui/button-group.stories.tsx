import type { Meta, StoryObj } from "@storybook/react-vite"
import { Button } from "./button"
import { ButtonGroup } from "./button-group"

const meta = {
  title: "UI/ButtonGroup",
  component: ButtonGroup,
} satisfies Meta<typeof ButtonGroup>

export default meta
type Story = StoryObj<typeof meta>

/** Buttons joined into one bar. */
export const Default: Story = {
  render: () => (
    <ButtonGroup>
      <Button variant="outline">Back</Button>
      <Button variant="outline">Play</Button>
      <Button variant="outline">Next</Button>
    </ButtonGroup>
  ),
}

export const Vertical: Story = {
  render: () => (
    <ButtonGroup orientation="vertical">
      <Button variant="outline">Up</Button>
      <Button variant="outline">Down</Button>
    </ButtonGroup>
  ),
}
