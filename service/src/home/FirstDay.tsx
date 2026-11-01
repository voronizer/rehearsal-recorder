import { Link } from "@tanstack/react-router"
import { Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { FirstSteps } from "../api"
import { Group, Page, Rows, Tile } from "../shell/parts"

/** The owner's four steps, each with what it is for and the button that takes him there. */
const STEPS: [keyof FirstSteps, string, string, string?][] = [
  ["named", "Name the band", "Its name and picture show at the top and when someone signs in.", "The band's name"],
  ["key", "Make a key for РЭХА", "РЭХА sends takes here with it. Paste it into РЭХА on the computer that records.", "Make a key"],
  ["members", "Add the band", "Type each member's email address. Cloudflare sends them a letter to confirm it.", "Add members"],
  ["rehearsal", "Record a rehearsal", "Takes, stars and marks appear here once РЭХА has sent them."],
]

/** Home before the band has a take: the owner's first steps, or one line for a member. */
export function FirstDay({ steps }: { steps: FirstSteps | null }) {
  return (
    <Page title="Home" sub="No takes yet. They come here from РЭХА after a rehearsal.">
      {steps ? (
        <Group title="Before the first rehearsal">
          <Rows>
            {STEPS.map(([key, title, text, button]) => {
              const done = steps[key]
              return (
                <div key={key} data-step={key} data-done={done} className="flex items-start gap-3">
                  <span
                    className={cn(
                      "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
                      done && "border-signal bg-signal text-white"
                    )}
                  >
                    {done && <Check className="size-3.5" />}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className={cn("font-semibold", done && "text-muted-foreground line-through")}>{title}</span>
                    <span className="text-muted-foreground">{text}</span>
                  </div>
                  {button && !done && (
                    <Button asChild variant="outline" size="row">
                      <Link to="/members">{button}</Link>
                    </Button>
                  )}
                </div>
              )
            })}
          </Rows>
        </Group>
      ) : (
        <Tile>
          <p>After the next rehearsal its takes appear here, with what the band starred and marked.</p>
        </Tile>
      )}
    </Page>
  )
}
