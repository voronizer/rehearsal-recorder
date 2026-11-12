import type { Meta, StoryObj } from "@storybook/react-vite"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./command"

const meta = {
  title: "UI/Command",
  component: Command,
} satisfies Meta<typeof Command>

export default meta
type Story = StoryObj<typeof meta>

/** A list you filter by typing, and move through with the arrows. */
export const Default: Story = {
  render: () => (
    <Command className="w-72 rounded-lg border">
      <CommandInput placeholder="Find a song" />
      <CommandList>
        <CommandEmpty>No song like that.</CommandEmpty>
        <CommandGroup heading="Songs">
          <CommandItem>Viasna</CommandItem>
          <CommandItem>Dym</CommandItem>
          <CommandItem>Zima</CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  ),
}
