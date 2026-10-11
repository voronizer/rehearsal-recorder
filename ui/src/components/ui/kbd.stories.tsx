import type { Meta, StoryObj } from "@storybook/react-vite"
import { Button } from "./button"
import { Kbd, KbdGroup } from "./kbd"
import { useSystem, words, type System } from "@/lib/platform"

const meta = {
  title: "UI/Kbd",
  component: Kbd,
  args: { children: "Space" },
} satisfies Meta<typeof Kbd>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** Several keys that go together. */
export const Group: Story = {
  render: () => (
    <KbdGroup>
      <Kbd>↑</Kbd>
      <Kbd>↓</Kbd>
    </KbdGroup>
  ),
}

/** In the colour of the text around it, so it reads on a filled button too. */
export const OnAButton: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-4">
      <Button size="footer" variant="strong" aria-keyshortcuts="Space">
        Stop
        <Kbd aria-hidden>Space</Kbd>
      </Button>
      <Button size="footer" variant="destructive" aria-keyshortcuts="Space">
        Record take
        <Kbd aria-hidden>Space</Kbd>
      </Button>
      <Button size="footer-aside" aria-keyshortcuts="Space">
        Save take
        <Kbd aria-hidden>Space</Kbd>
      </Button>
      <Button size="footer-aside" variant="outline" aria-keyshortcuts="Escape">
        Discard
        <Kbd aria-hidden>Esc</Kbd>
      </Button>
    </div>
  ),
}

/** On a muted line of text, as beside the lists. */
export const InText: Story = {
  render: () => (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Kbd>↑</Kbd>
      <Kbd>↓</Kbd>
      to go through them
    </p>
  ),
}

/** The modifier key follows the toolbar's System switch... */
function Following() {
  const { mod } = words(useSystem())
  return <Kbd>{`${mod} + wheel`}</Kbd>
}
export const FollowsTheToolbar: Story = { render: () => <Following /> }

/** ...and both systems, side by side. */
export const BothSystems: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {(["mac", "windows"] as System[]).map((s) => (
        <div key={s} className="flex items-center gap-3 text-sm">
          <span className="w-16 text-muted-foreground">{s}</span>
          <Kbd>{`${words(s).mod} + wheel`}</Kbd>
          <Kbd>{words(s).undoKey}</Kbd>
        </div>
      ))}
    </div>
  ),
}
