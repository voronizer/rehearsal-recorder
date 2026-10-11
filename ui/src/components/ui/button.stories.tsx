import type { Meta, StoryObj } from "@storybook/react-vite"
import { Circle, PlayIcon, Square } from "lucide-react"
import { Button } from "./button"
import { Kbd } from "./kbd"

const meta = {
  title: "UI/Button",
  component: Button,
  args: { children: "Button" },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

const VARIANTS = ["default", "strong", "destructive", "outline", "ghost", "link"] as const
const SIZES = ["default", "row", "footer", "footer-aside"] as const
const ICON_SIZES = ["icon", "icon-row", "icon-tiny", "player"] as const

/** The one main action, in the accent. */
export const Default: Story = {}
/** The text's own colour: Stop is neutral, not blue (F2). */
export const Strong: Story = { args: { variant: "strong" } }
/** Full colour in both themes: red is for what cannot be brought back. */
export const Destructive: Story = { args: { variant: "destructive" } }
export const Outline: Story = { args: { variant: "outline" } }
export const Ghost: Story = { args: { variant: "ghost" } }
/** The text's colour with a thin underline and one hover. */
export const Link: Story = { args: { variant: "link" } }

/** Every variant switched off. */
export const Disabled: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-4">
      {VARIANTS.map((variant) => (
        <Button key={variant} {...args} variant={variant} disabled>
          {variant}
        </Button>
      ))}
    </div>
  ),
}

export const WithIcon: Story = {
  args: {
    children: (
      <>
        <PlayIcon /> Play
      </>
    ),
  },
}

/** The key that presses the button, drawn on it: on a filled button, on the
 *  strong one that Stop is, on a red Record and on a plain one. */
export const WithKbd: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-4">
      <Button {...args} size="footer" variant="strong" aria-keyshortcuts="Space">
        <Square className="fill-current" />
        Stop
        <Kbd aria-hidden>Space</Kbd>
      </Button>
      <Button {...args} size="footer" variant="destructive" aria-keyshortcuts="Space">
        <Circle className="fill-current" />
        Record take 3
        <Kbd aria-hidden>Space</Kbd>
      </Button>
      <Button {...args} size="footer-aside" variant="default" aria-keyshortcuts="Space">
        Save take
        <Kbd aria-hidden>Space</Kbd>
      </Button>
      <Button {...args} size="footer-aside" variant="outline" aria-keyshortcuts="Escape">
        Discard
        <Kbd aria-hidden>Esc</Kbd>
      </Button>
      <Button {...args} size="row" variant="ghost" aria-keyshortcuts="Escape">
        Back
        <Kbd aria-hidden>Esc</Kbd>
      </Button>
    </div>
  ),
}

/** Every size, side by side. */
export const Sizes: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-4">
      {SIZES.map((size) => (
        <Button key={size} {...args} size={size}>
          {size}
        </Button>
      ))}
      {ICON_SIZES.map((size) => (
        <Button key={size} {...args} size={size} aria-label={size}>
          <PlayIcon />
        </Button>
      ))}
      <Button {...args} size="lane" aria-label="Mute">
        M
      </Button>
    </div>
  ),
}

/** Every variant at every size. Rows are variants, columns are sizes; the
 *  icon sizes and the lane's M and S are on the right. */
export const Matrix: Story = {
  parameters: { layout: "padded" },
  render: (args) => (
    <div className="flex flex-col gap-4">
      {VARIANTS.map((variant) => (
        <div key={variant} className="flex flex-wrap items-center gap-4">
          {SIZES.map((size) => (
            <Button key={size} {...args} variant={variant} size={size}>
              {variant} {size}
            </Button>
          ))}
          {ICON_SIZES.map((size) => (
            <Button key={size} {...args} variant={variant} size={size} aria-label={size}>
              <PlayIcon />
            </Button>
          ))}
          <Button {...args} variant={variant} size="lane" aria-label="Solo">
            S
          </Button>
        </div>
      ))}
    </div>
  ),
}
