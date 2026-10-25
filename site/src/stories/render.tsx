// The stories' pages as HTML, for the stories() plugin in vite.config.ts,
// which bundles this file for Node and writes each page into stories.html.
// The words are in the HTML, so a crawler that runs no script reads them all.
import { renderToStaticMarkup } from "react-dom/server"
import { articleJsonLd, pageUrl, type PageMeta } from "../content/seo"
import { stories } from "./content"
import { StoriesPage } from "./StoriesPage"
import { StoryPage } from "./StoryPage"

/** The page of stories, then each story, in order. */
export function storyPages(): { meta: PageMeta; body: string }[] {
  return [
    {
      meta: {
        path: "/stories",
        title: "Stories · РЭХА",
        description: stories.description,
        kind: "website",
        jsonLd: null,
      },
      body: renderToStaticMarkup(<StoriesPage stories={stories} />),
    },
    ...stories.list.map((story) => {
      const path = `/stories/${story.slug}`
      return {
        meta: {
          path,
          title: `${story.title} · РЭХА`,
          description: story.description,
          kind: "article" as const,
          jsonLd: articleJsonLd({ ...story, url: pageUrl(path) }),
        },
        body: renderToStaticMarkup(<StoryPage story={story} stories={stories} />),
      }
    }),
  ]
}
