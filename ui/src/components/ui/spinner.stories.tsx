import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { Button } from "./button"
import { Spinner } from "./spinner"

const meta = {
  title: "UI/Spinner",
  component: Spinner,
} satisfies Meta<typeof Spinner>

export default meta
type Story = StoryObj<typeof meta>

/** Shown at once here, so it can be seen. */
export const Default: Story = { args: { after: 0 } }

export const Large: Story = { args: { after: 0, className: "size-8" } }

/** In a button that is working: the icon takes the words’ line. */
export const InAButton: Story = {
  render: () => (
    <Button variant="outline" size="row" disabled>
      <Spinner after={0} />
      Looking
    </Button>
  ),
}

function Again() {
  const [round, setRound] = useState(0)
  return (
    <div className="flex items-center gap-4">
      <Button variant="outline" size="row" onClick={() => setRound(round + 1)}>
        Look again
      </Button>
      {/* A new key is a new spinner, counting its second from nothing. */}
      <Spinner key={round} />
    </div>
  )
}

/** The default is to wait: for the first second there is nothing to see, so
 *  an answer that comes at once does not flash one (B5). The spinner is there
 *  the whole time, invisible, so nothing moves when it shows (B4). */
export const AfterOneSecond: Story = { render: () => <Again /> }

/** Beside words that say what is happening, it is quiet: a screen reader
 *  hears the words alone. */
export const BesideWords: Story = {
  render: () => (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Spinner after={0} quiet />
      Reading the folder…
    </div>
  ),
}

/** Under Reduce motion, and while a take records, it stands still: an arc
 *  that still says “busy” (F11). */
export const Still: Story = {
  render: () => (
    <div className="flex items-center gap-4 text-sm text-muted-foreground">
      <Spinner after={0} className="animate-none" />
      the same arc, not turning
    </div>
  ),
}
