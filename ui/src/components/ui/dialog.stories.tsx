import type { Meta, StoryObj } from "@storybook/react-vite"
import { Trash2 } from "lucide-react"
import type { ReactNode } from "react"
import { Button } from "./button"
import {
  Dialog,
  DialogButtons,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog"
import { Input } from "./input"
import { Kbd } from "./kbd"
import type { System } from "@/lib/platform"

const meta = {
  title: "UI/Dialog",
  component: Dialog,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Dialog>

export default meta
type Story = StoryObj<typeof meta>

/** A dialog already open, with its button to open it again after Esc. The
 *  buttons stand in the order of the toolbar's System switch. */
function Open({ children }: { children: ReactNode }) {
  return (
    <Dialog defaultOpen>
      <DialogTrigger asChild>
        <Button variant="outline" className="m-4">
          Open the dialog
        </Button>
      </DialogTrigger>
      {children}
    </Dialog>
  )
}

/** A field has the keyboard, so Enter is the field's and presses the action. */
export const WithAField: Story = {
  render: () => (
    <Open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename rehearsal</DialogTitle>
          <DialogDescription>The folder keeps its date and gets the new name.</DialogDescription>
        </DialogHeader>
        <Input autoFocus defaultValue="Tuesday jam" />
        <DialogButtons action={<Button>Rename</Button>} />
      </DialogContent>
    </Open>
  ),
}

/** Nothing to type, and nothing lost by answering: it opens on the action,
 *  so Enter presses it. */
export const EnterPressesTheAction: Story = {
  render: () => (
    <Open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send the starred takes?</DialogTitle>
          <DialogDescription>
            Three takes are copied into your cloud folder. They stay here too.
          </DialogDescription>
        </DialogHeader>
        <DialogButtons action={<Button>Send</Button>} />
      </DialogContent>
    </Open>
  ),
}

/** What cannot be undone opens on Cancel, so a stray Enter changes nothing.
 *  Red only for what cannot be brought back. */
export const Irreversible: Story = {
  render: () => (
    <Open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove “Tuesday jam” from history?</DialogTitle>
          <DialogDescription>
            Only the entry goes — there is nothing on disk to delete.
          </DialogDescription>
        </DialogHeader>
        <DialogButtons irreversible action={<Button variant="destructive">Remove</Button>} />
      </DialogContent>
    </Open>
  ),
}

/** Not red: it cannot be taken back, but nothing is lost. */
export const IrreversibleNotRed: Story = {
  render: () => (
    <Open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Finish this rehearsal?</DialogTitle>
          <DialogDescription>
            2 takes are saved and stay where they are. You cannot add to this rehearsal afterwards
            — a later one starts its own folder.
          </DialogDescription>
        </DialogHeader>
        <DialogButtons irreversible action={<Button>Finish</Button>} />
      </DialogContent>
    </Open>
  ),
}

/** What is done to the thing itself stands apart, at the far left. */
export const WithAnAside: Story = {
  render: () => (
    <Open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Marker at 1:24</DialogTitle>
          <DialogDescription>
            A word about this spot, so next week it still means something.
          </DialogDescription>
        </DialogHeader>
        <Input autoFocus placeholder="Guitar drifts, second chorus" />
        <DialogButtons
          aside={
            <Button
              variant="ghost"
              size="row"
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 />
              Delete marker
            </Button>
          }
          action={<Button>Save</Button>}
        />
      </DialogContent>
    </Open>
  ),
}

/** Options that act at once: no action, and the one button is Close. */
export const OnlyClose: Story = {
  render: () => (
    <Open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy “Pałyn 1” to the cloud</DialogTitle>
          <DialogDescription>
            The files are copied into your cloud folder — whatever client watches it does the
            uploading.
          </DialogDescription>
        </DialogHeader>
        <DialogButtons cancel="Close" />
      </DialogContent>
    </Open>
  ),
}

/** A list of keys needs less room and no buttons: Esc closes it. */
export const Narrow: Story = {
  render: () => (
    <Open>
      <DialogContent size="narrow">
        <DialogHeader>
          <DialogTitle>Keys in the player</DialogTitle>
          <DialogDescription>Not while typing a name.</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2.5 text-sm">
          <dt><Kbd>Space</Kbd></dt>
          <dd>Play / pause</dd>
          <dt className="flex gap-1"><Kbd>←</Kbd><Kbd>→</Kbd></dt>
          <dd>10 seconds back / forward</dd>
          <dt><Kbd>M</Kbd></dt>
          <dd>Mark this spot</dd>
        </dl>
      </DialogContent>
    </Open>
  ),
}

/** Hung from near the top and growing down, so what is above its end does
 *  not move as the content comes in. Long content scrolls inside. */
export const Tall: Story = {
  render: () => (
    <Open>
      <DialogContent size="tall" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>New set</DialogTitle>
        </DialogHeader>
        <div className="-mx-6 flex min-h-0 flex-col gap-2 overflow-y-auto px-6 pb-1">
          <Input autoFocus placeholder="Gig on the 25th" />
          {Array.from({ length: 24 }, (_, i) => (
            <div key={i} className="rounded-md border px-3 py-2 text-sm">
              Song {i + 1}
            </div>
          ))}
        </div>
        <DialogButtons action={<Button>Create set</Button>} />
      </DialogContent>
    </Open>
  ),
}

/** The buttons in the order of each system, side by side: the Mac's action is
 *  rightmost, Windows' comes first. The focus mark (Enter) is on the action,
 *  or on Cancel where nothing can be undone. */
export const BothSystems: Story = {
  parameters: { layout: "padded" },
  render: () => (
    <div className="flex flex-col gap-4">
      {(["mac", "windows"] as System[]).map((s) => (
        <div key={s} className="flex flex-col gap-2">
          <span className="text-sm text-muted-foreground">{s}</span>
          {/* The Dialog root only gives Cancel its Close: no window is open. */}
          <Dialog>
            <div className="w-md max-w-full rounded-xl border bg-card p-6">
              <DialogButtons system={s} action={<Button>Rename</Button>} />
            </div>
            <div className="w-md max-w-full rounded-xl border bg-card p-6">
              <DialogButtons
                system={s}
                irreversible
                aside={
                  <Button variant="ghost" size="row" className="text-muted-foreground">
                    <Trash2 />
                    Delete marker
                  </Button>
                }
                action={<Button variant="destructive">Delete</Button>}
              />
            </div>
          </Dialog>
        </div>
      ))}
    </div>
  ),
}
