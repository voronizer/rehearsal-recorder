import { CalendarDays, Diamond, House, ListMusic, Music, Trash2, Users, type LucideIcon } from "lucide-react"

export type SectionTo = "/" | "/rehearsals" | "/songs" | "/sets" | "/marks" | "/members" | "/trash"

/** The band's sections in the column on the left, each with its icon; a pill to a song or a rehearsal has the same one. */
export const SECTIONS: [SectionTo, string, LucideIcon][] = [
  ["/", "Home", House],
  ["/rehearsals", "Rehearsals", CalendarDays],
  ["/songs", "Songs", Music],
  ["/sets", "Sets", ListMusic],
  ["/marks", "Marks", Diamond],
  ["/members", "Members", Users],
  ["/trash", "Trash", Trash2],
]

/** A section's icon, by its address. */
export const sectionIcon = (to: SectionTo): LucideIcon => SECTIONS.find(([t]) => t === to)![2]

/**
 * A section in the column (shell/Side.tsx), on the Sidebar's menu button,
 * drawn as the ghost Button it was: 36 px high, its icon 13 px in, the
 * Button's ring under the keyboard. Folded, a 36 px square with the icon in
 * its middle. Lit, `ITEM_CHOSEN` (`@/components/ui/item`) under the
 * Sidebar's `data-active`, at the regular weight: Tailwind finds a class
 * only as written, so its classes are written out here, and
 * sections.test.ts keeps them the same.
 */
export const SECTION =
  "h-9 gap-3 border border-transparent px-3 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:hover:bg-accent/50 " +
  "group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:p-[9px]! " +
  "data-[active=true]:font-normal data-[active=true]:bg-selected data-[active=true]:hover:bg-selected dark:data-[active=true]:bg-selected dark:data-[active=true]:hover:bg-selected"
