# The Site in Every Pull Request Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pull request that changes the site puts its build on Vercel as a preview, not production, and the pull request shows GitHub's "View deployment" button for it; Vercel's Web Analytics counts visits on reha.stream only, so looking at previews does not add to the numbers.

**Architecture:** `site.yml` keeps its one build job and its production `deploy` job as they are, and gets a third job, `preview`, that runs only for a pull request from a branch of this repository: it uploads the build the `site` job made with `vercel deploy --prebuilt` (no `--prod`) and names its address as the job's `preview` environment URL, which is what makes GitHub show the button. The page's `inject()` gets a `beforeSend` that drops every event whose address is not on `reha.stream`.

**Tech Stack:** GitHub Actions, Vercel CLI 62.4.0 (already pinned in `site.yml`), `@vercel/analytics` 2.x, Vitest, Playwright.

**Spec:** Alex's answers in the project thread "Что ещё на Vercel", 2026-10-07: previews of the site for pull requests (20:19Z, "Давай"); the link as GitHub's button in the pull request and in the thread (20:20Z card, «Кнопка в PR и в чате»); analytics counts reha.stream only (20:22Z card, «Только reha.stream»). Vercel facts checked in its docs that day: Comments and the Vercel Toolbar are on for every preview on all plans; Hobby allows 100 deployments a day; `beforeSend` returning `null` drops the event.

## Global Constraints

- Previews are made for the pull requests `site.yml` already builds (changes to `site/**`, `ui/**`, `CHANGELOG.md`, `.github/workflows/site.yml`), on every push.
- A pull request from a fork or from Dependabot gets no repository secrets: it is built and tested as now, and its `preview` job is skipped, not failed.
- The production `deploy` job, its condition and its steps do not change.
- The preview uses the same Vercel CLI as production: `npx --yes vercel@62.4.0`.
- The environment is named `preview`; its URL is the address `vercel deploy` prints.
- Analytics counts a visit only when the page's host is exactly `reha.stream` (`www` is redirected there by Vercel and never serves the page).
- Previews stay behind Vercel Authentication as the project has it now: they open after logging in to Vercel.
- No new dependencies. Comments say why, in plain sentences, like the code around them. Test titles in Latin script.
- Checks: `cd site && npm test`, `npm run build && npm run test:e2e`.
- Commits end with the session's attribution lines.

## Review Focus

1. A pull request from a fork or Dependabot: the `preview` job must be skipped by its `if`, never reach the deploy step and fail on the missing token.
2. A release: the `deploy` job must run exactly as before; the build artifact is now uploaded for pull requests too, which must not change what a release uploads.
3. Two pushes close together: the older run is cancelled by the existing concurrency group; a cancelled preview leaves nothing in production.
4. The page on a preview or on `127.0.0.1` still loads Vercel's script (the existing e2e test checks it) but sends nothing.
5. On the first preview, look at the hero's frames: if the Vercel Toolbar draws itself inside the `stage.html` frames as well as on the page, say so in the thread rather than working around it in this plan.

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

Run: `cd site && npm test && npm run build && npm run test:e2e`
Expected: all pass, the existing "the page counts its visit with Vercel's analytics, the app in it does not" among them.

- [ ] **Step 5: Commit**

```bash
git add site/src/page/analytics.ts site/src/page/analytics.test.ts site/src/page/main.tsx
git commit -m "reha.stream: count visits to reha.stream only"
```

### Task 2: A preview of the site in every pull request

**Files:**
- Modify: `.github/workflows/site.yml` (header comment; the `upload-artifact` step's `if`; a new `preview` job after `deploy`)
- Modify: `docs/superpowers/specs/2026-10-06-website-design.md` (D5 and the "Publishing" list: a pull request also puts its build on Vercel as a preview)

**Interfaces:**
- Consumes: the `site` artifact the `site` job uploads (`site/dist/`).
- Produces: a `preview` environment deployment on the pull request whose URL is the preview's address.

- [ ] **Step 1: Upload the build in pull requests too.** Drop `if: github.event_name != 'pull_request'` from the `upload-artifact` step named for `site/dist/`; the failure-report upload stays as it is.

- [ ] **Step 2: Add the `preview` job.**
  - `needs: site`, `runs-on: ubuntu-latest`.
  - `if: github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository && github.actor != 'dependabot[bot]'`, with a comment saying why (secrets reach a pull request only from a branch of this repository).
  - `environment: { name: preview, url: ${{ steps.deploy.outputs.url }} }`.
  - Steps: `actions/download-artifact@v7` of `site` straight into `.vercel/output/static`; write `{"version": 3}` to `.vercel/output/config.json`; a step `id: deploy` with the three `VERCEL_*` secrets in `env` that runs `npx --yes vercel@62.4.0 deploy --prebuilt --token "$VERCEL_TOKEN"`, writes `url=<address>` to `$GITHUB_OUTPUT` and a line with the address to `$GITHUB_STEP_SUMMARY`.

- [ ] **Step 3: Update the header comment** of `site.yml`: a pull request from this repository also gets a preview on Vercel, shown in the pull request as "View deployment", behind a Vercel login, with Comments; production still changes only with a release.

- [ ] **Step 4: Update the spec**, D5 and "Publishing", with the same in one sentence each.

- [ ] **Step 5: Check the workflow reads**

Run: `python3 -c "import yaml,sys; d=yaml.safe_load(open('.github/workflows/site.yml')); print(list(d['jobs']))"`
Expected: `['site', 'deploy', 'preview']`.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/site.yml docs/superpowers/specs/2026-10-06-website-design.md
git commit -m "Site: a preview on Vercel for every pull request"
```

- [ ] **Step 7: The pull request itself is the end-to-end check.** It changes `site/` and `site.yml`, so its own run must show the `preview` job green and the "View deployment" button on the pull request; the address opens after logging in to Vercel, shows this branch's page, and has the Vercel Toolbar. Its link goes in the thread with the pull request.

## After merging

Project memory gets the convention: a thread that opens a pull request touching the site puts the preview's address in its reply alongside the pull request's.
