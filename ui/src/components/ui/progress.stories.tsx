import type { Meta, StoryObj } from "@storybook/react-vite"
import { Progress } from "./progress"

const meta = {
  title: "UI/Progress",
  component: Progress,
  decorators: [
    (Story) => (
      <div className="w-72">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Progress>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = { args: { value: 0 } }
export const Half: Story = { args: { value: 50 } }
export const Full: Story = { args: { value: 100 } }
