import type { Meta, StoryObj } from "@storybook/react-vite"
import { CountIn } from "./CountIn"

const meta = {
  title: "Metronome/CountIn",
  component: CountIn,
  args: { count: 1, signature: "4/4", size: "9.5rem" },
  decorators: [
    (Story) => (
      // The clock's box it lies over, "0:00" wide.
      <div className="relative w-64 leading-none">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CountIn>

export default meta
type Story = StoryObj<typeof meta>

/** The first of the bar, in the accent. */
export const First: Story = {}

/** The others in the text's colour. */
export const Third: Story = { args: { count: 3 } }

/** 6/8's fourth is accented too. */
export const SixEightFourth: Story = { args: { count: 4, signature: "6/8" } }

/** A second bar counts the bar again: its first click is 1. */
export const SecondBar: Story = { args: { count: 5 } }
