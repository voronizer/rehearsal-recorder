# Shipping РЭХА, the site and the band service separately

Today one GitHub Release puts up all three parts: РЭХА's zips, reha.stream
and the band service. A service fix waits for an app release, and a site fix
needs one: 0.13.1 was cut for the site's tiles alone. The checks also run far
more than a change needs. PR #125 changed one comment in `release.yml` and
kept five machines busy for 19 minutes, then six more for 24 minutes after
the merge.

After this work each part goes out on its own, and a pull request runs only
the checks of the parts it touches.

Alex approved this spec on 3 November at 14:16 («ок»). The plan:
`docs/superpowers/plans/2026-11-03-split-shipping.md`.

## Alex's picks

All on 3 November 2026, in the thread «Разделить выкладку РЭХИ, сайта и
сервиса». The page he answered:
https://claude.ai/artifact/9mhcaZspbs5Mh5gb9UuDqX (a copy is in
/mnt/project-files/ci/split-shipping/vykladka.html).

- 13:14 «невозможно, например выложить сервис отдельно от сайта. и куча
  тестов идет лишних в процессе каждый раз».
- 13:22 «попробуй сам отследить взаимосвязи и предложить варианты»; 13:44
  «а можно где-то ослабить взаимосвязи без ущерба?».
- 13:59 «все ок. за исключением Q6 - делаем сейчас». So:
  - Q1: the site is loosened from main: a block waits for its version, and
    every build takes the version and the news from the latest release.
  - Q2: variant В. The site and the service go out by themselves after a
    merge that touches them; РЭХА goes out when he presses Publish.
  - Q3: the checks run once on the pull request, for the parts it touches,
    and once more right before a part goes out. Tests that check another
    part move to that part.
  - Q4: one workflow file per part.
  - Q5: the minutes after Publish, when the newest release has no zips yet,
    are fixed in this work.
  - Q6: the seam between Python and the interface gets a check in this
    work, not in a separate issue.
  - Q7: one CHANGELOG for all three parts.
- 14:06 «Демо из main» (card). The app's demo on the site keeps drawing with
  main's interface. The page itself draws pieces of РЭХА, not only the
  frames (`site/src/page/main.tsx:15`), and drawing them from the release
  would mean building the whole site with the release's interface. So the
  demo can be ahead of the downloadable РЭХА, but only when a site change
  goes out before a release, and only until that release.

## What ties the parts together

Found in the code on 3 November (main at 5598e15):

- The interface, `ui/`. РЭХА carries it; the site draws its demo and its
  tiles with it (`site/vite.config.ts:216`); the service draws its pages and
  its player with it (`service/vite.config.ts:22`).
- `CHANGELOG.md`. The site takes its version and its news line from it
  (`site/vite.config.ts:33`).
- The latest GitHub release. Installed copies look for their update there
  (`src/rehearsal_recorder/updates.py:62`), and the site's download buttons
  point into it (`site/src/page/links.ts:5`).
- `service/openapi.json`, the contract. РЭХА's tests check every request
  РЭХА makes against it (`tests/test_sending.py`).
- The version. РЭХА's number comes from the newest git tag
  (`pyproject.toml:34`). A tag of another shape breaks it: after a tag
  `service-1.0` on top of `0.21.0`, setuptools-scm called the next build
  1.1.dev1 (tried in a scratch repository). So the site and the service get
  no tags or releases of their own.
- РЭХА's help button opens reha.stream/band-service (`band_service.py:53`).

## How each part goes out

### РЭХА

- Alex publishes a release on GitHub, as now, from Claude's prefilled link.
  The release builds the zips and then puts the site up again for the new
  version. It no longer puts up the service.
- The release first hands GitHub's "latest" back to the release before it.
  While the zips are built, installed copies and the download buttons keep
  getting the previous version. Once both zips are attached, the new release
  becomes the latest again, and the site is put up for it. If a build fails,
  the previous release stays the latest, so nobody gets a release without
  its zip. Today the newest release has no zips from Publish until the last
  build ends (0.21.0: Publish at 12:35, the Windows zip at 12:40).
- A pre-release builds and attaches its zips, as now. It leaves "latest"
  alone and puts nothing up.
- By hand: Actions › Reha › Run workflow › Rehearse the builds, as now.

### The site

- Goes out by itself after a merge into main that changes `site/`, its
  workflow file or its build action (`.github/actions/site/`). Not after a
  change to `ui/` or `CHANGELOG.md`: nearly every merge changes one of them,
  and each would put the site up with main's interface ahead of the release.
- Goes out again after every release of РЭХА, once both zips are attached.
  The release starts it.
- By hand: Actions › Site › Run workflow puts up main's site.
- Every build asks GitHub which release is the latest, and takes the
  version and the news line (the first item of that version in
  `CHANGELOG.md`) from it. Today only a release's build knows its version; a
  pull request takes the newest version in `CHANGELOG.md`.
- A block waits for its version. A heading in `site/content/` may end in
  `{from 0.22.0}`, or `{#id from 0.22.0}` where it has an id. A build for a
  release older than 0.22.0 leaves that section or item out. A feature's
  block can then be merged with the feature and shows on reha.stream on the
  day its release comes out, since the release puts the site up again.
- A pull request's preview shows the site as it will be after the next
  release: every block, waiting or not.
- The demo keeps drawing with main's interface (14:06).

### The band service

- Goes out by itself after a merge into main that changes `service/`,
  `ui/` (its pages draw with the interface) or its workflow file.
- By hand: Actions › Service › Run workflow puts up the branch picked, main
  by default. A band running its own copy does this (`service/README.md`,
  step 7), or merges main into their fork, which puts it up by itself once
  their Cloudflare token is set.
- Being main's, it is always ahead of any РЭХА that sends to it. It still
  takes requests from copies of РЭХА that have not updated, as now.
- Its database changes (migrations, `service/scripts/deploy.mjs`) go out
  with it and are never undone, as now.

## What runs, and when

### A pull request

GitHub starts a workflow only when the pull request touches one of the
paths at the top of its file (`paths`, GitHub's documented way). The table
in checks.yml's step "What it touches" goes. A workflow skipped this way
would hold a pull request if main required its check; main requires none
(its ruleset only stops deletion and force-pushes).

| The pull request changes | Runs |
| --- | --- |
| Python: `src/`, `tests/`, `tools/`, `packaging/`, `pyproject.toml`, `requirements.txt`, `alembic.ini`, `build.bat`, `build.command`; also `service/openapi.json` (the contract), `ui/vite.config.ts` (where the app finds its interface), `.github/actions/app/`, `reha.yml` | Reha: app · macos, app · windows. 2 machines |
| The interface: `ui/`, `packaging/icon.svg`, `packaging/icon-small.svg`, `interface.yml` | Interface: interface · 1/3, 2/3, 3/3. 3 machines |
| The site: `site/`, `ui/`, `CHANGELOG.md`, `.github/actions/site/`, `site.yml` | Site: site; site · after release when a block waits for a version; site · preview when `site/`, its action or `site.yml` changes, as decided on 11 October |
| The service: `service/`, `ui/`, `service.yml` | Service: service |
| The seam: `src/rehearsal_recorder/api.py`, `ui/src/lib/api.ts`, `ui/e2e/fake-bridge.js`, `ui/scripts/bridge-check.mjs`, `bridge.yml` | Bridge: bridge. Seconds |
| Anything else: `docs/`, `README.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `.claude/`, `LICENSE`, the issue and PR templates, `dependabot.yml` | Nothing. CodeQL still checks every pull request (GitHub's default setup) |

So PR #125 would have run Reha alone, on 2 machines instead of 5, and a
docs-only pull request runs nothing.

The `site` job of a pull request builds the site as it would go out after
the merge: the latest release's version, waiting blocks left out. It runs
the site's Vitest and Playwright on that build, so what goes out on merge is
what was tested. When a block in `site/content/` waits for a version newer
than the latest release, `site · after release` builds and tests the site
with every block in. The preview is that build when there is one, and the
`site` build otherwise.

### A merge into main

Nothing is checked again for its own sake: the pull request already checked
the same code. A part that goes out is checked right before it does:

- the site: `site` (build, Vitest, Playwright), then `site · deploy`;
- the service: `service` (typecheck, Vitest, the deploy script, build,
  Playwright), then `service · deploy`.

One gap is left: two pull requests merged one after the other were never
checked together. The part that goes out checks them together before it
does; for РЭХА, the release's builds run every Python suite on a Mac and on
Windows before they are attached.

### A release

`latest back` (ubuntu, seconds), then `build · macos` and `build · windows`
(every Python suite, PyInstaller, `--selftest` on the build, the zip, as
now), then `latest` (the new release becomes the latest, and the site is
started on main for it). The site then runs as after a merge: `site`, then
`site · deploy`.

## Tests that check another part

`tests/test_platform.py` checks two things that are not Python:

- **The icons** (lines 501-508): `ui/index.html` links the small icon, and
  `ui/public/favicon.svg` and `ui/public/logo.svg` are
  `packaging/icon-small.svg` and `packaging/icon.svg`. This moves to a
  Vitest file in `ui/`, which reads `../packaging/`. An interface change then
  never needs the Python suites on a Mac and Windows.
- **The zip names and the build paths** (lines 511-525) stay in Python,
  reading `reha.yml` instead of `release.yml`. A change to `reha.yml` runs
  Reha's own jobs anyway, and they run this test.

## The seam between Python and the interface

The interface's tests run against `ui/e2e/fake-bridge.js`, a stand-in for
РЭХА's Python side. The interface lists every call it may make of Python in
`ui/src/lib/api.ts` (`PyApi`, 171 calls). Today nothing compares the list,
Python and the stand-in, so a call renamed in Python passes every check.

A new script, `ui/scripts/bridge-check.mjs` (`npm run bridge-check`), run by
`bridge.yml` and by hand:

- reads `PyApi`'s names with TypeScript's own parser;
- reads the public methods of Python's `Api` class
  (`src/rehearsal_recorder/api.py:775`) with Python's own parser (`ast`),
  importing nothing, and leaves out properties;
- loads the stand-in in Node with a stand-in window, as the site's demo
  does, and lists its calls.

It fails when a listed call is missing in Python or in the stand-in, or when
the stand-in has a call the list does not have, and names each one. Names
only: comparing what each call takes would need the two languages' types
side by side, and neither file has them.

Run on main at 5598e15 it finds one: `media_url` is listed and is in Python,
the stand-in has no such call, and nothing in the interface calls it. It
comes out of `api.ts` (line 1172, and `ANSWERS_WITH_A_VALUE` at line 1737).

## The workflow files

| File | Name | Runs |
| --- | --- | --- |
| `.github/workflows/reha.yml` | Reha | app · macos, app · windows on a pull request; latest back, build · macos, build · windows, latest on a release; the two builds by hand (Rehearse the builds) |
| `interface.yml` | Interface | which playwright, interface · 1/3, 2/3, 3/3 on a pull request |
| `site.yml` | Site | which release, site, site · after release, site · preview on a pull request; which release, site, site · deploy after a merge, after a release and by hand |
| `service.yml` | Service | which playwright, service on a pull request; which playwright, service, service · deploy after a merge and by hand |
| `bridge.yml` | Bridge | bridge on a pull request |

- `checks.yml` and `release.yml` go.
- A browser job runs in Playwright's image for the version in its part's
  lock file, as now, and a job's image has to be known before it starts. So
  each file with browser jobs starts with a small job that reads the
  version, as `what changed` and `which release` do today. In `site.yml`
  that job (`which release`) also asks GitHub for the latest release and
  says whether a block waits for a newer one.
- Names in Latin letters, since the Windows machines print in cp1252; job
  names stay as they are today.
- `.github/actions/app` and `.github/actions/site` stay: each is still used
  by several jobs of its file.
- Concurrency as now: a pull request's newer push replaces its older run;
  one deploy at a time for each Worker, and none is cut short.
- The release starts the site with GitHub's own token: a `workflow_dispatch`
  is the one event that token can start a run with. `reha.yml` needs
  `actions: write` for it, and `contents: write` to attach and to set
  "latest".

## Pages and words that change

- `service/README.md`: step 7, the note at line 136 and "How it goes up"
  (lines 162-196): the service goes up after a merge into main, or by hand
  with Actions › Service › Run workflow.
- `docs/building.md` (line 100), `docs/pushing-to-github.md` (lines 25-40),
  `CONTRIBUTING.md` (line 112): what a release does, the hand-back of
  "latest", where the builds are.
- `docs/development.md` (line 107), `docs/design-notes.md` (line 97),
  `docs/design-system.md` (line 932): which workflow runs what.
- Comments that name `checks.yml` or `release.yml`: `site/src/page/links.ts:2`,
  `src/rehearsal_recorder/platform_support.py:538`,
  `src/rehearsal_recorder/app.py:421`, `tests/test_platform.py:935`, the two
  actions, `.github/dependabot.yml:32`.
- No CHANGELOG item: nothing changes in РЭХА, on the site or in the service
  that a musician would see.

## Calls Claude made on its own

1. Five workflow files, not four: the seam's check has its own small file,
   so a change to `api.py` does not start the interface's three machines,
   nor a change to the stand-in the Mac and Windows ones.
2. The zip names stay in the Python test (above). The page said they would
   move to a quick check of the workflow files; with one file per part that
   check would add nothing.
3. The site goes out after a merge only for `site/`, its action and its
   workflow; not for `ui/` or `CHANGELOG.md` (reason above).
4. The service goes out after a merge for `ui/` too, so its pages are
   always main's.
5. A waiting block is marked in its heading's braces, `{from 0.22.0}`.
6. A pull request's `site` job tests what goes out on merge; `site · after
   release` runs only when a block waits; the preview shows every block.
7. Every site build, a pull request's too, asks GitHub for the latest
   release.
8. The minutes without zips are fixed by handing "latest" back to the
   previous release until both zips are attached. Alex presses Publish as
   now. The other way, a Run workflow button that builds first and publishes
   after, would change what he presses and drop the prefilled link's text.
9. After a release, РЭХА's workflow starts the site's on main.
10. The by-hand runs: Reha › Rehearse the builds, Site › Run workflow,
    Service › Run workflow. "Put the site up again" and "Put the service up
    again" go, and with them putting a part back as it was at a tag: both
    parts are always main's, and the site's guard for releases from before
    0.21.0 goes too.
11. The seam's check compares names only, and `media_url` leaves `api.ts`.
12. Reha also watches `ui/vite.config.ts`, `tools/` (its tests use it) and
    `service/openapi.json`.
13. The release's builds keep running every Python suite: with nothing
    checked again on main, they are the last check before people get a
    build.
14. No CHANGELOG item.

## Not known yet

- Whether "latest" stays on the previous release once the release run hands
  it back. GitHub documents setting it on any published release, not this
  order of events. The first release after the merge shows it; if the step
  fails, the run is red, and the builds still go on, so the new release,
  still the latest, gets its zips (changed in the final review: stopping
  before the builds would leave it without zips until a re-run).
- How long the newest release is "latest" before the hand-back: the time
  GitHub takes to start the run, not measured. Seconds as a rule.

## Testing

- While building it, only what a change touches runs, once: the bridge
  check, the new icon test, the site's content tests for waiting blocks,
  `test_platform.py`.
- The pull request changes all five workflow files, so each runs its pull
  request jobs once on CI.
- A deploy only runs on main. The merge itself is its first test: it
  changes `site.yml` and `service.yml`, so it puts up both. Alex then looks
  at reha.stream and band.reha.stream.
- The release path runs at the next release. Right after Publish the
  download buttons should still give the previous version, and the new one
  once both zips are attached.
