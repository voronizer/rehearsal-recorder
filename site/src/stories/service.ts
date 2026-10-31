// The band service's page, reha.stream/band-service, for a band member,
// and the pictures of the service it shows (service/pictures/ takes them).
// Its setup steps are in service/README.md.
import md from "../../content/band-service.md?raw"
import { parseBandService } from "../content/bandService"

export const bandService = parseBandService(md)

const files = import.meta.glob<string>("./band-service/*.webp", { eager: true, import: "default" })

/** A picture's address in the built site, in the light or in the dark. */
export function pictureUrl(name: string, theme: "light" | "dark"): string {
  const url = files[`./band-service/${name}-${theme}.webp`]
  if (!url) throw new Error(`site/src/stories/band-service/${name}-${theme}.webp is not there: run npm run pictures in service/`)
  return url
}
