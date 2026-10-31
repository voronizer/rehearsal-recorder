// The band service's page, reha.stream/band-service: written like a story,
// with numbered steps, which a story has none of.
import md from "../../content/band-service.md?raw"
import { parseStory } from "../content/stories"

export const bandService = parseStory("band-service.md", md, { steps: true, dir: "site/content/" })
