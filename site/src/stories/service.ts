// The band service's page, reha.stream/band-service, for a band member,
// and the pictures of the service it shows (service/pictures/ takes them,
// and writes their sizes). Its setup steps are in service/README.md.
import md from "../../content/band-service.md?raw"
import { parseBandService } from "../content/bandService"
import sizes from "./band-service/sizes.json"

export const bandService = parseBandService(md)

const files = import.meta.glob<string>("./band-service/*.webp", { eager: true, import: "default" })

export type Picture = { light: string; dark: string; width: number; height: number; on: "phone" | "computer" }

/** A picture's files in the built site, light and dark, its size as the page
 *  shows it, and whether it is of a phone or a computer. */
export function picture(name: string): Picture {
  const url = (theme: string) => {
    const file = files[`./band-service/${name}-${theme}.webp`]
    if (!file) throw new Error(`site/src/stories/band-service/${name}-${theme}.webp is not there: run npm run pictures in service/`)
    return file
  }
  const size = (sizes as Record<string, { width: number; height: number }>)[name]
  if (!size) throw new Error(`${name} has no size in site/src/stories/band-service/sizes.json: run npm run pictures in service/`)
  return { light: url("light"), dark: url("dark"), ...size, on: size.width > size.height ? "computer" : "phone" }
}
