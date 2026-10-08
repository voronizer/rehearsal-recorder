# Site Previews, Short Links and Caching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pull request that changes the site puts its build on Vercel as a preview, not production, and shows GitHub's "View deployment" button for it; Vercel's Web Analytics counts visits on reha.stream only; `reha.stream/mac` and `reha.stream/windows` lead to the latest zips; the build's hashed files are cached by browsers for a year.

**Architecture:** The site's Vercel routing lives in one committed file, `site/vercel-config.json` (the Build Output API's `config.json`). The `site` job lays out the build with it as `.vercel/output` once and uploads that, so the production `deploy` job and a new `preview` job both only download and run `vercel deploy --prebuilt`, with and without `--prod`. The `preview` job runs only for a pull request from a branch of this repository and names its address as the `preview` environment's URL, which is what makes GitHub show the button. The page's `inject()` gets a `beforeSend` that drops every event whose address is not on `reha.stream`.

**Tech Stack:** GitHub Actions, Vercel CLI 62.4.0 (already pinned in `site.yml`), Vercel Build Output API v3 routes, `@vercel/analytics` 2.x, Vitest, Playwright.

**Spec:** Alex's answers in the project thread "Что ещё на Vercel", 2026-10-07: previews of the site for pull requests (20:19Z); the link as GitHub's button in the pull request and in the thread (20:20Z card, «Кнопка в PR и в чате»); analytics counts reha.stream only (20:22Z card, «Только reha.stream»); short links and caching in this same work, a picture for shared links and a 404 page later through a mockup (20:25Z, "Ок"). Vercel facts checked in its docs that day: Comments and the Vercel Toolbar are on for every preview on all plans; Hobby allows 100 deployments a day; `beforeSend` returning `null` drops the event; routes in `config.json` use the `vercel.json` `routes` syntax, a header route with `"continue": true` adds headers to the static file it matches; Vercel's default for static files is `Cache-Control: public, max-age=0, must-revalidate`.

## Global Constraints

- Previews are made for the pull requests `site.yml` already builds (changes to `site/**`, `ui/**`, `CHANGELOG.md`, `.github/workflows/site.yml`), on every push.
- A pull request from a fork or from Dependabot gets no repository secrets: it is built and tested as now, and its `preview` job is skipped, not failed.
- The production `deploy` job keeps its `if`, its `production` environment and its `vercel deploy --prebuilt --prod` command; only where its files come from changes.
- Both jobs use `npx --yes vercel@62.4.0`. The environment for previews is named `preview`; its URL is the address `vercel deploy` prints.
- Analytics counts a visit only when the page's host is exactly `reha.stream` (`www` is redirected there by Vercel and never serves the page).
- Short links: `/mac` and `/windows`, with or without a trailing slash, answer `307` with `Location` set to the same addresses as `MAC_ZIP` and `WINDOWS_ZIP` in `site/src/page/links.ts`. `307`, not permanent, because what "latest" means changes with every release. The page's own download buttons stay as they are.
- Caching: every file under `/assets/` (Vite's hashed output) gets `Cache-Control: public, max-age=31536000, immutable`; everything else keeps Vercel's default.
- Previews stay behind Vercel Authentication as the project has it now: they open after logging in to Vercel.
- Not in this: a picture for shared links (`og:image`), a 404 page, robots.txt.
- No new dependencies. Comments say why, in plain sentences, like the code around them. Test titles in Latin script.
- Checks: `cd site && npm test`, `npx tsc -b`, `npm run build && npm run test:e2e`.
- Commits end with the session's attribution lines.

## Review Focus

1. A pull request from a fork or Dependabot: the `preview` job must be skipped by its `if`, never reach the deploy step and fail on the missing token.
2. A release: the `deploy` job must put the same files live as before plus the routes; the `.vercel/output` laid out by the `site` job must have `static/index.html` at its top, not one folder down.
3. A route that matches too much: `/mac` must not catch `/macos` or `/mac/anything`, and the `/assets/` header must not touch `index.html` or `stage.html`, which have to stay fresh after a release.
4. The page on a preview or on `127.0.0.1` still loads Vercel's script (the existing e2e test checks it) but sends nothing.
5. On the first preview, look at the hero's frames: if the Vercel Toolbar draws itself inside the `stage.html` frames as well as on the page, say so in the thread rather than working around it here.

---

### Task 1: Analytics counts reha.stream only

**Files:**
- Create: `site/src/page/analytics.ts`
- Create: `site/src/page/analytics.test.ts`
- Modify: `site/src/page/main.tsx` (the `inject()` call and its comment)

**Interfaces:**
- Produces: `onlyOnSite<E extends { url: string }>(event: E): E | null` and `SITE_HOST = "reha.stream"`, exported from `site/src/page/analytics.ts`.

- [ ] **Step 1: Write the failing test** in `site/src/page/analytics.test.ts`

```ts
describe("onlyOnSite", () => {
  it("keeps a visit to reha.stream", () => {
    const event = { url: "https://reha.stream/#faq" }
    expect(onlyOnSite(event)).toBe(event)
  })
  it("drops a visit to a preview, the vercel.app address or a local build", () => {
    expect(onlyOnSite({ url: "https://reha-stream-a1b2c3-voronizer-2324.vercel.app/" })).toBeNull()
    expect(onlyOnSite({ url: "https://reha-stream.vercel.app/" })).toBeNull()
    expect(onlyOnSite({ url: "http://127.0.0.1:4179/" })).toBeNull()
  })
  it("goes by the host, not by the address containing the name", () => {
    expect(onlyOnSite({ url: "https://reha.stream.example.com/" })).toBeNull()
    expect(onlyOnSite({ url: "https://example.com/?from=reha.stream" })).toBeNull()
  })
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `cd site && npx vitest run src/page/analytics.test.ts`
Expected: FAIL, cannot resolve `./analytics`.

- [ ] **Step 3: Implement `onlyOnSite` in `site/src/page/analytics.ts`**, comparing `new URL(event.url).hostname` with `SITE_HOST`, then pass it in `main.tsx` as `inject({ beforeSend: onlyOnSite })`. The comment above the call gains one sentence: previews of pull requests load the same page, and only reha.stream's visitors are counted.

- [ ] **Step 4: Run the site's checks**

Run: `cd site && npm test && npx tsc -b && npm run build && npm run test:e2e`
Expected: all pass, the existing "the page counts its visit with Vercel's analytics, the app in it does not" among them.

- [ ] **Step 5: Commit**

```bash
git add site/src/page/analytics.ts site/src/page/analytics.test.ts site/src/page/main.tsx
git commit -m "reha.stream: count visits to reha.stream only"
```

### Task 2: Short links and a year's cache, in the site's own Vercel config

**Files:**
- Create: `site/vercel-config.json`
- Create: `site/src/page/vercel-config.test.ts`
- Modify: `.github/workflows/site.yml` (the `site` job lays out `.vercel/output`; the `deploy` job downloads it; header comment)

**Interfaces:**
- Consumes: `MAC_ZIP`, `WINDOWS_ZIP` from `site/src/page/links.ts`.
- Produces: an artifact named `site` whose top holds `config.json` and `static/` (the Build Output API's `.vercel/output`), uploaded on every run, pull requests included. Task 3 downloads it.

- [ ] **Step 1: Write the failing test** in `site/src/page/vercel-config.test.ts`. It reads the file with Vite's `?raw` import (`import raw from "../../vercel-config.json?raw"`) and `JSON.parse`s it, so no Node types are needed.

```ts
const config = JSON.parse(raw)
const route = (path: string) => config.routes.find((r) => new RegExp(r.src).test(path))

describe("vercel-config.json", () => {
  it("is a Build Output API v3 config", () => {
    expect(config.version).toBe(3)
  })
  it("sends /mac and /windows to the latest zips, for now", () => {
    for (const [path, zip] of [["/mac", MAC_ZIP], ["/mac/", MAC_ZIP], ["/windows", WINDOWS_ZIP], ["/windows/", WINDOWS_ZIP]]) {
      expect(route(path)).toMatchObject({ status: 307, headers: { Location: zip } })
    }
  })
  it("leaves other addresses that start the same alone", () => {
    expect(route("/macos")).toBeUndefined()
    expect(route("/mac/x")).toBeUndefined()
    expect(route("/windowsx")).toBeUndefined()
  })
  it("caches the build's hashed files for a year, and nothing else", () => {
    expect(route("/assets/index-Bx1y2z3.js")).toMatchObject({
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
      continue: true,
    })
    expect(route("/")).toBeUndefined()
    expect(route("/index.html")).toBeUndefined()
    expect(route("/stage.html")).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `cd site && npx vitest run src/page/vercel-config.test.ts`
Expected: FAIL, cannot find `vercel-config.json`.

- [ ] **Step 3: Write `site/vercel-config.json`**: `{"version": 3, "routes": [...]}` with three routes, `src` anchored with `^…$`: `^/mac/?$` and `^/windows/?$` with `status: 307` and `headers.Location` as the constraints say, and `^/assets/.+$` with the `Cache-Control` header and `"continue": true`.

- [ ] **Step 4: Run the site's checks**

Run: `cd site && npm test && npx tsc -b`
Expected: all pass.

- [ ] **Step 5: Lay out once, in the `site` job.** Replace the `site/dist/` upload (whose `if` skipped pull requests) with a step "Lay out the build for Vercel" that makes `site/vercel-output/static/` from `site/dist/` and copies `site/vercel-config.json` to `site/vercel-output/config.json`, then upload `site/vercel-output/` as `site` on every run. In `deploy`, download `site` straight into `.vercel/output` and drop its own lay-out step. Add a sentence to the header comment: the routes (short links, caching) are in `site/vercel-config.json`.

- [ ] **Step 6: Check the workflow reads, and the layout**

Run: `python3 -c "import yaml; d=yaml.safe_load(open('.github/workflows/site.yml')); print(list(d['jobs']))"` and the new lay-out step's commands by hand after `npm run build`, then `ls site/vercel-output site/vercel-output/static | head`.
Expected: `['site', 'deploy']`; `config.json` and `static` at the top, `index.html`, `stage.html` and `assets` in `static`. Remove `site/vercel-output/` afterwards and add it to `site/.gitignore`.

- [ ] **Step 7: Commit**

```bash
git add site/vercel-config.json site/src/page/vercel-config.test.ts site/.gitignore .github/workflows/site.yml
git commit -m "reha.stream: /mac and /windows, and a year's cache for the build's files"
```

### Task 3: A preview of the site in every pull request

**Files:**
- Modify: `.github/workflows/site.yml` (a new `preview` job after `deploy`; header comment)
- Modify: `docs/superpowers/specs/2026-10-06-website-design.md` (D5 and "Publishing": a pull request also puts its build on Vercel as a preview; the routes file)

**Interfaces:**
- Consumes: the `site` artifact from Task 2.
- Produces: a `preview` environment deployment on the pull request whose URL is the preview's address.

- [ ] **Step 1: Add the `preview` job.**
  - `needs: site`, `runs-on: ubuntu-latest`.
  - `if: github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository && github.actor != 'dependabot[bot]'`, with a comment saying why (secrets reach a pull request only from a branch of this repository).
  - `environment: { name: preview, url: ${{ steps.deploy.outputs.url }} }`.
  - Steps: download `site` into `.vercel/output`; a step `id: deploy` with the three `VERCEL_*` secrets in `env` that runs `npx --yes vercel@62.4.0 deploy --prebuilt --token "$VERCEL_TOKEN"`, writes `url=<address>` to `$GITHUB_OUTPUT` and a line with the address to `$GITHUB_STEP_SUMMARY`.

- [ ] **Step 2: Update the header comment** of `site.yml`: a pull request from this repository also gets a preview on Vercel, shown in the pull request as "View deployment", behind a Vercel login, with Comments; production still changes only with a release.

- [ ] **Step 3: Update the spec**, D5 and "Publishing", with the same in one sentence each, and name `site/vercel-config.json` as where the routes are.

- [ ] **Step 4: Check the workflow reads**

Run: `python3 -c "import yaml; d=yaml.safe_load(open('.github/workflows/site.yml')); print(list(d['jobs']))"`
Expected: `['site', 'deploy', 'preview']`.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/site.yml docs/superpowers/specs/2026-10-06-website-design.md
git commit -m "Site: a preview on Vercel for every pull request"
```

- [ ] **Step 6: The pull request itself is the end-to-end check.** It changes `site/` and `site.yml`, so its own run must show the `preview` job green and the "View deployment" button on the pull request. On the preview, after logging in to Vercel: this branch's page with the Vercel Toolbar; `/mac` and `/windows` start the zips' downloads; a file under `/assets/` answers with the year-long `Cache-Control`. The link goes in the thread with the pull request.

## After merging

Project memory gets the convention: a thread that opens a pull request touching the site puts the preview's address in its reply alongside the pull request's.
