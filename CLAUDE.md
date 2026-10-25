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
3. Site pages tell stories, with a little humour, so the reader sees the people behind РЭХА and its service. Only real stories from Alex's band; never invent one or a detail in it.

The repository's rules beat the skills:
- The app's wording: `docs/design-system.md` F7, P2, C3, B8 (curly quotes in a title).
- Button names in bold in the guide and CHANGELOG; each CHANGELOG item starts bold, the site's news line reads it.
- English, British spelling.
- Double quotes curly “ ” in the guide, README, site and CHANGELOG; apostrophes straight. A quoted message that has quotes of its own goes in italics instead.
- Test labels: cp1252 characters only.

Skills in `.claude/skills/`, unchanged, MIT: humanizer from blader/humanizer@8c307f3, sokrati from iamursky/sokrati@6255b82.
