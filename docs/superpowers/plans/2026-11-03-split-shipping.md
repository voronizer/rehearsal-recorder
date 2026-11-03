# Shipping РЭХА, the site and the band service separately: plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each part (РЭХА, reha.stream, the band service) goes out on its own, and a pull request runs only the checks of the parts it touches.

**Architecture:** Five workflow files, one per part plus the seam: `reha.yml`, `interface.yml`, `site.yml`, `service.yml`, `bridge.yml`, each started by GitHub's `paths` filter. `checks.yml` and `release.yml` go. The site reads the latest release's version at every build and leaves out blocks marked for a newer one; a release hands "latest" to the previous release until its zips are attached.

**Tech Stack:** GitHub Actions, `gh` CLI on the runners, Node 26, Python 3.12, Vitest, Node's own test runner, Playwright's image, Cloudflare Wrangler.

**Spec:** `docs/superpowers/specs/2026-11-03-split-shipping-design.md` (Alex's «ок», 3 November, 14:16).

## Global Constraints

- Never rename the zips: `RehearsalRecorder-macos.zip`, `RehearsalRecorder-windows.zip` (installed copies ask for them, `src/rehearsal_recorder/updates.py`).
- No tags and no releases for the site or the service: a tag of another shape breaks РЭХА's version (setuptools-scm).
- Workflow names: `Reha`, `Interface`, `Site`, `Service`, `Bridge`. Job names keep today's: `app · macos`, `app · windows`, `interface · 1/3`, `interface · 2/3`, `interface · 3/3`, `site`, `site · preview`, `site · deploy`, `service`, `service · deploy`, `build · macos`, `build · windows`. New ones: `latest back`, `latest`, `which release`, `which playwright`, `site · after release`, `bridge`. Latin letters and `·` only (Windows prints cp1252).
- Browser jobs run in `mcr.microsoft.com/playwright:v<version>-noble` with `options: --user 1001`, the version read from that part's `package-lock.json` by a small first job. The image has no apt and no jq.
- `actions/checkout@v7`, `actions/setup-node@v7` (Node `"26"`), `actions/setup-python` with `"3.12"` as `.github/actions/app` has it, `actions/upload-artifact@v7`, `actions/download-artifact@v8`.
- Concurrency: per file, `group: <file>-${{ github.event_name == 'pull_request' && github.ref || github.run_id }}`, `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`. Deploy jobs: `group: reha-stream` / `reha-band`, `cancel-in-progress: false`.
- Top-level `permissions: contents: read` in every file; a job raises only what it needs.
- Secrets and variables stay as they are: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (secrets), `WEB_ANALYTICS_TOKEN`, `SERVICE_DOMAIN` (variables).
- Comments, docs and messages: British English, short sentences for a musician (CLAUDE.md "Writing"); curly “ ” in docs and README, straight apostrophes; button names in bold in docs.
- While building: run only the tests a change touches, once each. Full suites run once, on the pull request's CI.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and no session line.

## Where this plan differs from the spec

1. The seam check reads `PyApi` by its layout, not with TypeScript's parser: TypeScript 7.0.2's package exports only `./lib/version.cjs` and `./unstable/*`, so there is no stable parser to import. `PyApi` is one block with each call on a line of its own at two spaces.
2. The zips are attached with `gh release upload --clobber`, not `softprops/action-gh-release`. That action edits the release itself when it exists, and whether that leaves "latest" alone is not documented; `gh release upload` only adds files.
3. Two more comments name the old files: `site/wrangler.jsonc` (lines 3 and 7) and `packaging/Reha.exe.config` (line 16).
4. A block can wait on the main page only (a story item or a question). The stories pages and the band service page have their own readers; a `{from …}` mark in their files fails the site's Vitest.
5. Site › Run workflow on a branch other than main builds and tests and puts nothing up.
6. The seam check's own tests run with Node's test runner in `bridge.yml`, since they call Python and the interface's machines have none; `ui/vite.config.ts` leaves that one file out of Vitest.

## Review Focus

1. A fork with no releases: the site builds with the newest version in `CHANGELOG.md` and blocks wait against it; `latest back` has no release before this one, says so and succeeds; the service deploy says it is not set up and stays green. Pinned in Task 2 (waiting script with no tag) and Task 3 (`latest back` with no other release).
2. A `{from …}` mark written wrong (`{from 0.22}`, `{from soon}`, `{#id from}`) fails the site's tests, naming the file and the heading; it never shows as part of a title. Pinned in Task 2.
3. A waiting story item leaves its step and the other items in place; a step, a hero part or any section the page needs by id or title that waits fails, naming it. Pinned in Task 2.
4. A pre-release, or a release whose build fails, never moves "latest" and never puts the site up. Pinned in Task 3 by the `if:` table check.
5. A stand-in that throws while loading: the seam check says `ui/e2e/fake-bridge.js would not load: …`, not 170 missing calls. Pinned in Task 1.

---

### Task 1: The seam check, and `media_url` out of the list

**Files:**
- Create: `ui/scripts/bridge-check.mjs`, `ui/scripts/bridge-check.test.mjs`, `.github/workflows/bridge.yml`
- Modify: `ui/package.json` (script), `ui/vite.config.ts:24-26` (test exclude), `ui/src/lib/api.ts:1172` and `:1737`

**Interfaces:**
- Produces, exported from `ui/scripts/bridge-check.mjs`:
  - `pyApiNames(source: string): string[]`: the members of `type PyApi = {` in `api.ts`, in order. A member is a line matching `/^  ([A-Za-z_]\w*)\s*[<(]/` between `type PyApi = {` and the first line that is `}`. Throws `ui/src/lib/api.ts has no type PyApi` when the block is missing or empty.
  - `pythonApiNames(file: string, python = process.env.PYTHON || "python3"): string[]`: runs `python -I -c <script> <file>` with `child_process.execFileSync`; the script parses with `ast`, imports nothing, finds the top-level `class Api`, and prints as JSON the names of its direct `def` and `async def` whose name has no leading `_` and none of whose decorators is `property`, `cached_property` or an attribute ending in `.setter`, `.getter` or `.deleter`. Throws `<file> has no class Api` when it is missing.
  - `fakeNames(source: string): string[]`: runs the stand-in in `node:vm` with a stand-in window (`addEventListener`, `removeEventListener`, `dispatchEvent`, `setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`, `location`, `localStorage`, `sessionStorage`, `performance`, `navigator`, `document`, `CustomEvent`, `Event`, `console`), and returns the function-valued keys of `window.__MAKE_API__()`. Any throw becomes `ui/e2e/fake-bridge.js would not load: <message>`.
  - `compare({ listed, python, fake }: { listed: string[]; python: string[]; fake: string[] }): string[]`: one line per problem, in this order and wording:
    - `<name> is in ui/src/lib/api.ts but not in Python's Api (src/rehearsal_recorder/api.py)`
    - `<name> is in ui/src/lib/api.ts but not in ui/e2e/fake-bridge.js`
    - `<name> is in ui/e2e/fake-bridge.js but not in ui/src/lib/api.ts`
    Python's public methods that the list lacks are fine.
  - Run as a script (`import.meta.url` is the entry): reads the three files from the repository, prints each problem with `::error::` in front when `GITHUB_ACTIONS` is set, exits 1 on any; otherwise prints `The interface's <n> calls are in Python and in the stand-in.`

- [ ] **Step 1: Write the failing tests** in `ui/scripts/bridge-check.test.mjs` with `node:test` and `node:assert/strict`:
  - `pyApiNames reads plain and generic calls`: a sample with `type PyApi = {`, `  get_x(): Promise<X>`, `  set_y<K extends keyof Y>(`, a four-space continuation line, a `  // note` line, `}` → `["get_x", "set_y"]`.
  - `pyApiNames names the file when PyApi is missing`: throws `/has no type PyApi/`.
  - `pythonApiNames skips private methods and properties`: a temp file with `class Api:` holding `def get_x`, `async def get_y`, `def _hidden`, `@property def ui_url`, `@ui_url.setter def ui_url`, `@staticmethod def made`, and a module-level `def outside` → `["get_x", "get_y", "made"]`.
  - `fakeNames lists the stand-in's calls`: source `window.__MAKE_API__ = () => ({ a: async () => 1, b() {}, c: 3 }); window.pywebview = { api: window.__MAKE_API__() };` → `["a", "b"]`.
  - `fakeNames says the stand-in would not load`: source `throw new Error("boom")` → throws `ui/e2e/fake-bridge.js would not load: boom`.
  - `compare names each side's missing call`: `listed ["a","b","c"]`, `python ["a","c","extra"]`, `fake ["a","b","d"]` → the three lines for `b` (Python), `c` (stand-in), `d` (list), in that order.
  - `the repository's three agree`: runs the three readers on the real files and expects `compare(...)` to be `[]`.
- [ ] **Step 2: Run them to see them fail**: `cd ui && node --test scripts/bridge-check.test.mjs`. Expected: fails, `bridge-check.mjs` not found.
- [ ] **Step 3: Write `ui/scripts/bridge-check.mjs`** to the interfaces above, with a header comment saying what it compares and why names only.
- [ ] **Step 4: Run the tests again.** Expected: all pass except `the repository's three agree`, which names `media_url is in ui/src/lib/api.ts but not in ui/e2e/fake-bridge.js`.
- [ ] **Step 5: Take `media_url` out of `api.ts`** (the member at line 1172 and its entry in `ANSWERS_WITH_A_VALUE` at line 1737). Python keeps it. Run `cd ui && node --test scripts/bridge-check.test.mjs && npx tsc -b`. Expected: all pass, no type errors.
- [ ] **Step 6: Wire it up.** `ui/package.json`: `"bridge-check": "node scripts/bridge-check.mjs"`. `ui/vite.config.ts`: `exclude: [...configDefaults.exclude, "scripts/bridge-check.test.mjs"]` with a one-line comment saying it runs in `bridge.yml` because it calls Python. `.github/workflows/bridge.yml`, name `Bridge`, on `pull_request` with `paths`: `src/rehearsal_recorder/api.py`, `ui/src/lib/api.ts`, `ui/e2e/fake-bridge.js`, `ui/scripts/bridge-check.mjs`, `ui/scripts/bridge-check.test.mjs`, `.github/workflows/bridge.yml`. One job `bridge` on `ubuntu-latest`: checkout, setup-python `3.12`, setup-node `26` (no cache, no `npm ci`), then in `ui/`: `node --test scripts/bridge-check.test.mjs` and `npm run bridge-check`. Header comment: what the seam is, what it catches, what it does not (what each call takes).
- [ ] **Step 7: Run** `cd ui && npm run bridge-check && npx vitest run scripts/design-rules.test.mjs`. Expected: `The interface's 170 calls are in Python and in the stand-in.`; the design rules' tests still run under Vitest.
- [ ] **Step 8: Commit** `Bridge: compare the interface's calls with Python and the stand-in`.

### Task 2: The site waits for versions and goes out by itself

**Files:**
- Modify: `site/src/content/markdown.ts`, `site/src/content/index.ts`, `site/src/content/stories.ts:203`, `site/src/vite-env.d.ts`, `site/content/story.md` (its top comment), `.github/actions/site/action.yml`
- Create: `site/src/content/files.ts`, `site/scripts/waiting.mjs`, `.github/workflows/site.yml`
- Test: `site/src/content/markdown.test.ts`, `site/src/content/index.test.ts`

**Interfaces:**
- Produces, in `markdown.ts`:
  - `Section = { title: string; id: string | null; from: string | null; body: string; items: Section[] }`
  - `Waiting = { id: string | null; title: string; from: string }`
  - `Doc = { title: string | null; intro: string; sections: Section[]; waiting: Waiting[] }`
  - `parseDoc(md: string, opts?: { release?: string | null; file?: string }): Doc`. A heading's braces are `{#id}`, `{from X.Y.Z}` or `{#id from X.Y.Z}`; anything else in braces at the end of a heading throws `site/content/<file>: the heading "<heading line>" ends in {<inside>}; a heading ends in {#id}, {from 0.22.0} or {#id from 0.22.0}` (no `site/content/<file>: ` prefix without `file`). With `release`, a section or item whose `from` is newer is left out and listed in `waiting`; without it, every block stays and `waiting` is `[]`.
  - `isNewer(a: string, b: string): boolean`: compares `X.Y.Z` numerically; throws `<v> is not a version like 0.22.0` for anything else.
  - `sectionsByIds` and `sectionsByTitles` throw `site/content/<file>: <{#id} or ## title> waits for <from>, but the page needs it; only a story item or a question can wait` when the id or title they need is in `doc.waiting`.
- Produces, in `files.ts` (no imports, so Node can load it): `PAGE_FILES = ["hero.md", "controller.md", "story.md", "faq.md", "download.md", "closing.md", "notfound.md"] as const`, the files the main page reads.
- Produces, in `index.ts`:
  - `doc(name: (typeof PAGE_FILES)[number], release: string | null): Doc`.
  - `readContent(tagFromRelease?: string, allBlocks = false): SiteContent`: filters by the version it shows (`displayVersion(tag)`), or not at all when `allBlocks`; a story step's ids are `ITEMS[step]` without the waiting ones.
  - `content = readContent(import.meta.env.VITE_SITE_VERSION, import.meta.env.VITE_SITE_ALL_BLOCKS === "1")`
  - `shows(from: string): boolean`: true when this build shows a block marked `from`, for content tests of a block that waits.
- Produces, `site/scripts/waiting.mjs [tag]`: imports `../src/content/markdown.ts`, `../src/content/changelog.ts` and `../src/content/files.ts` (Node strips their types). The version is `displayVersion(tag)`, or the newest in `CHANGELOG.md` without a tag. Parses each of `PAGE_FILES` with `{ release, file }`, writes each waiting block to stderr as `site/content/<file>: <title> waits for <from>`, and prints `true` or `false` on stdout. A wrong mark exits 1 with parseDoc's message.
- Produces, `.github/actions/site` inputs: `version` (the latest release's tag; empty without one), `analytics-token`, `all-blocks` (`"true"` sets `VITE_SITE_ALL_BLOCKS=1`), `artifact` (the artifact's name, default `site`).

- [ ] **Step 1: Write the failing tests in `markdown.test.ts`.** Update the existing `toEqual` shapes with `from: null` and `waiting: []`. New, under `describe("blocks that wait for a version")`:
  - `reads {from} and {#id from} in a heading`: `## Q {from 0.22.0}` and `### T {#tap from 0.22.0}` give `from: "0.22.0"`, titles `Q` and `T`, id `tap`.
  - `leaves out what is newer than the release, and lists it`: with `release: "0.21.0"` the `0.22.0` question and item are gone and `waiting` holds both; with `release: "0.22.0"` both stay and `waiting` is `[]`; with no release both stay.
  - `keeps a waiting item's step and the other items`: a step with three items, the middle one `from 0.22.0`, `release: "0.21.0"` → the step with the first and last items, and `itemsByIds` with those two ids passes.
  - `fails on a mark written wrong, naming the file and heading`: `{from 0.22}`, `{from soon}`, `{#id from}`, `{later}` each throw with `site/content/faq.md:` and the heading.
  - `fails when a block the page needs waits`: `sectionsByIds` for a waiting `{#later from 0.22.0}` throws `/\{#later\} waits for 0\.22\.0, but the page needs it/`; `sectionsByTitles` for a waiting `## eyebrow {from 0.22.0}` throws the same way.
  - `compares versions by number`: `isNewer("0.10.0", "0.9.0")` true, `isNewer("0.21.0", "0.21.0")` false, `isNewer("v1", "0.1.0")` throws.
- [ ] **Step 2: Add the failing tests to `index.test.ts`.** `has each step's items, in order` compares with `ITEMS[STEPS[i]]` without the ids in `parseDoc(story, { release }).waiting`, where `story` is `../../content/story.md?raw` and `release` is `null` when `VITE_SITE_ALL_BLOCKS` is `"1"`, else `content.version`. New:
  - `has {from} marks only in the files the main page reads`: every heading line in `site/content/**/*.md` (read with `node:fs`) with `from` inside its braces is in a file of `PAGE_FILES`.
  - `shows every block of its own version`: `shows(content.version)` is true; `shows("999.0.0")` is `import.meta.env.VITE_SITE_ALL_BLOCKS === "1"`.
- [ ] **Step 3: Run** `cd site && npx vitest run src/content/markdown.test.ts src/content/index.test.ts`. Expected: the new tests fail.
- [ ] **Step 4: Implement** `markdown.ts`, `index.ts` and `vite-env.d.ts` (`VITE_SITE_ALL_BLOCKS?: string`) to the interfaces. `readStories` (`stories.ts:203`) passes `{ file: "stories.md" }` so a wrong mark names its file. Add to `story.md`'s top comment one sentence: an item that comes with a new version ends its heading in `{#id from 0.22.0}`, and reha.stream shows it from that release on. Say the same in `markdown.ts`'s header comment.
- [ ] **Step 5: Run the same two test files, then `cd site && npm test` once** (every content file goes through the new heading rule). Expected: all pass.
- [ ] **Step 6: Write `site/scripts/waiting.mjs`** and run `node site/scripts/waiting.mjs 0.21.0` and `node site/scripts/waiting.mjs`. Expected: `false` both times (no marks today), nothing on stderr. Add `{from 9.0.0}` to a question by hand, run again: `true` and the question named on stderr; take it out.
- [ ] **Step 7: Rework `.github/actions/site/action.yml`.** Drop the `Made for Cloudflare` step and the `Counter's token, in a release` warning. `Which version` sets `VITE_SITE_VERSION` when `version` is set; a new step sets `VITE_SITE_ALL_BLOCKS=1` when `all-blocks` is `"true"`. The upload uses `inputs.artifact`. The header comment says who uses it (`site.yml`) and what the inputs mean.
- [ ] **Step 8: Write `.github/workflows/site.yml`**, name `Site`:
  - `on`: `pull_request` with `paths` `site/**`, `ui/**`, `CHANGELOG.md`, `.github/actions/site/**`, `.github/workflows/site.yml`; `push` to `main` with `paths` `site/**`, `.github/actions/site/**`, `.github/workflows/site.yml`; `workflow_dispatch` with no inputs.
  - `which` (`which release`): ubuntu, checkout with `fetch-depth: 2`, setup-node 26. Outputs `tag` (`gh release view --json tagName --jq .tagName`, empty when there is no release), `playwright` (from `site/package-lock.json` with jq, as today's step), `waiting` (`node site/scripts/waiting.mjs "$tag"`), `preview` (`true` on a pull request whose `git diff --name-only HEAD^1 HEAD` has a path under `site/`, `.github/actions/site/` or is `.github/workflows/site.yml`).
  - `site` (`site`): needs `which`, Playwright container, a step that warns `The repository variable WEB_ANALYTICS_TOKEN is not set, so reha.stream will count no visits.` when `github.event_name != 'pull_request'` and the variable is empty, then the action with `version: needs.which.outputs.tag`, `analytics-token: vars.WEB_ANALYTICS_TOKEN`; Playwright report on failure as today.
  - `site-all` (`site · after release`): pull request only, when `waiting == 'true'`; the same with `all-blocks: "true"`, `artifact: site-all`, report `site-all-playwright-report`.
  - `preview` (`site · preview`): as in today's `checks.yml`, needs `[which, site, site-all]`, runs when the pull request is from this repository, not Dependabot, `preview == 'true'`, `site` succeeded and `site-all` succeeded or was skipped; downloads `site-all` when `waiting == 'true'`, else `site`.
  - `deploy` (`site · deploy`): as in today's `release.yml`, needs `[which, site]`, runs when the event is not a pull request and `github.ref == 'refs/heads/main'`; the summary line names the tag.
  - Header comment: what starts it (a merge touching the site, the release's `latest` job, by hand) and why not `ui/` or `CHANGELOG.md` on main.
- [ ] **Step 9: Commit** `Site: blocks wait for their version, and the site goes out by itself`.

### Task 3: РЭХА's checks and release, and the interface's checks

**Files:**
- Create: `.github/workflows/reha.yml`, `.github/workflows/interface.yml`, `ui/src/icons.test.ts`
- Modify: `tests/test_platform.py:501-525`, `tests/test_platform.py:935`, `.github/actions/app/action.yml` (comment)

**Interfaces:**
- Consumes: `site.yml` from Task 2, started with `gh workflow run site.yml --ref main`.
- Produces: `reha.yml` jobs `app-macos`, `app-windows`, `latest-back`, `build-macos`, `build-windows`, `latest`; `interface.yml` jobs `playwright`, `interface-1`, `interface-2`, `interface-3`.

- [ ] **Step 1: Write `ui/src/icons.test.ts`** with the two checks from `test_platform.py:501-508`, paths from `new URL("../../packaging/…", import.meta.url)`: `ui/index.html` has `rel="icon"` and `ui/public/favicon.svg` is byte for byte `packaging/icon-small.svg`; `ui/public/logo.svg` is `packaging/icon.svg`. Run `cd ui && npx vitest run src/icons.test.ts`. Expected: PASS (the files agree today). Change one byte of a copy of `favicon.svg` by hand to see it fail, then put it back.
- [ ] **Step 2: Change `tests/test_platform.py`.** Drop lines 501-508. In the zip check, read `.github/workflows/reha.yml`; the variable becomes `workflow`. Line 935's comment names `reha.yml`. Run `python tests/test_platform.py`. Expected: FAIL, `reha.yml` missing.
- [ ] **Step 3: Write `.github/workflows/reha.yml`**, name `Reha`:
  - `on`: `pull_request` with `paths` `src/**`, `tests/**`, `tools/**`, `packaging/**`, `pyproject.toml`, `requirements.txt`, `alembic.ini`, `build.bat`, `build.command`, `service/openapi.json`, `ui/vite.config.ts`, `.github/actions/app/**`, `.github/workflows/reha.yml`; `release: types: [published]`; `workflow_dispatch` with no inputs (Rehearse the builds).
  - `app-macos`, `app-windows`: today's jobs from `checks.yml`, without `needs`, `if: github.event_name == 'pull_request'`.
  - `latest-back` (`latest back`): `if: github.event_name == 'release' && !github.event.release.prerelease`, `permissions: contents: write`, no checkout. The release before is the highest version among `gh release list --exclude-drafts --exclude-pre-releases --limit 100 --json tagName --jq '.[].tagName'` other than this tag (`grep -vxF`, `sort -V`, `tail -1`, tolerating no match). None: a notice `No release before <tag>: it stays the latest while its zips are built.` and success. Otherwise `gh release edit <previous> --latest`, then `gh release view --json tagName` must say `<previous>`, else `::error::` and exit 1.
  - `build-macos`, `build-windows`: today's jobs from `release.yml`, `needs: latest-back`, `if: ${{ !cancelled() && github.event_name != 'pull_request' && needs.latest-back.result != 'failure' }}`. The attach step becomes `gh release upload "$TAG" <zip> --repo "$GITHUB_REPOSITORY" --clobber` with `shell: bash`, `GH_TOKEN`, only on a release. The comment above the suites says the interface's tests ran on the pull requests.
  - `latest` (`latest`): `needs: [build-macos, build-windows]`, `if: github.event_name == 'release' && !github.event.release.prerelease` (both needs must succeed: no status function), `permissions: contents: write, actions: write`. `gh release edit "$TAG" --latest`, then `gh workflow run site.yml --ref main`, and a summary line.
  - Header comment: how to cut a release (today's four steps, step 4 now the hand-back and the site), the by-hand run, why two jobs and not a matrix.
- [ ] **Step 4: Run** `python tests/test_platform.py`. Expected: PASS.
- [ ] **Step 5: Check the `if:` table** by reading the five release-side jobs against it (Review Focus 4):

  | Event | latest back | builds | attach | latest, site |
  | --- | --- | --- | --- | --- |
  | release | runs | after it succeeds | yes | after both builds succeed |
  | pre-release | skipped | run | yes | skipped |
  | release, a build fails | runs | one fails | the other's | skipped |
  | release, latest back fails | fails | skipped | no | skipped |
  | Rehearse the builds | skipped | run | no | skipped |
  | pull request | skipped | skipped | no | skipped |

- [ ] **Step 6: Write `.github/workflows/interface.yml`**, name `Interface`: `on: pull_request` with `paths` `ui/**`, `packaging/icon.svg`, `packaging/icon-small.svg`, `.github/workflows/interface.yml`. `playwright` (`which playwright`, ubuntu, jq on `ui/package-lock.json`, output `version`), then today's `interface-1..3` with `needs: playwright` and the image from `needs.playwright.outputs.version`, YAML anchors as today. Header comment from today's `checks.yml` interface comment.
- [ ] **Step 7: Update the comment at the top of `.github/actions/app/action.yml`** (which jobs use it: `reha.yml`'s four).
- [ ] **Step 8: Commit** `Reha and Interface: own workflows; a release keeps the previous one latest until its zips are attached`.

### Task 4: The service's workflow, the old files out, the docs

**Files:**
- Create: `.github/workflows/service.yml`
- Delete: `.github/workflows/checks.yml`, `.github/workflows/release.yml`
- Modify: `service/README.md:74-78`, `:135-136`, `:160-196`; `docs/building.md:100-106`; `docs/pushing-to-github.md:25-40`; `CONTRIBUTING.md:112`; `docs/development.md:107`; `docs/design-notes.md:97`; `docs/design-system.md:932`; comments in `site/src/page/links.ts:2`, `site/wrangler.jsonc:3,7`, `packaging/Reha.exe.config:16`, `src/rehearsal_recorder/platform_support.py:538`, `src/rehearsal_recorder/app.py:421`, `.github/dependabot.yml:32`

- [ ] **Step 1: Write `.github/workflows/service.yml`**, name `Service`:
  - `on`: `pull_request` and `push` to `main`, both with `paths` `service/**`, `ui/**`, `.github/workflows/service.yml`; `workflow_dispatch` with no inputs.
  - `playwright` (`which playwright`): as in Interface, on `service/package-lock.json`.
  - `service` (`service`): today's job from `checks.yml`, `needs: playwright`.
  - `deploy` (`service · deploy`): `needs: service`, `if: github.event_name != 'pull_request'`, concurrency `reha-band`; checkout, setup-node 26 with the two lock files, `npm ci` in `ui` and `service`, `npm run deploy` with the two secrets and `SERVICE_DOMAIN`. No "which release" step: the service is always the branch's.
  - Header comment: what starts it, that a band's fork puts it up the same way once its token is set, that migrations are never undone.
- [ ] **Step 2: Delete `checks.yml` and `release.yml`.** Run `git grep -n "checks\.yml\|release\.yml" -- ':!docs/superpowers'`. Expected: only the lines listed under Files, which Step 3 changes.
- [ ] **Step 3: Rewrite the pages and comments.** `service/README.md`: step 7 says Actions › **Service** › **Run workflow** (main); line 136 says **Sync fork** puts the newer service up by itself; "Going live" says a merge into main that touches `service/` or `ui/` puts it up, after the service's checks, and by hand **Run workflow** puts up the branch picked. `docs/building.md` and `docs/pushing-to-github.md`: Publish builds the zips in `reha.yml`; until both are attached the release before stays “Latest”, so the download buttons and updates keep giving it; then the new one becomes “Latest” and the site goes up for it; **Rehearse the builds** is Actions › **Reha** › **Run workflow**. `CONTRIBUTING.md`, `docs/development.md`, `docs/design-notes.md`, `docs/design-system.md`: the workflow that runs it now (Reha, Interface, Site, Service or Bridge), and a short table in `docs/development.md` of which change runs what, copied from the spec's table. One sentence in `docs/development.md` on `{from 0.22.0}` and on `npm run bridge-check`. Check the longer texts with the humanizer skill.
- [ ] **Step 4: Lint the workflows.** `pip install actionlint-py` and `actionlint .github/workflows/*.yml`; if it does not install, `python -c` loading each file with `yaml.safe_load` and checking every `needs` names a job of the same file. Expected: no findings, or only ones shown to be false.
- [ ] **Step 5: Run** `python tests/test_platform.py` once more (the comment edits touch Python files). Expected: PASS.
- [ ] **Step 6: Commit** `Service: own workflow; checks.yml and release.yml go; docs`.

### After the tasks

- [ ] Whole-branch review against the spec and this plan; fix every finding, minors too, before the pull request.
- [ ] Push `claude/project-thread-wfxm3a`, open the pull request (template headings), assign `voronizer`, watch it. The pull request touches all five files, so each runs its pull request jobs once.
- [ ] After Alex's merge: `site · deploy` and `service · deploy` run on main by themselves; Alex looks at reha.stream and band.reha.stream.
- [ ] At the next release: right after Publish the download buttons give the previous version, and the new one once both zips are attached.
