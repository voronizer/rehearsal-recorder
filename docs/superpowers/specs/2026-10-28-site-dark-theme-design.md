# reha.stream in the dark

The design review of 28 Oct left a dark theme for later (R9 in
`2026-10-28-site-design-review-design.md`). This is it: the site follows
the computer's or the phone's own setting, and in the dark it is dark all
through, the app in it included.

**Status:** the design was approved by Alex in the session on 28 Oct 2026;
this spec is waiting for his review.

## What Alex decided

- **N1. As the system says** («Как в системе»): dark when macOS, Windows
  or the phone is set to dark, light otherwise. No switch on the page.
- **N2. The app dark too** («Тоже тёмные»): the live app on the first
  screen, the window of the steps and the pieces of the app in it take
  the app's own dark theme, the one a musician sees by default.
- **N3. Approach A** («да»): the app's own `.dark` class on the page's
  root, not a palette of the site's own, so the page and the app stay one
  thing (D4 of the website spec: the pictures are the app).

## 1. What turns dark

Every page that uses `page.css`: the main page, the page of stories, each
story, the 404 page. The page's colours are already the app's
(`--page-bg: var(--background)` and the rest), so under `.dark` they
become the app's dark values:

| Page token | Light | Dark |
|---|---|---|
| `--page-bg`, `--page-app` | `--background` 1.00 | `--background` 0.18 |
| `--page-tile` | `--panel` 0.96 | `--panel` 0.15, a shade darker than the page, as in the app |
| `--page-fg` | `--foreground` | `--foreground` 0.93 |
| `--page-muted` | `--muted-foreground` | `--muted-foreground` 0.68: 6.5:1 on the page |
| `--page-line` | `--border` | `--border` 0.30 |

The figures are OKLCH lightness, from `ui/src/index.css`.

Three colours are the page's own and need a dark value:

- **The red of words** (`--page-rec`): `#c42f36` reads 3.4:1 on the dark
  page. In the dark it is the icon's `#e5484d`: 4.8:1 on the page, 5.0:1
  on a tile.
- **Links as words** (`.more`, a story's links): the app's blue
  (`--primary`, OKLCH 0.56) reads 3.8:1 on the dark page. In the dark they
  take a lighter blue, `--page-link`, at 4.5:1 or more on the page and on
  a tile. Buttons keep the app's blue: white on it is 5.0:1.
- **Shadows** (the app's screen, a piece of the app): written as
  dark greys at a few per cent, they vanish on a dark page. In the dark the
  ring round the app's screen is the page's line instead, so its edge
  still shows.

The dot stays `#e5484d` in both.

## 2. When

A small script in the `<head>` of each page (`index.html`,
`stories.html` and the stories built from it, `404.html`) sets `.dark` on
`<html>` from `matchMedia("(prefers-color-scheme: dark)")` before the page
is drawn, so a dark computer never sees the page flash white. It listens
for a change and sets or clears `.dark` at once, while the page is open.

The page's own `color-scheme` follows: `dark` under `.dark`, so the
browser's scroll bars and form controls are dark too.

## 3. The live app

`stage.html` (the frames of the live app) asks for the theme `system`
instead of `light`: in `site/src/stage/main.tsx` and in the demo's
settings (`site/src/stage/demo.ts`). A frame follows the same media query
as the page round it, so the app is dark on a dark page, and it changes
with the page. Changing the theme saves nothing, as now.

## 4. What stays light

The link picture (`og.png`, from `og.html`): one picture, drawn once at
build time and shown by chats on any background. `og.html` is not touched.

## 5. Tests, written first

Playwright emulates the system's setting (`colorScheme`). On `/`,
`/stories`, `/stories/tempo-drift` and `/404.html`:

- **dark:** `<html>` has `.dark`, and `body`'s background is dark
  (lightness under 0.3);
- **dark:** the main text, the grey text, the red words, and a link read
  at 4.5:1 or more against what they stand on;
- **light:** `<html>` has no `.dark`, and the page is as it was (white);
- **no flash:** in the dark, the background is dark in the first paint,
  before the page's module script runs (the script blocked, the head's
  script alone);
- **live change:** switching the emulated scheme on an open page sets or
  clears `.dark`.

On `/`:

- **dark:** the live app on the first screen and the window of the steps
  have `.dark` on their own `<html>`;
- **dark:** a piece of the app over the window (the set's) is dark.

## Claude's calls

- The lighter blue for links in the dark: picked by its contrast, to be
  shown to Alex on a screenshot.
- The ring round the app's screen in the dark from the page's line.
- The head's script inline in each HTML file, not a module, so it runs
  before the first paint. The site sends no Content-Security-Policy, so an
  inline script runs.

## Not in this

A switch on the page (N1). A dark link picture. Any change to the app's
own dark theme.
