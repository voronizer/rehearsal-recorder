// The band service's page, reha.stream/band-service: written like a story,
// for a band member. Its setup steps are in service/README.md.
import md from "../../content/band-service.md?raw"
import { parseStory } from "../content/stories"

export const bandService = parseStory("band-service.md", md, "site/content/")
