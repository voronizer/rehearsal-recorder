import type { SVGProps } from "react"

/**
 * The instrument icons lucide does not have — see lib/instruments. Drawn on
 * lucide's grid, 24 units with a stroke of 2 and round ends, so the set reads
 * as one; each takes an svg's props, as a lucide icon does.
 */

type Props = SVGProps<SVGSVGElement>

function Drawn(props: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  )
}

/** Drawn upright — neck up, body down — and laid the way lucide's guitar is. */
const LAID = "rotate(45 12 12)"

/** A solid body with two horns, the upper one longer. */
export function ElectricGuitar(props: Props) {
  return (
    <Drawn {...props}>
      <g transform={LAID}>
        <rect x="10.6" y="-1.6" width="2.8" height="4.6" rx="1" />
        <path d="M12 3v9" />
        <path d="M10.6 12.2C10 10.6 9 9.4 8.2 9.6 7.2 9.9 7.4 12 7.8 13.4 6.6 14.6 6.3 16.3 6.8 18.2 7.6 21.2 10 22.4 12 22.4 14.2 22.4 16.6 21 17.2 18.2 17.6 16.2 17 14.8 16 14 16.4 12.4 16.6 10.6 15.8 10.2 15 9.8 14 11 13.4 12.2" />
        <path d="M10.4 18.2h3.2" />
      </g>
    </Drawn>
  )
}

/** The guitar's body made smaller, so the neck runs longer, and the tuners
 *  down one side of the head. */
export function Bass(props: Props) {
  return (
    <Drawn {...props}>
      <g transform={LAID}>
        <rect x="10.6" y="-1.6" width="2.8" height="5" rx="1" />
        <path d="M10.6 -.4H9.4m1.2 1.8H9.4m1.2 1.8H9.4" />
        <path d="M12 3.4v10.6" />
        <path d="M10.96 14.85C10.52 13.67 9.78 12.78 9.19 12.93 8.45 13.15 8.6 14.7 8.89 15.74 8 16.63 7.78 17.89 8.15 19.29 8.74 21.51 10.52 22.4 12 22.4 13.63 22.4 15.4 21.36 15.85 19.29 16.14 17.81 15.7 16.78 14.96 16.18 15.26 15 15.4 13.67 14.81 13.37 14.22 13.08 13.48 13.96 13.04 14.85" />
        <path d="M10.8 19.4h2.4" />
      </g>
    </Drawn>
  )
}

/** A pair of maracas, heads up and handles apart: crossed, they read as
 *  scissors. */
export function Maracas(props: Props) {
  return (
    <Drawn {...props}>
      <path
        d="M8 13.6c-2.6 0-4.6-2.4-4.6-5.3S5.4 3 8 3s4.6 2.4 4.6 5.3-2 5.3-4.6 5.3z"
        transform="rotate(-18 8 8.3)"
      />
      <path d="m9.3 13.3 1.9 7.7" />
      <path
        d="M17 15.6c-2.3 0-4-2.1-4-4.7s1.7-4.7 4-4.7 4 2.1 4 4.7-1.7 4.7-4 4.7z"
        transform="rotate(16 17 10.9)"
      />
      <path d="m16.1 15.6-.9 5.4" />
    </Drawn>
  )
}

/** Mouthpiece top left, the tube down, round the bottom and up into the
 *  bell, and three keys. */
export function Saxophone(props: Props) {
  return (
    <Drawn {...props}>
      <path d="M5 3.5c2.6-.8 4.4 0 4.6 2.5" />
      <path d="M8.6 6v10.5a4.4 4.4 0 0 0 8.8 0V13l2.1-2.5" />
      <path d="M11.6 6v10.5a1.4 1.4 0 0 0 2.8 0V13l-1.6-2.5" />
      <path d="M12.8 10.5h6.7" />
      <circle cx="10.1" cy="9" r=".4" />
      <circle cx="10.1" cy="12" r=".4" />
      <circle cx="10.1" cy="15" r=".4" />
    </Drawn>
  )
}

/** Scroll, fingerboard down to the bridge, the waisted body and its
 *  f-holes; the bow standing beside it. */
export function Violin(props: Props) {
  return (
    <Drawn {...props}>
      <circle cx="9.6" cy="2.9" r="1.4" />
      <path d="M9.6 4.3v11.2" />
      <path d="M7.6 17.5h4" />
      <path d="M8.6 8.8c-2.3.2-3.4 1.4-3.4 3 0 1.3 1.1 1.8 1.1 2.8 0 1-1.6 1.6-1.6 3.4 0 2.4 2.2 3.5 4.9 3.5s4.9-1.1 4.9-3.5c0-1.8-1.6-2.4-1.6-3.4 0-1 1.1-1.5 1.1-2.8 0-1.6-1.1-2.8-3.4-3" />
      <path d="M7 14.8v1.4m5.2-1.4v1.4" />
      <path d="m20 2.5-3 19" />
      <path d="M16.2 21.2h1.8" />
    </Drawn>
  )
}
