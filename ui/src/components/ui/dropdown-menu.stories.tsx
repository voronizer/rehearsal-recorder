import type { Meta, StoryObj } from "@storybook/react-vite"
import { ListMusic, Plus, Trash2 } from "lucide-react"
import { useState } from "react"
import { Button } from "./button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "./dropdown-menu"

const meta = {
  title: "UI/DropdownMenu",
  component: DropdownMenu,
  // The menu opens beside the button, outside the story's own box.
  decorators: [(Story) => <div className="h-64"><Story /></div>],
} satisfies Meta<typeof DropdownMenu>

export default meta
type Story = StoryObj<typeof meta>

const trigger = (
  <DropdownMenuTrigger asChild>
    <Button variant="outline">
      <ListMusic />
      Sets
    </Button>
  </DropdownMenuTrigger>
)

export const Closed: Story = {
  render: (args) => (
    <DropdownMenu {...args}>
      {trigger}
      <DropdownMenuContent>
        <DropdownMenuItem>New set…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}

/** Items that do something, a label, a destructive one, and a key. */
export const Open: Story = {
  render: (args) => (
    <DropdownMenu {...args} defaultOpen modal={false}>
      {trigger}
      <DropdownMenuContent className="w-60">
        <DropdownMenuLabel>Set</DropdownMenuLabel>
        <DropdownMenuItem>
          <Plus />
          New set…
        </DropdownMenuItem>
        <DropdownMenuItem>
          Duplicate
          <DropdownMenuShortcut>D</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}

function Chooser() {
  const [set, setSet] = useState("gig")
  return (
    <DropdownMenu defaultOpen modal={false}>
      {trigger}
      <DropdownMenuContent className="w-72">
        <DropdownMenuRadioGroup value={set} onValueChange={setSet}>
          <DropdownMenuRadioItem value="">No set: play freely</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="gig">
            <span className="min-w-0 flex-1 truncate">Gig on the 25th</span>
            <span className="shrink-0 text-xs text-muted-foreground">4 songs</span>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="new">
            <span className="min-w-0 flex-1 truncate">New songs</span>
            <span className="shrink-0 text-xs text-muted-foreground">2 songs</span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <Plus />
          New set…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** One picked of several, marked with a check: the set picker's menu. */
export const Radio: Story = { render: () => <Chooser /> }
