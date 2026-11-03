# reha.stream on Cloudflare: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** reha.stream is served by a Cloudflare Worker made of the site's files, put up by the release; previews go to a separate Worker; Cloudflare Web Analytics counts visits; nothing of Vercel is left in the repository.

**Architecture:** `site/wrangler.jsonc` describes the Worker `reha-stream` (static assets from `dist/`, `404-page`, custom domain reha.stream, workers.dev off) and an environment `preview` (Worker `reha-stream-preview`, no routes, version URLs on). Vite writes `_redirects` and `_headers` into `dist/`. The site's browser tests run on `wrangler dev`, so they see Cloudflare's own handling of addresses. `.github/actions/site` lays out `dist/`, `wrangler.jsonc` and the wrangler version from the lock file as the artifact; `release.yml` deploys it with `wrangler deploy --env=""`, `checks.yml` uploads a version of `reha-stream-preview` with the alias `pr-<number>`. The counter is Cloudflare's beacon, added by the page itself only on reha.stream, with the token from the repository variable `WEB_ANALYTICS_TOKEN`.

**Tech Stack:** Vite + React site (`site/`), Wrangler 4.156.0 (the service's version), GitHub Actions, Playwright, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-03-site-on-cloudflare-design.md` (approved by Alex, 3 November 10:56).

## Global Constraints

- The Worker names: `reha-stream` (the site) and `reha-stream-preview` (previews only). Only `release.yml`'s deploy job ever runs `wrangler deploy` on the default environment, and it says `--env=""` out loud; every command in `checks.yml` says `--env preview`.
- Wrangler 4.156.0 everywhere, as in `service/package.json`. One source for it in the site: `site/package-lock.json`; the jobs that have no `node_modules` read the version the artifact carries.
- `_redirects`: `/mac` and `/mac/` 307 to `https://github.com/voronizer/rehearsal-recorder/releases/latest/download/RehearsalRecorder-macos.zip`, the same for `/windows` and `RehearsalRecorder-windows.zip`. The zip names never change (`src/rehearsal_recorder/updates.py`).
- `_headers`: `/assets/*` gets `Cache-Control: public, max-age=31536000, immutable`.
- The counter: `https://static.cloudflareinsights.com/beacon.min.js` with `data-cf-beacon='{"token":"…"}'`, added only when the token is set and `location.hostname` is exactly `reha.stream`; only on the main page and the pages from `src/stories/main.ts` (stories, band service). Never in `stage`, `og`, `404`.
- The deploy fails, red, without `CLOUDFLARE_API_TOKEN`: unlike the service, the site must go up with a release.
- Comments and prose follow CLAUDE.md "Writing": no AI tells, British spelling, curly quotes in prose files. Test titles: cp1252 only.
- No CHANGELOG item for the move. This pull request closes Unreleased as 0.21.0 (it holds #122, a new feature), so Alex can publish right after the merge.
- While building, run only the tests a change touches, once each. The full suites run once, on CI.

## Review Focus

1. No path from a pull request to the `reha-stream` Worker: every `wrangler` call in `checks.yml` has `--env preview`, and `env.preview` sets `routes: []`, so `reha.stream` can't be attached to the preview Worker either (Task 3; a dry run shows the name and no routes).
2. **Put the site up again** for 0.20.0, whose `site/` has no `wrangler.jsonc`, stops with a clear message instead of deploying something half-made (Task 3).
3. The beacon appears only on reha.stream, never on 127.0.0.1, a preview host or in a frame (Task 2 unit tests and e2e).
4. Every row of the spec's address table holds on `wrangler dev` (Task 1 e2e).
5. The release deploy replaces the A record and attaches reha.stream with the existing token: not testable before the release. If it fails, the old record stays and the site stays on Vercel (spec, "Not known yet").

---

### Task 1: The site as Cloudflare files, tested on Cloudflare's server

**Files:**
- Create: `site/wrangler.jsonc`
- Create: `site/cloudflare/_redirects`, `site/cloudflare/_headers`
- Modify: `site/vite.config.ts` (a plugin that copies the two files into the build; comments that name Vercel)
- Modify: `site/package.json`, `site/package-lock.json` (add `wrangler` 4.156.0 exact as a dev dependency)
- Modify: `site/playwright.config.ts` (webServer: `wrangler dev`)
- Modify: `site/src/page/LiveFrame.tsx` (`/stage#…`), `site/src/frame.ts` (comment)
- Modify: `site/e2e/stage.spec.ts` (`/stage#…`), `site/e2e/notfound.spec.ts`, `site/e2e/stories.spec.ts` (comment)
- Create: `site/e2e/addresses.spec.ts`
- Delete: `site/vercel-config.json`, `site/src/page/vercel-config.test.ts`
- Modify: `site/404.html`, `site/content/stories.md` (comments), `site/.gitignore` (`.wrangler/`; drop `.vercel/`, `vercel-upload/`, add `upload/`)

- [ ] **Step 1: wrangler.jsonc**

```jsonc
// reha.stream: the site's built files, served by Cloudflare as they are,
// with _redirects and _headers from the build (site/cloudflare/). No code
// runs. The release puts it up (release.yml, site · deploy); a pull
// request's preview goes to the Worker of the environment "preview",
// never to this one (checks.yml, site · preview).
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "reha-stream",
  "compatibility_date": "2026-10-15",
  "assets": {
    "directory": "./dist",
    "html_handling": "auto-trailing-slash",
    "not_found_handling": "404-page"
  },
  "workers_dev": false,
  "preview_urls": false,
  "routes": [{ "pattern": "reha.stream", "custom_domain": true }],
  "env": {
    // reha-stream-preview: no address of its own, only each pull
    // request's version address. routes is set empty so reha.stream can
    // never come along from the top.
    "preview": { "routes": [], "workers_dev": false, "preview_urls": true }
  }
}
```

- [ ] **Step 2: _redirects and _headers**, exactly as in Global Constraints, each with a comment line at the top saying what it is for. The plugin in `vite.config.ts` reads both from `site/cloudflare/` and `emitFile`s them at the build's root (the build's `publicDir` is `ui/public`, shared with the app, so they can't go there).

- [ ] **Step 3: frames load `/stage`.** `LiveFrame.tsx:174` `src={`/stage#${f.hash}`}`. `og/main.tsx` keeps `/stage.html#hero`: `scripts/og.mjs` photographs it on Vite's preview server, and nobody visits that page. Check that `npm run dev` still opens `/stage` (Vite's dev server maps `/stage` to `stage.html`); if it doesn't, say so in the report and keep `stage.html` in the frames.

- [ ] **Step 4: tests on `wrangler dev`.** `playwright.config.ts` webServer: `command: "wrangler dev --env= --port 4179 --ip 127.0.0.1"`, `url: http://127.0.0.1:4179/`, env `WRANGLER_SEND_METRICS=false`. Run the suites that the change touches (`stage`, `notfound`, `stories`, `page`) once, with a throwaway config that sets the container's Chromium (`/opt/pw-browsers/chromium`; not committed).

- [ ] **Step 5: `addresses.spec.ts`**, one test per row of the spec's table, with `request` and `maxRedirects: 0`: `/` 200; `/mac`, `/mac/`, `/windows` 307 with the GitHub location; `/stories`, `/stories/metronome`, `/band-service` 200; `/stories/` and `/stories.html` 307 to `/stories`; an `/assets/` file has the year's cache header; `/no-such-take` 404 with the 404 page's words; `/MAC` 404. `notfound.spec.ts` opens a missing address instead of `/404.html`, so it sees the status Cloudflare gives.

- [ ] **Step 6: remove `vercel-config.json` and its test; comments.** Say in `content/stories.md` that a new story needs nothing more: Cloudflare finds `stories/<name>.html` by itself.

- [ ] **Step 7: commit** `reha.stream as Cloudflare files: _redirects, _headers, tests on wrangler dev`.

### Task 2: Counting visits with Cloudflare Web Analytics

**Files:**
- Modify: `site/src/page/analytics.ts` (`beaconFor(host, token)` pure, `countVisits()` adds the script), `site/src/page/analytics.test.ts`
- Modify: `site/src/page/main.tsx`, `site/src/stories/main.ts` (call `countVisits()` instead of Vercel's two)
- Modify: `site/src/vite-env.d.ts` (`VITE_WEB_ANALYTICS_TOKEN?`)
- Modify: `site/package.json`, `site/package-lock.json` (remove `@vercel/analytics`, `@vercel/speed-insights`)
- Modify: `site/e2e/page.spec.ts:724-731`, `site/e2e/stories.spec.ts:272-280`

- [ ] **Step 1: unit tests first.** `beaconFor("reha.stream", "abc")` gives the script address and `{"token":"abc"}`; `null` for `127.0.0.1`, `pr-1-reha-stream-preview.x.workers.dev`, `www.reha.stream`, `reha.stream.evil.com` and for an empty token. Run, see them fail.
- [ ] **Step 2: `analytics.ts`.** `beaconFor` as above; `countVisits(token = import.meta.env.VITE_WEB_ANALYTICS_TOKEN)` adds `<script defer src=… data-cf-beacon=…>` to `document.head` when `beaconFor(location.hostname, token)` says so. Comment: why only here and not Cloudflare's own injection (frames would each count). Unit tests pass.
- [ ] **Step 3: e2e.** Replace the two Vercel tests: on `127.0.0.1` the page, a story and the band service page add no `cloudflareinsights` script, nor do the frames.
- [ ] **Step 4: commit** `Count visits with Cloudflare Web Analytics, only on reha.stream`.

### Task 3: CI: build for Cloudflare, previews, the release's deploy

**Files:**
- Modify: `.github/actions/site/action.yml` (input `analytics-token`; lay out `site/upload/` with `dist/`, `wrangler.jsonc`, `wrangler-version`; header comment)
- Modify: `.github/workflows/checks.yml` (site job passes `analytics-token: ${{ vars.WEB_ANALYTICS_TOKEN }}`; `preview` job; header comments)
- Modify: `.github/workflows/release.yml` (site job passes the token; `deploy` job; the header's "Put the site up again" text)
- Modify: `.github/dependabot.yml` (comment)

- [ ] **Step 1: the action.** Pass the input to the build as `VITE_WEB_ANALYTICS_TOKEN`. Replace "Lay out the build for Vercel" with "Lay out the build for Cloudflare": if `site/wrangler.jsonc` is missing, `::error::` "This release's site was made for Vercel; put it up with a newer release." and stop; else copy `site/dist` to `site/upload/dist`, `site/wrangler.jsonc` to `site/upload/`, and write the wrangler version from `site/package-lock.json` (`packages["node_modules/wrangler"].version`, with Node, the image has no jq) to `site/upload/wrangler-version`. Upload `site/upload/` as the artifact `site`.
- [ ] **Step 2: the release's deploy.** Download into `site`; fail without `CLOUDFLARE_API_TOKEN`; `cd site && npx --yes "wrangler@$(cat wrangler-version)" deploy --env=""` with `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `WRANGLER_SEND_METRICS=false`; the summary line says the tag and https://reha.stream. Concurrency and the `production` environment as now. The comment above the job says what the deploy does to DNS (replaces the record for reha.stream) and that www is a rule in Cloudflare, not here.
- [ ] **Step 3: the preview.** Same `if:` as now. `wrangler deploy --env preview` (makes `reha-stream-preview` the first time, keeps its version URLs on), then `wrangler versions upload --env preview --preview-alias "pr-$PR"` with `WRANGLER_OUTPUT_FILE_PATH`; read `preview_alias_url` from the `version-upload` line of that file; no address there means the account has no workers.dev subdomain: `::error::` saying so. `url=` output for the `preview` environment.
- [ ] **Step 4: check without Cloudflare.** `wrangler deploy --dry-run --env preview` and `--env=""` in `site/` after a build: the names `reha-stream-preview` and `reha-stream`, routes only on the second. `actionlint` on both workflows if it is at hand; YAML parses.
- [ ] **Step 5: commit** `CI puts reha.stream up on Cloudflare and previews on reha-stream-preview`.

### Task 4: Spec, plan, CHANGELOG

- [ ] **Step 1:** copy the spec and this plan into `docs/superpowers/specs/2026-11-03-site-on-cloudflare-design.md` and `docs/superpowers/plans/2026-11-03-site-on-cloudflare.md`.
- [ ] **Step 2:** close Unreleased in `CHANGELOG.md` as `## 0.21.0`. No item for the move.
- [ ] **Step 3: commit** `Spec and plan for reha.stream on Cloudflare; CHANGELOG for 0.21.0`.

### After the tasks

- Grep the repository (outside `docs/superpowers/` and old CHANGELOG entries) for `vercel`, `Vercel`, `_vercel`: none left.
- A full review of the branch, minors fixed, then the pull request. CI runs once.
- The pull request's preview: tell Alex its address. He looks the site over there (spec step 4) and sets `WEB_ANALYTICS_TOKEN` before the merge (spec steps 2 and 3).
- Merge on Alex's word. Then the release link for 0.21.0; after the release run, Alex checks reha.stream; a day later he deletes the Vercel project and secrets.
