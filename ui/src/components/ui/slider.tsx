import * as React from "react"
import { Slider as SliderPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/*
  A slider (C8), from shadcn's, on the theme: a thin grey track, the part
  set in the text's colour rather than the accent (F2: it is a setting, not
  what plays), and a round thumb in the text's colour that shows keyboard
  focus in the shared ring, as the faders' thumbs do (C6). The click's
  volume is its first use. `onValueCommit` is the value let go of, by the
  pointer or a key, for a setting that is saved and heard only then.
  Its name and its reading in words go on the thumb, which is what a
  screen reader reaches.

  Three variants draw the sliders that sit over something else:
  - `fader`: no track and no range, the thumb as the faders draw it, a
    round plate with a ring in the card's colour. It lies over a meter (R3).
  - `mark`: no track, and a thumb with no look of its own; the caller draws
    it with `thumbClassName` and `thumb` (R14).
  - `bar`: the player's bar, a thick track filled in the accent, the thumb
    shown only while the keyboard is on it (S5).
*/

type Variant = "default" | "fader" | "mark" | "bar"

const TRACK: Record<Variant, string | null> = {
  default:
    "relative grow overflow-hidden rounded-full bg-muted data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5",
  fader:
    "relative grow overflow-hidden bg-transparent data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full",
  mark: null,
  bar: "relative grow overflow-hidden rounded-full bg-muted data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full",
}

const RANGE: Record<Variant, string> = {
  default: "absolute bg-foreground/55 data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full",
  fader: "absolute bg-transparent data-[orientation=horizontal]:h-full",
  mark: "",
  bar: "absolute rounded-full bg-primary data-[orientation=horizontal]:h-full",
}

const THUMB: Record<Variant, string> = {
  default:
    "block size-3.5 shrink-0 rounded-full bg-foreground shadow-sm ring-ring/50 transition-[color,box-shadow] focus-visible:ring-[3px] focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50",
  fader:
    "block size-3.5 shrink-0 rounded-full bg-foreground ring-2 ring-card outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
  mark: "block shrink-0 outline-hidden disabled:pointer-events-none disabled:opacity-50",
  bar: "block size-3.5 shrink-0 rounded-full bg-primary opacity-0 shadow-sm outline-hidden focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none",
}
function Slider({
  variant = "default",
  thumbClassName,
  thumb,
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  "aria-label": label,
  "aria-labelledby": labelledBy,
  "aria-valuetext": valueText,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & {
  variant?: Variant
  /** Classes for each thumb, after the variant's. */
  thumbClassName?: string
  /** What is drawn inside each thumb: the caller's own look (variant "mark"). */
  thumb?: React.ReactNode
}) {
  const _values = React.useMemo(
    () =>
      Array.isArray(value)
        ? value
        : Array.isArray(defaultValue)
          ? defaultValue
          : [min, max],
    [value, defaultValue, min, max]
  )

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      data-variant={variant}
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        "relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col",
        className
      )}
      {...props}
    >
      {TRACK[variant] && (
        <SliderPrimitive.Track data-slot="slider-track" className={TRACK[variant]}>
          <SliderPrimitive.Range data-slot="slider-range" className={RANGE[variant]} />
        </SliderPrimitive.Track>
      )}
      {Array.from({ length: _values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          aria-label={label}
          aria-labelledby={labelledBy}
          aria-valuetext={valueText}
          className={cn(THUMB[variant], thumbClassName)}
        >
          {thumb}
        </SliderPrimitive.Thumb>
      ))}
    </SliderPrimitive.Root>
  )
}

export { Slider }
