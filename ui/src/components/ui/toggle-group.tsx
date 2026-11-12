import * as React from "react"
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui"

import { toggleVariants } from "@/components/ui/toggle"
import { cn } from "@/lib/utils"

/*
  Pick one, or several (C8), with the arrow keys moving along the group and
  Tab leaving it. `default` and `outline` are Toggles joined into a bar, on
  as the grey fill.

  `switch` is History's switch: a grey track with the chosen item a plate on
  it, with a light shadow. The plate is one of the two looks of "selected"
  (C8), the one inside a switch; the grey fill is the other, for a row, a
  pill or a toggle that is on. A screen gives the switch the width it needs
  with `className`, on the group and on its items; `size` does nothing for
  it. The items hold one weight, so choosing another changes no width.

  `type="single"` is Radix's, and can be emptied: pressing the chosen item
  again sends `onValueChange("")`. A pick-one that must always have one
  chosen ignores the "", as ModeSwitch does.

  `rovingFocus={false}` is Radix's, passed through: a grid that moves between
  its items with its own arrow keys (R5, S15) keeps every item in the Tab order
  and leaves the arrows to itself.
*/

type Variant = "default" | "outline" | "switch"
type Size = "row" | "icon-row"

const ToggleGroupContext = React.createContext<{ variant: Variant; size: Size }>({
  variant: "default",
  size: "row",
})

function ToggleGroup({
  className,
  variant = "default",
  size = "row",
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> & {
  variant?: Variant
  size?: Size
}) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      className={cn(
        "group/toggle-group flex w-fit items-center",
        variant === "switch" ? "gap-1 rounded-lg bg-muted p-1" : "rounded-md",
        className
      )}
      {...props}
    >
      <ToggleGroupContext.Provider value={{ variant, size }}>
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive.Root>
  )
}

function ToggleGroupItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  const { variant, size } = React.useContext(ToggleGroupContext)

  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      data-variant={variant}
      data-size={size}
      className={cn(
        variant === "switch"
          ? "flex-1 rounded-md px-2 py-1 text-sm font-normal whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
          : cn(
              toggleVariants({ variant, size }),
              "min-w-0 rounded-none shadow-none first:rounded-l-md last:rounded-r-md focus:z-10 focus-visible:z-10 data-[variant=outline]:border-l-0 data-[variant=outline]:first:border-l"
            ),
        className
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  )
}

export { ToggleGroup, ToggleGroupItem }
