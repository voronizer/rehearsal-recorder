import type { Meta, StoryObj } from "@storybook/react-vite"
import { StatusLine } from "./StatusLine"

const meta = {
  title: "Metronome/StatusLine",
  component: StatusLine,
  args: { line: { text: "The song's tempo." } },
  decorators: [
    (Story) => (
      <div className="w-[28rem]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof StatusLine>

export default meta
type Story = StoryObj<typeof meta>

/** One line, in the room of two, so a longer one moves nothing. */
export const Short: Story = {}

/** A change held, and the link that saves it, in the text's colour. */
export const WithLink: Story = {
  args: {
    line: {
      text: "The song has 128 · 4/4; this holds until another song.",
      link: { label: "Save to song", action: "save" },
    },
  },
}

/** The longest it says, on two lines. */
export const Longest: Story = {
  args: {
    line: {
      text: "No tempo in the song yet: the first take played to the click keeps this one.",
      link: { label: "Save now", action: "save" },
    },
  },
}

/** A warning: the icon in amber, the words in the text's colour. */
export const Warning: Story = {
  args: {
    line: { text: "The click's output, X18, is not connected. The beat will only flash.", warn: true },
  },
}

/** During a take. */
export const CountIn: Story = { args: { line: { text: "Count-in: 2 of 4" } } }
