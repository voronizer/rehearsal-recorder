import type { Meta, StoryObj } from "@storybook/react-vite"
import { CircleAlert, Info, TriangleAlert } from "lucide-react"
import { Alert, AlertDescription, AlertTitle, Warning as WarningNote } from "./alert"
import { WholeTip, useCut } from "./whole"

const meta = {
  title: "UI/Alert",
  component: Alert,
  decorators: [
    (Story) => (
      <div className="w-96 max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Alert>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <Alert {...args}>
      <Info />
      <AlertTitle>The check is off</AlertTitle>
      <AlertDescription>Press Check signal to see each input’s level.</AlertDescription>
    </Alert>
  ),
}

/** What is true but not as it should be: the theme’s warning colour on the
 *  icon and the edge, and a faint wash. */
export const Warning: Story = {
  render: (args) => (
    <Alert {...args} variant="warning">
      <TriangleAlert />
      <AlertTitle>No input picked</AlertTitle>
      <AlertDescription>Pick the input this track plugs into, or set it to MIDI.</AlertDescription>
    </Alert>
  ),
}

/** `Warning`: the warning over a list that stays for as long as it holds, as
 *  the start screen’s tracks and the unsaved takes say theirs. The triangle
 *  and one paragraph, announced as a status; the words take what room they
 *  need. */
export const Note: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <WarningNote>Nothing is coming in on “Guitar”. Pick one below.</WarningNote>
      <WarningNote>
        Recover a take to add it to its rehearsal. The app closed while these takes were
        recording, so they were never saved. The audio is intact.
      </WarningNote>
    </div>
  ),
}

export const Destructive: Story = {
  render: (args) => (
    <Alert {...args} variant="destructive">
      <CircleAlert />
      <AlertTitle>Could not start</AlertTitle>
      <AlertDescription>The audio device is in use by another app.</AlertDescription>
    </Alert>
  ),
}

/** The words alone, as the start screen's notes about a track: no icon, no
 *  title. */
export const WordsOnly: Story = {
  render: (args) => (
    <div className="flex flex-col gap-3">
      <Alert {...args} variant="warning">
        <AlertDescription>Not connected. Records its notes from the moment it is plugged in.</AlertDescription>
      </Alert>
      <Alert {...args}>
        <AlertDescription>Same notes as Keys. Plugged in twice?</AlertDescription>
      </Alert>
    </div>
  ),
}

/** The icon and one line of title. */
export const TitleOnly: Story = {
  render: (args) => (
    <Alert {...args} variant="warning">
      <TriangleAlert />
      <AlertTitle>Nothing is coming in</AlertTitle>
    </Alert>
  ),
}

/** Long words wrap under the title, and the icon keeps its place. */
export const Long: Story = {
  render: (args) => (
    <Alert {...args} variant="warning">
      <TriangleAlert />
      <AlertTitle>In use by another app</AlertTitle>
      <AlertDescription>
        <p>
          Records its notes from the moment it is free. Close the other app, or pick another port
          for this track, and the notes start coming in at once.
        </p>
      </AlertDescription>
    </Alert>
  ),
}

/** The line size, for a place that keeps one line for what it has to say
 *  (the player’s): no box and no wash, the icon in the variant’s colour,
 *  24 px tall whatever it says. */
export const Line: Story = {
  render: (args) => (
    <div className="flex flex-col">
      <Alert {...args} size="line" variant="warning">
        <TriangleAlert />
        <AlertDescription>That playback device is gone, so the take plays through the system output.</AlertDescription>
      </Alert>
      <Alert {...args} size="line" variant="destructive">
        <CircleAlert />
        <AlertDescription>Track file not found</AlertDescription>
      </Alert>
      <Alert {...args} size="line">
        <Info />
        <AlertDescription>Press Check signal to see each input’s level.</AlertDescription>
      </Alert>
    </div>
  ),
}

const CUT_WORDS =
  "Playback stopped: nothing has gone out through “Interface” for 3 seconds. It was " +
  "unplugged, switched off or stopped answering. Press play to try it again."

function CutLine(args: React.ComponentProps<typeof Alert>) {
  const [ref, cut] = useCut<HTMLSpanElement>()
  return (
    <Alert {...args} size="line" variant="warning">
      <TriangleAlert />
      <AlertDescription>
        <WholeTip cut={cut} text={CUT_WORDS}>
          <span ref={ref} className="block truncate">
            {CUT_WORDS}
          </span>
        </WholeTip>
      </AlertDescription>
    </Alert>
  )
}

/** Past its room a line is cut with an ellipsis, and shows whole on hover
 *  through the shared WholeTip, which its place puts round the words inside
 *  the description. */
export const LineCut: Story = {
  render: (args) => <CutLine {...args} />,
}
