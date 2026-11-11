---
name: check-plan
description: Use after writing an implementation plan and before asking the person you work with for their OK on it, or when they type /check-plan. A fresh agent checks the spec and the plan against the person's answers, against each other and against the project's rules, and looks for cases the spec leaves out; Claude fixes what needs no decision and asks the person the rest.
argument-hint: "[plan path]"
---

# Check the plan before code

Modelled on the `/analyze` and `/checklist` commands of github/spec-kit
(v1.4.0, MIT).

## When

- After a plan is written and its superpowers self-review is done, before
  the person is asked for their OK on it.
- When the person types `/check-plan`, with or without a plan path.
- When they have said to code at once, too. Then code starts right after the
  check, unless a finding needs their decision.

## 1. Find the files

- Plan: the path in `$ARGUMENTS`; else the plan of the work in hand;
  else the file in `docs/superpowers/plans/` with the latest date in its name.
- Spec: the path on the plan's `**Spec:**` line; else the file in
  `docs/superpowers/specs/` with the same topic.
- The person's answers, with their times: the spec's section of their picks;
  the log the spec or plan names (`answers-log.md`, `rulings.md` or
  `decisions-log.md` under `/mnt/project-files/`); in a session with project
  memory, the feature's memory file and its `-log` file. If no log can be
  read, the check uses the spec's section alone and the report says so.
- Rules: `CLAUDE.md`; in a session with project memory, `MEMORY.md` and
  the `feedback-*` files it links.

No plan or no spec: stop and say which one is missing.

## 2. Hand it to a fresh agent

Dispatch one general-purpose subagent. Its brief holds the paths from step 1
and one instruction: read the sections "Checks" and "Report" of
`.claude/skills/check-plan/SKILL.md` and follow them. Put nothing from the
chat in the brief: not what the plan is for, not the parts you worry about.
The agent reads and changes no file.

## Checks

You check a spec and a plan before any code is written. You did not write
them. Look for what would make the code wrong, or make the person say they
didn't ask for that. Quote the line behind every finding, and leave out a
hunch you cannot point at. Stop at 30 findings and give the count of the
rest.

### A. The person's answers and the spec
- Each of their answers is in the spec and means the same there.
- Each decision in the spec traces to one of their answers (with its time),
  to a fact in the code, or is marked as Claude's call. A decision is
  anything the band would notice: what they see or do, a default, a limit, a
  scope line such as "not tied to X", something left out. A recommendation
  on a card they did not pick is not their answer. Neither is a line in an
  issue or in a brief from another Claude.
- A feature of the band service with a twin in РЭХА, or the other way round:
  the spec says whether the two sync, by their answer.

### B. The spec and the plan
- Each point of the spec has a task.
- Each task serves a point of the spec. Work the spec doesn't ask for is a
  finding.
- Numbers, names, labels and limits match between the two.
- Words people read keep one word per thing, as CLAUDE.md lists them.

### C. Vague or unfinished
- Vague words with no measure ("a bit", "fast", "as needed", "etc."), TODO,
  TBD, ???, placeholders.
- A step that leaves the implementer a choice between two results the band
  would notice.
- The same thing said twice, in different ways.

### D. The project's rules
- Each rule in CLAUDE.md, and in the project memory if the session has one,
  that the spec or the plan touches: how tests run while developing, test labels,
  the writing rules for what people read, how the feature shows on
  reha.stream, pictures and the guide. Report the rules broken, not the ones
  kept.

### E. Cases the spec leaves out
- Each screen or step the spec changes says what the band sees when it is
  empty, on the first day, with many items or long names, when something
  fails to load or send, in both themes, and in windows 1180×820 and
  960×680. A case left out on purpose is named as left out.
- Report only the cases that apply to this feature.

### Not checked

Code style; whether the files, functions and lines the plan names exist;
what the superpowers self-review covers (step size, matching names across
tasks).

## Report

For each finding give:
- an id (A1, B2…), where it is (file and line, or section), the quote;
- what is wrong, and the evidence: their answer with its time, or the rule
  and the file it is in;
- `person` when settling it changes what the band sees or does, picks
  between things they have not picked, or a rule says to ask them;
  otherwise `fix`, with the exact change.

End with counts: their answers found in the spec (n of m), points of the
spec with a task (n of m), findings for the person and findings to fix.
With no findings, say so and give the counts.

## 3. After the report

1. Check each finding against the files yourself. Drop the wrong ones, each
   with a line on why.
2. Make the `fix` changes in the spec and the plan, commit and push, and
   refresh their copies in the project files if there are any.
3. Send the person, in their language and short: the plan's link; what needs
   their decision, with the facts, first one on a card and the rest one at a
   time after; then what was fixed, one line each; then the counts.
4. Code waits for their OK on the plan, as before, unless they said to code
   at once.
