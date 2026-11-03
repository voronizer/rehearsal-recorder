# reha.stream on Cloudflare

reha.stream moves from Vercel to Cloudflare, where its DNS and the band
service already are. A visitor sees the same page at the same addresses.
What changes is where the files sit, how a release puts them up, how visits
are counted, and where a pull request's preview opens.

Alex approved this spec on 3 November at 10:56 («вроде остальное ок»).

## Alex's picks

All on 3 November 2026, in the thread «Перенести reha.stream на Cloudflare».

- 09:58 «давай reha.stream перенесем на клаудфларе».
- 10:25 Workers, not Pages (card).
- 10:29 Cloudflare Web Analytics counts visits and loading speed (card).
  Not Umami or Plausible, not nothing.
- 10:30 A pull request's preview opens at an open address, with no
  sign-in (card).
- 10:31 A release right after the pull request is merged (card). It also
  ships the deleting of takes and songs in the service (#122), which is
  waiting in Unreleased.
- 10:33 «версел не нужен будет больше», kept only while DNS settles: a day
  after the switch, then the Vercel project goes.
- 10:41 «переносим и www тоже»; 10:43 «нафига воркер, проще нельзя
  сделать?»: www by a redirect rule in Cloudflare, no Worker for it.

## Where the site lives

A second Worker on Alex's Cloudflare account, `reha-stream`, beside the
band service's `reha-band`. It has no code of its own: Cloudflare serves the
site's built files and follows two plain files that go up with them,
`_redirects` and `_headers`. Requests for such files are free and have no
daily limit (Cloudflare, "Billing and limitations", read 3 November).

The Worker answers at reha.stream only. Its own workers.dev address is
off; previews have their own addresses (below).

## What each address does

Checked on Cloudflare's local server (`wrangler dev`, the version the
service uses, 4.156.0) with files laid out as the site's build lays them.

| Address | Today on Vercel | On Cloudflare |
|---|---|---|
| `/` | the page | the same |
| `/mac`, `/windows` | 307 to the latest zip on GitHub | the same, from `_redirects` |
| `/stories`, `/stories/metronome` and the other stories, `/band-service` | the page | the same |
| the same with a slash at the end, `/stories/` | the page | 307 to the address without the slash |
| `/stories.html`, `/stage.html` and every other `.html` | the file | 307 to the address without `.html` |
| `/assets/…` (the build's files) | cached a year | the same, from `_headers` |
| an address that is no file | the site's 404 page, status 404 | the same |
| `/MAC` in capitals | 307 to the zip | the 404 page |

The page's frames load `stage.html` today. They will load `/stage`, so a
frame doesn't take a redirect first.

## www.reha.stream

www.reha.stream sends the visitor to the same address on reha.stream
with a permanent redirect (Alex, 10:41 «переносим и www тоже»; 10:43 «нафига
воркер, проще нельзя сделать?»).

Cloudflare does it with a redirect rule, set once in the dashboard, with
no code and nothing in the repository (step 1 at the end). The rule works
on Cloudflare's side before any server is asked, so it doesn't care where
the www record points. Alex can set it up now: www then sends visitors to
reha.stream while it is still on Vercel, and keeps doing so after the
switch. The release doesn't touch www.

Done on 3 November at 10:52: Alex's `curl -sI https://www.reha.stream/stories`
gave `301`, `Location: https://reha.stream/stories`, `Server: cloudflare`.
The template's 301 stays: like 308 it says "moved for good", and the two
differ only for forms, which the site has none of.

## Counting visits

Cloudflare Web Analytics replaces both Vercel Web Analytics and Speed
Insights: one script counts the visits and measures how fast the page
loads for them (Core Web Vitals). It sets no cookies. It is free, with no
limit on page views.

The script goes on the same pages as today: the main page, the stories and
the band service's page. A visit is one view however many frames of the
app it shows, so the frames, the 404 page and the link picture's page have
no script. It loads only on reha.stream, never on a preview or a build on a
computer.

Cloudflare can also put the script into every page by itself. That would
count each frame as a page view, so Alex picks the manual way in the
dashboard, and the site adds the script itself. The script needs the
site's token from Cloudflare, which is public by design, since every
visitor's browser sees it. It lives in the repository's settings as the
variable `WEB_ANALYTICS_TOKEN`, so Alex types it himself. Without it the
site builds with no counter.

The numbers Vercel collected stay in Vercel and go with the project.

## Previews

A pull request that changes the site gets a preview, as today, at an
address of its own on workers.dev, such as
`https://pr-123-reha-stream-preview.<Alex's subdomain>.workers.dev`.
Anyone with the link can open it. The pull request shows it as "View deployment", as now.
A preview never touches reha.stream. Each page names reha.stream as its
real address (the canonical link it already has), so a search engine that
finds a preview counts it for reha.stream.

Vercel's comment toolbar on previews goes away.

Previews live in a Worker of their own, `reha-stream-preview`, with no
address but the previews'. A pull request never puts anything into the
site's Worker, so no mistake in a preview job can reach reha.stream. The
first preview, this pull request's, makes that Worker, so Alex can open
the site on Cloudflare before the release.

## The switch

1. The pull request is merged.
2. Alex publishes the release from Claude's link.
3. The release's site job builds and tests the site as now. The deploy job
   then puts it up with `wrangler deploy` instead of `vercel deploy`, with
   the token the service already uses (`CLOUDFLARE_API_TOKEN`,
   `CLOUDFLARE_ACCOUNT_ID`).
4. In that deploy Cloudflare gives reha.stream to the Worker and replaces
   the record that points at Vercel. Wrangler does this by itself when it
   runs in CI (read in its source, 4.156.0). There is no gap: the old
   record serves until the new one does.
5. Other DNS servers may keep the old record for its TTL (5 minutes for
   TTL Auto). Some keep it longer, which is why Vercel stays a day.

If the deploy fails, the old record stays, and so does the site on Vercel.

To go back to Vercel within that day: remove reha.stream from the Worker
in the dashboard and put back the A record `216.198.79.1`, DNS only.

By hand, **Put the site up again** works for this release and the ones
after it. For an older release it stops with a message that its site was
made for Vercel.

## What goes from the repository

Everything Vercel: `site/vercel-config.json` and its test, the
`@vercel/analytics` and `@vercel/speed-insights` packages, the Vercel steps
in `checks.yml`, `release.yml` and `.github/actions/site`, and the comments
that name Vercel. Older CHANGELOG entries stay as they were written.

## Alex's steps

Any time, best now:

1. www: in DNS › Records, edit the www record and turn its proxy on (the
   orange cloud); then Rules › Overview › Templates › **Redirect from WWW
   to Root**. Done 3 November, 10:52.

Before the merge:

2. Cloudflare dashboard › Web Analytics › **Add a site**, pick reha.stream.
   In **Manage site** pick **Enable with JS Snippet installation**, so
   Cloudflare doesn't add a second script. Copy the token from the snippet.
3. GitHub › repository › Settings › Secrets and variables › Actions ›
   Variables › **New repository variable**: `WEB_ANALYTICS_TOKEN`, the token.
4. Open this pull request's preview and look the site over.

After the release:

5. Open reha.stream and www.reha.stream, try /mac and /windows.
6. A day later: delete the Vercel project `reha-stream` and the secrets
   `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` on GitHub.

Dashboard names are from Cloudflare's docs; Claude can't see the dashboard.

## Calls Claude made on its own

- The Worker's name `reha-stream`, after the Vercel project's.
- Files only, no code: `_redirects` and `_headers` cover the short links
  and the cache, so nothing runs per request.
- A slash at the end and `.html` now redirect (Cloudflare's default)
  instead of serving the same page at two addresses. Vercel could match
  `/MAC` in capitals; Cloudflare can't, and nobody types it.
- The counter's token in a repository variable, not written into the code,
  so Alex sets it without sending it to Claude.
- The site's browser tests run on Cloudflare's local server (`wrangler dev`)
  instead of Vite's, so they check the real addresses. This replaces the
  test that imitated Vercel's routes.
- Previews in their own Worker, `reha-stream-preview`, made by the first
  preview; the site's Worker is made by the release. (The first version of
  this spec had this pull request's preview make the site's Worker; Claude
  changed it before the plan, so a pull request can never reach
  reha.stream.)
- No CHANGELOG item: nothing changes for someone using РЭХА or the site.

## Not known yet

- Whether the token may replace an existing DNS record. It created
  band.reha.stream's, which had none. If it may not, the deploy fails, the
  site stays on Vercel, and Alex adds DNS edit to the token.
- Whether Alex's account has a workers.dev subdomain, which previews need.
  The first preview says so if it doesn't.
