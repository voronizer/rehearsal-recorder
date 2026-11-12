import { TriangleAlert, X } from "lucide-react"
import { Alert } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  dismissBridgeErrors,
  keyOf,
  useBridgeErrors,
  useMoreBridgeErrors,
  whereTheRestIs,
} from "@/lib/bridgeErrors"

/**
 * Says so when a call into Python raised, over whatever screen is open.
 *
 * The screen that made the call still gets an answer and shows its own
 * error where it would anyway (see `api()`); this bar is for the rest — the
 * exception's own words, for a bug report, and where the full traceback is.
 * It stays until put away, because the reason it exists is that the last
 * two such failures were silent.
 *
 * Every problem said since it was last put away is in it, oldest first, up
 * to the first 20; the line under them counts the rest. One Dismiss puts them
 * all away. A long list scrolls inside the bar, which stops at about 40% of
 * the window, so the screen under it stays usable.
 *
 * It is the shared Alert, `destructive`, as a bar across the top of the
 * window: the icon, the problems and Dismiss in a row, the problems' own
 * words in the text colour.
 *
 * `aria-atomic="false"`: an alert is read whole by default, and this one
 * would read every earlier problem again with each new one. Only what was
 * added is spoken. The count line is `aria-live="off"`, so a rising count
 * is read with the bar, not announced on every change.
 */
export function ErrorBar() {
  const errors = useBridgeErrors()
  if (errors.length === 0) return null
  return (
    <Alert
      variant="destructive"
      aria-atomic="false"
      aria-label="Something went wrong"
      className="fixed inset-x-0 top-0 z-40 rounded-none border-x-0 border-t-0 px-6 has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr_auto]"
    >
      <TriangleAlert />
      <div className="min-w-0">
        <ul className="flex max-h-[40vh] flex-col gap-2 overflow-y-auto">
          {errors.map((error) => (
            <li key={keyOf(error)}>
              <p className="font-medium text-destructive">
                Something went wrong
                <span className="font-normal text-muted-foreground"> in {error.method}</span>
              </p>
              <p className="mt-0.5 font-mono text-xs break-words text-foreground">
                {error.name}: {error.message}
              </p>
            </li>
          ))}
        </ul>
        <WhereTheRestIs />
      </div>
      <Button
        variant="ghost"
        size="icon-row"
        aria-label="Dismiss"
        onClick={dismissBridgeErrors}
        className="col-start-3 row-start-1 text-foreground"
      >
        <X />
      </Button>
    </Alert>
  )
}

/**
 * Where the whole of each problem is written, and how many are not listed.
 * Its own component, so that a count that keeps going up draws this line
 * again and not the list.
 */
function WhereTheRestIs() {
  const more = useMoreBridgeErrors()
  return (
    <p aria-live="off" className="mt-1 text-xs text-muted-foreground">
      {whereTheRestIs(more)}
    </p>
  )
}
