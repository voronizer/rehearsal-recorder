# reha.stream after a design review

A design review of reha.stream on 28 Oct 2026 looked at the main page, the
page of stories, the tempo-drift story and the 404 page, at 1440 and 390 px,
and found ten things to change. The review, with its screenshots and
mockups, is at https://claude.ai/artifact/ECV4DKt2HvXgf7Ye8aXeMK.

The three that cost the most: the main page, 8700 px long, ended with the
questions and a link to GitHub, with no way to download; on a phone the
steps' window and its words were held at the top of the screen, 517 px of
844; and the site had no face of its own, in the system's font, so it
looked one way on a Mac and another on Windows.

The work goes in three pull requests. The first two were merged before this
spec was written, which they should not have been: this spec records what
Alex decided for them, as well as for the third.

| PR | What | State |
|---|---|---|
| [#86](https://github.com/voronizer/rehearsal-recorder/pull/86) | R1, R3, R5, R6, R8, R10 | merged 28 Oct |
| [#87](https://github.com/voronizer/rehearsal-recorder/pull/87) | R2 | merged 28 Oct |
| this one | R4: Geologica and the dot | plan: `docs/superpowers/plans/2026-10-28-site-headings-font.md` |

Before the review, the same day, the steps' cards became a list that opens
the one picked ([#85](https://github.com/voronizer/rehearsal-recorder/pull/85)).

## What Alex decided

Alex decided these on 28 Oct 2026, in the session, item by item, on
screenshots of the built site with each change made in the browser.

- **R1. The downloads again at the end of the main page.** After the
  questions, before *Open source, under the MIT license.* (вариант «После
  вопросов»). On the page's white, no tile («Без панели, крупно»): the
  icon, *Record the next rehearsal.* («Record the next rehearsal.»), a line,
  the two downloads and the version as on the first screen. The main page
  only («Только главная»); a story has its own downloads already.
- **R2. On a phone, the steps' window in the step on show** («Окно в каждом
  шаге»). Nothing is held at the top of the screen: the window stands at
  the top of the step in the middle of the screen, a tap on an item brings
  the page to the window.
- **R3. A shorter first screen** («Ужать отступы и заголовок»), so a laptop
  shows a good part of the app. Over the heading, a calm line in the
  band's voice («Спокойная фраза от лица группы»), not the stories' line
  about arguing, which stays in the stories' block («заголовок про споры
  идущий сразу - так себе»). The line: *Our band's recorder, free for
  yours.*
- **R4. A face of its own** («Покажи 3 варианта»): a typeface for the
  headings, picked from three mockups (Unbounded, Geologica, Rubik):
  **Geologica**. The icon's red as a recording's dot («Да, покажи
  макетом»), shown in all three mockups and not turned down. Photos of
  the band: not yet («Пока нет»).
- **R5. Fewer grey tiles** («Истории и плашки»): the stories' block and the
  steps' tiles keep theirs; Victor Baikov's controller goes on the page's
  white. The empty room after the last step is smaller («Уменьшить»).
- **R6. The controller after the steps** («После шагов»), before the
  questions.
- **R7. Proof from others** (downloads, other bands' words): not now
  («Пока ничего»). No numbers or quotes are made up.
- **R8. Contrast and targets** («Да»): the red of words at 4.5:1 or more
  on white and on a tile; the ribbon's and footer's links 24 px high.
- **R9. A dark theme:** later, after R4 («Потом»).
- **R10. Read level on the cards of the page of stories** («Да»).
- **R11. The link picture in Geologica too** («1- да»), after the review
  found `og.png` still in Instrument Sans from Google.
- **R12. Phones on their side, 900 px or wider, get the phone's steps**
  («2 - чинить»): at 932 by 430 the window was held at the side, 204 px
  wide.
- A window between 899 and 900 px wide, from a zoom: left as it is
  («3 - ты псих?»).

Process, from Alex on 28 Oct: the work follows superpowers, a spec and a
plan before the code, and each test is written before the code it checks
(«тесты пиши до, а не после»).

## 1. The first screen (R3, #86)

- Room over the heading: `clamp(24px, 3.5vw, 44px)`; the heading at most
  4.25 rem (68 px), was 5.4 rem. At 1440 by 900 the app shows from about
  570 px down, 330 px of it, against 200 before.
- The word over the heading: *Our band's recorder, free for yours.*
  (`site/content/hero.md`, `## eyebrow`). The fine print under the
  downloads stays *Version 0.16.0 · Open source · Nothing else to install*:
  the word *free* is in the line over the heading.

## 2. The end of the main page (R1, #86)

`site/content/download.md`: *Record the next rehearsal.* and *Free, for
macOS and Windows. Plug in the interface, press **Record take**, play.*
Drawn by `site/src/page/GetIt.tsx` as `section.get-it#download`: the icon
at 72 px, the heading in the `.h2` size, the line as `.lede`, the downloads
from `Downloads.tsx` (the button for this computer, the other a link) and
the version line.

## 3. The steps on a phone (R2, #87)

Under 900 px each step has a `.slot` after its line, as tall as the window
and its words (`--stage-h`, measured). The one window (`.stage`, the live
app is one frame on the page and moving it would reload it) is placed
absolutely at the top of the story and moved down to the slot of the step
on show with a `translateY`, which, unlike a change of `top`, is not a
layout shift (review, 28 Oct: moving `top` gave a CLS of 1.68 through the
four steps, where Speed Insights calls 0.25 poor). The other slots are a
tile's grey. The rooms take the window's height from a ResizeObserver on
the window alone, and a resize of the browser; watching the story too saw
its own write and looped. The rail is not shown. A tap on an item goes to
its step's window at once when that window is off the screen or the
item's step is not the one on show: a smooth scroll would pass through
other steps, and moving into one puts the item out.

## 4. The order of the main page (R5, R6, #86)

The first screen, the stories' block, the four steps, the controller, the
questions, the downloads, the open-source line, the footer. The controller
is on the page's white, its photo with a 24 px radius. The steps' room
under the last step: `padding-bottom: 6vh`, was 20vh.

## 5. Contrast and targets (R8, #86)

- `--page-rec: #c42f36`: 5.5:1 on white, 4.9:1 on the tile's grey. It is
  used only for words. The icon keeps its own red, `#e5484d`, in its SVG.
- The ribbon's *Release notes* and the footer's links: `padding-block: 4px`,
  24 px high or more.

## 6. Read on the cards (R10, #86)

The page of stories: in a card with a chat, the words take what is left of
the card, and *Read* sits at its bottom, level with its neighbour's.

## 7. Geologica and the dot (R4, this pull request)

### The typeface

Geologica, by the Geologisk Project Authors, under the SIL Open Font
License 1.1. Served by the site itself, never by Google: three variable
WOFF2 files, weights 500 to 600, one for each script the pages use:

| File | Script | Size |
|---|---|---|
| `geologica-latin.woff2` | Latin | 24.9 KB |
| `geologica-latin-ext.woff2` | Latin Extended: the Polish of *Pałyn*, *Ahoń* | 22.4 KB |
| `geologica-cyrillic.woff2` | Cyrillic: *РЭХА* | 16.4 KB |

They live in `site/src/page/fonts/` with the license as
`Geologica-OFL.txt`, and `page.css` declares them with the unicode ranges
Google gives each subset, so a browser loads only the ones a page uses.
`font-display: swap`.

Geologica sets the headings only, on every page that uses `page.css` (the
main page, the stories, the 404 page): `.h1`, `.h2`, the steps' `h3`, the
stories' block's, the controller's, a chapter's and a card's `h2`, a
chapter's joke, and the open-source line. Running text, the menu, buttons
and the pieces of the app stay in the system's font, as in the app.

### The dot

`--page-dot: #e5484d`, the icon's red. A 9 px dot with a 3 px ring of the
same red at 22 %, before the word over a heading (`.eyebrow`) and before a
step's and a chapter's number (`.step .n`, `.chap-head .n`), 8 px from it,
in the line, so that on a 320 px phone, where the word over the first
heading wraps, it stays before the first word. As a mark it needs the 3:1
of a graphic, and has 3.9:1 on white.

### Tests, written first

- Every page that uses `page.css` draws its `h1` in Geologica, and the font
  is loaded from the site: no request goes to `fonts.googleapis.com` or
  `fonts.gstatic.com`.
- The Cyrillic of *РЭХА* and the Polish of *Pałyn* load in Geologica
  from the site too.
- The first `.eyebrow` of each page has the dot: a 9 px circle in
  `rgb(229, 72, 77)`.
- A step's and a chapter's number have the dot too.
- At 320 px the hero's dot sits on the first of its two lines.
- Running text, the menu and the buttons stay in the system's font.

### Fixes to #87 from the review

Tests first, each seen failing:

- On a phone, scrolling through the four steps shifts the layout by less
  than 0.1 (it was 1.68).
- Turning the phone, or narrowing and widening the window, raises no
  error (it raised three ResizeObserver loop errors).
- In a tall, narrow window, 450 by 1600, a tap on an item of the next
  step puts the window in that step's room.

## 8. The link picture (R11, this pull request)

`og.html` sets its heading in Geologica from the site's own files, as the
page does, and loads nothing from Google; its other words stay in the
system's font (Inter on the CI runner, `scripts/og-fonts.conf`). The word
over the heading is in the darker red of words, with the dot. `og.mjs`
still draws no picture when Geologica did not load.

Tests, written first: the picture's `h1` is in Geologica, no request goes
to Google, and with the Geologica files blocked the page says `no-font`.

## 9. Phones on their side (R12, this pull request)

A screen 500 px high or less is a phone on its side, whatever its width.
It gets the phone's steps, as under 900 px: the window in the step on
show, with its words beside it (the landscape rule that was only for
under 900 px). `beside()` in `Story.tsx` and the media queries of the
steps in `page.css` say the same: beside is 900 px wide or more and more
than 500 px high.

A laptop's window 500 px high or less gets the phone's steps too: a
1366 by 768 screen at 125 % with a bookmarks bar comes to about 470 px.
There the window is about 275 px wide with its words beside it, close to
the 291 px it has held at the side at 501 px, so the step at the line is
small. The review found this acceptable; it is meant.

Tests, written first: at 932 by 430 the window is not held, it stands in
the room of the step on show, and the page does not scroll sideways.

## Claude's calls

Made without asking, in the pull requests named:

- **#86**: the darker red `#c42f36`; the first screen's sizes; 6vh under
  the last step; the controller's photo radius; the end block's padding;
  links' 4 px of padding for 24 px.
- **#87**: the instant scroll on a tap; the rail hidden on a phone; the
  window's words keep the longest item's height, so a short one leaves
  room under the window.
- **R4**: three subsets, not one file with every script; weights 500 to
  600 only; which headings take Geologica; the dot's size and ring.
- **R11**: only the picture's heading in Geologica, its other words in the
  system's font.
- **R12**: 500 px high as the line for a phone on its side.

## Not in this

Photos of the band (R4), other bands' words or download counts (R7), and a
dark theme (R9). The website spec (`2026-10-06-website-design.md`) is
history: what this changes there is noted at its top.
