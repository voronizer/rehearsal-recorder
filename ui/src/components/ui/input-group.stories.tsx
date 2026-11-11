import type { Meta, StoryObj } from "@storybook/react-vite"
import { Search } from "lucide-react"
import { InputGroup, InputGroupAddon, InputGroupInput } from "./input-group"

const meta = {
  title: "UI/InputGroup",
  component: InputGroup,
} satisfies Meta<typeof InputGroup>

export default meta
type Story = StoryObj<typeof meta>

/** One frame round an input and what stands beside it. */
export const Default: Story = {
  render: () => (
    <InputGroup className="w-72">
      <InputGroupAddon>
        <Search />
      </InputGroupAddon>
      <InputGroupInput placeholder="Search takes" />
    </InputGroup>
  ),
}
