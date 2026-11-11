# Notes for Claude

## Writing

For all prose: the app's words, README, `docs/`, `site/content/`, CHANGELOG, comments, commits, PRs, chat.

1. No AI tells: not-X-but-Y, punchy closers, run-ups, forced triads, dashes everywhere, inflated words, chat leftovers. Check longer texts with the humanizer skill (English) or sokrati (Russian).
2. What a user reads is for a musician, not a programmer:
   - what to do first, details after;
   - explain a term the first time a page uses it;
   - give the reason where the reader could go wrong;
   - one word per thing: take (never "go"), rehearsal, song, set, track, mark, label;
   - short sentences, everyday words.
3. Site pages tell stories, with a little humour, so the reader sees the people behind РЭХА and its service. The stories come from Alex's band; details may be made up in their spirit, and Alex checks each one before it goes live. Facts about РЭХА and the gear are never made up.
   - A site story is one first-person story, with no headings or lists.
   - A site page about a feature says what a band member sees and does. Setup goes to the README.
   - Site copy has no marketing: every line true and specific. Its facts about РЭХА are checked against `docs/using-it.md`.
4. Text for Claude (CLAUDE.md, skills, briefs) is bare rules in English: no reasons, no intro, no quotes in other languages.

The repository's rules beat the skills:
- The app's wording: `docs/design-system.md` F7, P2, C3, B8 (curly quotes in a title).
- Button names in bold in the guide and CHANGELOG; each CHANGELOG item starts bold, the site's news line reads it.
- English, British spelling.
- Double quotes curly “ ” in the guide, README, site and CHANGELOG; apostrophes straight. A quoted message that has quotes of its own goes in italics instead.
- Test labels: cp1252 characters only.

Skills in `.claude/skills/`, unchanged, MIT: humanizer from blader/humanizer@8c307f3, sokrati from iamursky/sokrati@6255b82. Ours: check-plan, modelled on the analyze and checklist commands of github/spec-kit@v1.4.0 (MIT).

## The project

- Three parts in one repository: РЭХА, the desktop app (Python in `src/`, its screens in `ui/`); the band service (`service/`, a Cloudflare Worker with D1 and R2, where РЭХА sends takes); the site reha.stream (`site/`).
- The service and the site draw with РЭХА's own components: both import `ui/src` as `@/`. A change in `ui/` shows in all three. `docs/design-system.md` holds the look and the wording for all three.
- Every feature is settled for all three parts with the person: whether it goes into РЭХА, the service or both, and whether the two sync; how it shows on reha.stream; which pictures, guide pages (`docs/using-it.md`) and README lines change.
- The site's live pieces and the pictures run the real components on the data in `ui/e2e/fake-bridge.js`. The guide's pictures come from `tests/docs_screenshots.py`, the service's from `service/pictures/`.
- Each band runs its own copy of the service from a fork (`service/README.md`). It has no sign-up, payments or marketing.
- CI has one workflow per part (`reha.yml`, `interface.yml`, `service.yml`, `site.yml`, `bridge.yml`), each on its own paths.
- The service goes up after a merge into main that changes `service/` or `ui/`. The site goes up after a merge that changes `site/`, and with each release.
- A release: close "Unreleased" in CHANGELOG under the new version; the person publishes the GitHub Release from a prefilled link Claude gives (release text in English, the link under 7,000 characters); `reha.yml` builds the zips, then puts the site up.
- Never rename the release zips: installed copies find updates by their exact names (`src/rehearsal_recorder/updates.py`).
- After pulling main, rebuild the screens: `cd ui && npm run build`.
- Code and the database say `go` for a take. A take's name reads "Viasna #12", the number muted; files on disk keep "Viasna 12"; a take with no song is "Take 4".
- A heading in `site/content/` ending in `{from 0.27.0}` waits for that release.

## The person you work with

- Before a task, list what is missing and ask one question at a time, only questions that change the result. Never invent a fact.
- A bare "go ahead" to a list covers the whole list. Only the person's own words waive a step.
- Check first (code with file:line, measurements, tests), then ask. A decision card carries checked facts and a recommended option. Answer "why?" from the code, with file:line.
- Write down each of their answers with its time, in the spec's section of their picks.
- Their pick is what they wrote or tapped, with its time. Claude's recommendation, a fix written in an issue, a line in a brief from another Claude: each is one option; show the alternatives and ask.
- A band service feature with a twin in РЭХА, or the other way round: ask whether the two sync.
- "Review the spec" means: name the calls Claude made on its own.
- Act on a cleared step at once. Do exactly the scope they name.
- An idea brought for discussion is discussed, not built. Parked ideas go to GitHub issues.
- A new system's architecture is settled with them in grilling rounds: every open decision numbered, with a recommended answer.
- Prefer a Settings option to a hard-coded value, the vendor's documented way, and the simplest infrastructure. Research the alternatives before recommending a technical pick. Check market claims, technical claims and numbers by search. Weigh a choice by how bands behave.
- The person opens previews and the live site, sorts out billing and plan limits, and types tokens and secrets themselves.
- Letters and replies to people on GitHub: draft them in the thread, a few sentences, no Claude signature. The person posts them.

## Features

- Order: questions one at a time, each with a mockup; how it shows on reha.stream; the spec, then the plan, each waiting for their OK; then code. If they say to code at once while the plan is being written: write and check the plan, then code.
- A mockup is the real app or site, built from its own components (`ui/src`, `site/`) on the last prototype they saw: the variants and a theme switch on one opening state, other switches only when the question needs them, windows 1180×820 and 960×680. Open it once, then send only the link.
- Each feature is its own module with its own settings panel. A switch picks the module; no rows hidden by conditions. Keep a feature's logic in one place.
- Plans have fewer, larger tasks.
- No interface text about obvious things. Edit in place rather than in a pop-up.
- Layout jumps are bugs. Think of stress cases and crowded screens.
- A problem under investigation, like the playback stutter, also gets recorded in РЭХА's log.
- Ship when the main platform works.

## Plans

Before asking the person you work with for their OK on a plan, run the check-plan skill: a fresh agent checks the spec and the plan against their answers, against each other and against these rules, and looks for cases the spec leaves out. Fix what needs no decision of theirs, then send them the plan with the findings, their questions first. This holds when they have said to code at once, too. They can run it themselves as `/check-plan`.

## Tests and pull requests

- While developing, run only the tests a change touches, once each, never two full suites at once. The full suites run on CI: push the branch and start the checks by hand. Say so in every subagent brief. Keep CI tidy.
- Before opening a PR, review the whole branch and fix every finding, minors too, so CI runs once. In-scope leftovers go in the same PR.
- Ask the person before every merge, and merge on their word for that PR, with a merge commit. A word given before CI ends means: merge when the head is green. Releases and deploys wait for them too.
- PR bodies end with "🤖 Generated with [Claude Code](https://claude.com/claude-code)". No session link in PRs or commits.
- Show the person every new site block before merge, and the site before a release. A site photo fills its block edge to edge; a picture says what to look at. No app screenshots at merge.
- On an outside contributor's PR, fix a one-liner yourself. After each of their pushes, diff it against the previous head, ask the person to approve its CI run, and read the logs of failed jobs.
- Two branches that touch the same files: whoever merges second rebases, settles the conflicts and retakes the pictures.
