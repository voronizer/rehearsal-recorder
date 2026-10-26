import type { Meta, StoryObj } from "@storybook/react-vite"
import { useEffect, type ReactNode } from "react"
import { Button } from "./button"
import { Card, CardDescription, CardHeader, CardTitle } from "./card"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./sheet"
import { Notices } from "@/components/Notices"
import { notify } from "@/lib/notices"

const meta = {
  title: "UI/Sheet",
  component: Sheet,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Sheet>

export default meta
type Story = StoryObj<typeof meta>

/** A sheet already open, with its button to open it again after Esc, the ✕
 *  or a click on the veil: focus goes back to that button. */
function Open({
  side,
  children,
}: {
  side?: "left" | "right"
  children: ReactNode
}) {
  return (
    <Sheet defaultOpen>
      <SheetTrigger asChild>
        <Button variant="outline" className="m-4">
          Last time
        </Button>
      </SheetTrigger>
      <SheetContent side={side}>{children}</SheetContent>
    </Sheet>
  )
}

function Songs({ n }: { n: number }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-8 pt-1 pb-8">
      <Card>
        <CardHeader>
          <CardTitle>Last time · Tue 22 Sep, 2 weeks ago</CardTitle>
          <CardDescription>5 songs, 1 h 12 min</CardDescription>
        </CardHeader>
        {Array.from({ length: n }, (_, i) => (
          <div key={i} className="text-sm">
            Song {i + 1}
          </div>
        ))}
      </Card>
    </div>
  )
}

/** From the left, as the start screen's Last time does: 28 rem, and at most
 *  the window less 3 rem. Esc, the ✕ and the veil close it. The title and
 *  the description are for a screen reader. */
export const FromTheLeft: Story = {
  render: () => (
    <Open side="left">
      <SheetTitle className="sr-only">Last time</SheetTitle>
      <SheetDescription className="sr-only">
        The last rehearsal song by song, and earlier ones.
      </SheetDescription>
      <Songs n={4} />
    </Open>
  ),
}

export const FromTheRight: Story = {
  render: () => (
    <Open side="right">
      <SheetTitle className="sr-only">Last time</SheetTitle>
      <SheetDescription className="sr-only">
        The last rehearsal song by song, and earlier ones.
      </SheetDescription>
      <Songs n={4} />
    </Open>
  ),
}

/** A title that shows, in a header under the ✕. */
export const WithAHeader: Story = {
  render: () => (
    <Open side="left">
      <SheetHeader>
        <SheetTitle>Last time</SheetTitle>
        <SheetDescription>
          The last rehearsal song by song, and earlier ones.
        </SheetDescription>
      </SheetHeader>
      <Songs n={4} />
    </Open>
  ),
}

/** Longer than the window: the content scrolls inside, and the ✕ stays. */
export const Scrolls: Story = {
  render: () => (
    <Open side="left">
      <SheetTitle className="sr-only">Last time</SheetTitle>
      <SheetDescription className="sr-only">
        The last rehearsal song by song, and earlier ones.
      </SheetDescription>
      <Songs n={60} />
    </Open>
  ),
}

function WithNotice() {
  useEffect(() => {
    notify({
      key: "story",
      kind: "done",
      text: "“Pałyn 5” went to the Trash.",
      action: { label: "Undo", run: () => {} },
    })
  }, [])
  return (
    <>
      <Notices />
      <Open side="left">
        <SheetTitle className="sr-only">Last time</SheetTitle>
        <SheetDescription className="sr-only">
          The last rehearsal song by song, and earlier ones.
        </SheetDescription>
        <Songs n={4} />
      </Open>
    </>
  )
}

/** A notice stands above the veil (C4), and a click on its Undo is not a
 *  click outside: the sheet stays. It goes after 10 s; reload to see it again. */
export const NoticeAboveTheVeil: Story = { render: () => <WithNotice /> }
