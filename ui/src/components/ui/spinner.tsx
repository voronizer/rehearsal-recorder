import * as React from "react"
import { Loader2Icon } from "lucide-react"

import { useAfter } from "@/hooks/useAfter"
import { SPINNER_AFTER_MS } from "@/lib/playLook"
import { cn } from "@/lib/utils"

/*
  Loading (B5): under a second nothing shows, so an answer that comes at once
  does not flash a spinner; from the second on, it turns. It is on the page
  the whole time, invisible until then, so it keeps its room and nothing
  moves when it shows (B4). It turns by `animate-spin`, which index.css stops
  under Reduce motion and while a take records: the arc still says "busy".

  A spinner is counted from when it appears, so a new one (a new `key`) counts
  its second afresh.

  It is a status called "Loading". `quiet` takes that away where words beside
  it already say what is happening ("Reading the folder…"): a screen reader
  hears the words, and no second voice over them.
*/
function Spinner({
  after = SPINNER_AFTER_MS,
  quiet = false,
  className,
  ...props
}: Omit<React.ComponentProps<"svg">, "children"> & {
  /** How long to stay invisible, in ms. */
  after?: number
  /** Not read out: the words beside it say what is happening. */
  quiet?: boolean
}) {
  const late = useAfter(true, after)

  return (
    <Loader2Icon
      {...(quiet ? { "aria-hidden": true } : { role: "status", "aria-label": "Loading" })}
      className={cn("size-4 animate-spin", !late && "invisible", className)}
      {...props}
    />
  )
}

export { Spinner }
