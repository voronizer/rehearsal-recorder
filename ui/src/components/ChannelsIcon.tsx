import type { SVGProps } from "react"
import { Mono, Stereo } from "@/components/DrawnIcons"

/** One ring for one channel, two for a stereo pair (Alex, 2026-11-04): the
 *  Stereo toggle on the start screen, a backing track's plate in the
 *  player, and its file on the song page say it so, instead of in words. */
export function ChannelsIcon({ stereo, ...props }: { stereo: boolean } & SVGProps<SVGSVGElement>) {
  return stereo ? <Stereo {...props} /> : <Mono {...props} />
}
