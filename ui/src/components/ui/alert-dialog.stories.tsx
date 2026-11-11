import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { Button } from "./button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./alert-dialog"

const meta = {
  title: "UI/AlertDialog",
  component: AlertDialog,
} satisfies Meta<typeof AlertDialog>

export default meta
type Story = StoryObj<typeof meta>

function Question() {
  const [open, setOpen] = useState(true)
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Ask again
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this take?</AlertDialogTitle>
            <AlertDialogDescription>It goes to the Trash, and Undo brings it back.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex justify-end gap-3">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** A question that needs an answer: a click outside does not close it. */
export const Default: Story = { render: () => <Question /> }
