// Alex's stories, whole, as their pages and the tests read them. The main
// page's block takes only its part of them, through virtual:stories-block
// (vite.config.ts), so the main page does not carry every story.
import index from "../../content/stories.md?raw"
import { readStories, type StoriesContent } from "../content/stories"

const files = import.meta.glob<string>("../../content/stories/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
})

export const stories: StoriesContent = readStories(
  Object.fromEntries(Object.entries(files).map(([path, text]) => [path.slice(path.lastIndexOf("/") + 1), text])),
  index
)
