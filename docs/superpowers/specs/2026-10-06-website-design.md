# The website: reha.stream

**Status:** design approved by Alex on 2026-10-06 from the preview at
<https://claude.ai/artifact/5TcydAK3GtgECuiZsQXfMB>; this spec is waiting
for review.

Rehearsal Recorder has no page of its own. Someone who hears about it lands
on the GitHub README, which is written for people who already use it.

This adds a landing page at **reha.stream**: one page, in English, that
says what the app is for, lets you try it in the browser, and gets you the
download. It is built from the app's own code and data, so it shows what
the app looks like now, and it is published when a release is.

## What Alex decided

- **D1. A landing page,** not documentation and not a web version of the
  app. The guide stays in `docs/using-it.md`.
- **D2. English,** like the README, the guide and the app.
- **D3. Light and quiet, "like apple.com".** A white page, headings
  centred, one idea to a screen, a sentence where a paragraph would do, no
  frames around everything. The app inside it is in its own light theme.
- **D4. The pictures are the app.** No drawings of it and no screenshots
  taken by hand: the page shows the app's own components, fed by the fake
  Python side that the interface's tests already use.
- **D5. Published on release.** The site is built and deployed by GitHub
  Actions when a release is out, so it always shows the version people
  download. A pull request builds the site and runs its test, so a change
  to the interface that breaks it shows up before a release, not on the
  day of one, and (added 2026-10-07) puts the build on Vercel as a preview
  to look at before merging; reha.stream itself still changes only with a
  release.
- **D6. Content follows the repo.** The version and its news come from the
  release and `CHANGELOG.md`; everything else on the page is Markdown in
  `site/content/`, changed in the same pull request as the app.
- **D7. Off-screen means still.** A live piece of the app only runs while
  it is on screen.

## The page, top to bottom

1. **What's new, one line** above the menu: *New in 0.9.0.* and the
   bold lead of the first item in that version's `CHANGELOG.md` section,
   with *Release notes ›* to the release on GitHub.
2. **Menu:** the icon and name; *How it works*, *FAQ*, *GitHub*, and a
   *Download* button that goes to the top.
3. **Hero:** *Free for macOS and Windows*; the heading and one sentence;
   *Download for macOS* as a button and *Download for Windows ›* as a link,
   swapped on Windows; *Version 0.9.0 · Open source · Nothing else to
   install*. Under it, the app's rehearsal screen, live: a four-piece take,
   Polyn 2, open in the player with its bridge on repeat. It can be used:
   pick a take, drag a region, press keys. It makes no sound, and says so.
   - The downloads are
     `releases/latest/download/RehearsalRecorder-macos.zip` and
     `RehearsalRecorder-windows.zip`, the asset names the release workflow
     already uses.
4. **Built for the room it is used in.** Seven grey tiles, each a heading,
   one sentence, and a piece of the app (see *Tiles*). There is no tile
   for playback: the hero is the player.
5. **From soundcheck to the take you keep.** Four steps on the left; on the
   right, a sticky frame where the app goes through the same steps as the
   page scrolls: setting up with *Check signal* on, recording with the
   guitar clipping three times, the take just stopped, the rehearsal in
   History. A rail under the frame shows the four steps and jumps to them.
6. **Questions:** six questions, closed, as a plain list.
7. **Open source, one line:** *Made by a band, for bands. Open source.*,
   with *Source on GitHub ›* and *Report a problem ›*.
8. **Footer:** reha.stream · MIT license; Guide, Changelog, Releases.

### Tiles

| Tile | Piece of the app |
|---|---|
| Tells you it is fine while it runs. | The recording screen's status line, and the Bass and Guitar tiles, the Guitar one red with *clipped 3×* |
| Every musician on their own track. | The Stop button with *autosaved every 30 s* |
| Every rehearsal says what it was. | Four rehearsals in History's list |
| Marks say what happened, not just where. | Polyn's four goes in a rehearsal's overview, with their marks and comments |
| The good takes go to the cloud. | The overview of one kept take that is in the cloud |
| Records at what the card can do. | None: *16 / 24-bit* and *44.1 · 48 · 96 kHz* set in type |
| Never destroys anything. | None |

The tiles' words are short versions of the README's *What it does*,
written for the page, so they live in `site/content/features.md`, not
in the README.

### Phones

Under 720 px the tiles stack to one column, and a wide piece (Polyn's
goes) keeps the app's size and shows its left part rather than shrinking
past reading. The hero and the story keep the app whole, scaled to the
width of the screen, and are not interactive there: the hero's line says
*Try it on a computer*, and the story still steps as you scroll.

## How it is built

### Where it lives

```
site/
  package.json  vite.config.ts  tsconfig.json  vercel.json
  index.html        the page
  stage.html        a live piece of the app, one per frame
  content/          hero.md  features.md  story.md  faq.md
  src/page/         the page: sections, tiles, the story's scrolling
  src/stage/        the scenes the frames show, and the demo's director
  src/content.ts    reads content/ and CHANGELOG.md at build time
  e2e/              the site's test
ui/e2e/band.js      the band, shared with tests/docs_screenshots.py
.github/workflows/site.yml
```

- **The site is its own Vite + React + TypeScript project** with its own
  `package.json`. It imports from the interface with the same `@/` alias
  the interface uses (`@` → `../ui/src`), and keeps one copy of React
  (`resolve.dedupe`). The app's build, `ui/` and its lockfile are not
  changed by it.
- **Styles.** The page's CSS is ported from the approved preview: plain CSS
  with the preview's tokens, Instrument Sans and IBM Plex Mono. The app's
  `ui/src/index.css` is imported first, with Tailwind scanning `ui/src`, so
  the pieces of the app look as they do in the app; the page then undoes
  the three things in it that are for a desktop window (`height: 100%` on
  `html` and `body`, `user-select: none`, and the body's font).

### Two kinds of app on the page

- **Tiles render the app's components in the page itself.** They only take
  props: `TrackTile`, `RehearsalList`, `RehearsalOverview`, and the two
  components moved out of the recording screen below. The fake bridge is
  loaded once in the page, and on load the tiles take their props from its
  answers, as the screens would (the list of rehearsals, a rehearsal with
  its takes and songs, the labels). The track tiles hold still at the
  levels of the moment the guitar clipped.
- **The hero and the story are frames** of `stage.html`, each with its own
  window, so each has its own fake bridge and its own state, and the app's
  polling, keys and focus stay inside it. A frame shows a whole screen of
  the app laid out at 1180 × 960 and scaled to fit, as the preview does.
  - `stage.html#hero` mounts `Rehearsal` on a rehearsal with the band's
    takes, opens Polyn 2, drags the bridge as a region and presses Play.
  - `stage.html#story` mounts one screen per step, with the props `App`
    would give it, after setting the fake up the way the app would have:
    `Setup` (and presses *Check signal*), `Recording` (rehearsal started,
    take 4 named Vesna 2), `Review` (the take just stopped), `HistoryScreen`
    (Tuesday jam). The page tells it which step with `postMessage`. A step
    back starts the frame afresh, since the fake cannot unrecord a take.
  - Buttons that would leave the screen (*Record take*, *Finish*) do
    nothing on the site.

### The demo

- **The band** (four musicians, a 128 bpm song, Polyn, Vesna and the
  others, the past rehearsals) moves out of `tests/docs_screenshots.py`
  into `ui/e2e/band.js`. The screenshot script reads it from there.
  - It is brought up to date with the app on the way: today it crashes the
    interface, because its last rehearsal has no `plays` and its takes
    have no `song`, `go` or `starred`.
  - The docs' pictures are not remade here.
- **The director** (`site/src/stage/`) is the site's layer over the fake:
  light theme, no app server, a guitar that clips three times during the
  take, and the scenes above.
- **Still when off screen (D7).** The page watches each frame with an
  `IntersectionObserver` and tells it to hold. A held frame's timers and
  animation frames wait until it is back, so a frame scrolled past costs
  nothing. While it runs, its animation frames are capped at 24 a second.
  - Measured on the preview in a headless browser without a GPU: idle with
    no frame on screen, about 0 % of a core (it was about half a core with
    three apps running); with the hero playing, about a quarter of a core.

### Changes to the app

- **Two pieces of `Recording.tsx` become components:** its status line
  (*Interface connected · room for …*, and its warnings) and its Stop
  button with the line under it. The recording screen uses them where they
  are now and looks the same; the site's tiles use them too.
- Nothing else in `ui/src` changes for the site.

### Content

- `site/content/*.md` holds the hero's heading and sentence, the tiles'
  headings and sentences, the four steps, and the questions with their
  answers. Which piece of the app goes in which tile stays in code.
- **The version** is the release's tag in a release build (tags are bare
  versions, `0.9.0`). In a pull
  request's build, or locally, it is the newest version heading in
  `CHANGELOG.md` that is not *Unreleased*.
- **The news line** is the bold lead of the first item under that version's
  heading. If the section has none, the line is just *New in 0.9.0.* with
  the link.

## Publishing

- **`.github/workflows/site.yml`:**
  - on a pull request that touches `site/`, `ui/` or `CHANGELOG.md`:
    build the site and run its test, and, for a branch of this repository,
    deploy the build to Vercel as a preview, shown in the pull request as
    "View deployment" (added 2026-10-07);
  - when the *Release* workflow has finished well for a published release
    (`workflow_run`), so the zips are already attached and the download
    links work: the same, from the release's tag, then deploy the build to
    Vercel as production. A rehearsal of the *Release* workflow started by
    hand deploys nothing;
  - by hand (`workflow_dispatch`): deploy the latest release again, for
    the first deploy and for setting up the domain.
- **The test** (Playwright, in `site/e2e/`) opens the built site and checks
  that the hero gets to its take with the region repeating, that scrolling
  takes the story through its four screens, that the tiles show the red
  Guitar tile and four rehearsals, and that nothing is written to the
  console as an error.
- **Vercel:** a project in Alex's own account, made without Git deploys,
  so Vercel never builds on a push; the workflow deploys a build it made
  itself (`vercel deploy --prebuilt --prod`). It needs three repository
  secrets: `VERCEL_TOKEN`, which only Alex can make, and the project's
  `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`. The routes Vercel applies (the
  short links `/mac` and `/windows`, a year's cache for `/assets/`) are in
  `site/vercel-config.json` (added 2026-10-07).
- **The domain.** `reha.stream` already points somewhere else
  (207.207.210.107 and .229 on 2026-10-06). The default is the site at the
  bare domain, with `www` sent to it. Changing the DNS is Alex's, and is
  asked for at the first deploy, not before.

## Links, search engines and the 404 page (added 2026-10-07)

The page is drawn by script, and those that read it without running any
(chats drawing a card for a link, AI crawlers, a search engine's first
pass) see only the HTML. Rendering ahead of time stays out (below); Alex
chose the tags instead.

- **`site/index.html`:** a canonical address, Open Graph and Twitter tags
  (title and description as the page's own, `og:image`
  `https://reha.stream/og.png`, 1200 by 630, `summary_large_image`).
- **At build time** (`seo()` in `site/vite.config.ts`, words from
  `site/src/content/seo.ts`): JSON-LD describing the app as a
  `SoftwareApplication` at the version the page shows; a `<noscript>` with
  the heading, the lede and both downloads; `robots.txt`, which lets every
  crawler in, AI ones too; and `sitemap.xml`, the one page. Google shows no
  rich card from the JSON-LD (that needs ratings); it helps engines tell
  what the app is.
- **The link picture:** `site/og.html` lays out the page's heading, its
  eyebrow and the app's rehearsal screen (the hero's frame) at 1200 by 630,
  the variant Alex picked; `site/scripts/og.mjs` photographs it from the
  build into `og.png`, in the site's CI, so it always shows the app as it is.
  The runner has no Mac or Windows font, so Inter stands in for the app's
  system font (`site/scripts/og-fonts.conf`), and no picture is drawn when
  the page's own font did not load.
- **The 404 page** (`site/404.html`): "Nothing was recorded here", a button
  back to the main page, the download for the visitor's computer, and
  Take 404 in the app's own player, four tracks of silence, 4:04 long (Alex
  picked "Пустой дубль"). Vercel answers with it, status 404, for any
  address that is no file, after `/mac` and `/windows` (the routes after
  `{ "handle": "filesystem" }` in `vercel-config.json`). Without script it
  still says so, with a link back (a `<noscript>`).
- `stage.html`, `og.html` and `404.html` carry `noindex`; analytics counts
  only the main page.
- **Search consoles.** Google Search Console is Alex's: the domain
  property, verified by a DNS TXT record, so nothing for it is in the
  site's code. Its sitemap, `https://reha.stream/sitemap.xml`, is submitted
  there once a release has put it on reha.stream. Yandex Webmaster was
  left out (Alex, 2026-10-07).

## Not in this

- The docs' screenshots, remade.
- A dark version of the page.
- Pages other than this one and its 404 page, other languages, a blog.
  (Visits are counted since 2026-10-07, with Vercel's Web Analytics: see
  `site/src/page/main.tsx`.)
- Rendering the page to HTML ahead of time; the text is in the build, the
  page is drawn by React on load.
