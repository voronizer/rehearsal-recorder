import { cn } from "@/lib/utils"

/**
 * The dot that says a newer version is out, on each step of the way to where
 * it is said in words: the gear on the setup screen, then Under the hood in
 * Settings. It stays until the new version is running — whoever would rather
 * not update can live with a dot. Its words are the button's own name.
 */
export function NewDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-new-version
      className={cn(
        "size-2 shrink-0 rounded-full bg-primary ring-2 ring-background",
        className ?? "absolute top-1.5 right-1.5"
      )}
    />
  )
}
