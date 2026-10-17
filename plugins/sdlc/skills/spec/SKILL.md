---
name: spec
description: Turn an idea, bug report or GitHub issue into a written spec with testable acceptance criteria, saved on the GitHub issue. Use at the start of any feature or bug fix, or when an issue is too vague to implement.
argument-hint: "[issue-number | description]"
---

Goal: a spec precise enough that a reviewer can check the finished diff against it line by line.

1. Gather the input.
   If `$ARGUMENTS` is an issue number, read it with `gh issue view $ARGUMENTS --comments`.
   Otherwise treat it as the description.
2. Ground it in the code.
   Read the relevant CLAUDE.md sections and code so the spec uses the repo's real names and respects its documented decisions.
   For a bug, reproduce it end to end the way a user would hit it (use the repo's verify/run skill) before writing anything, and record the exact steps and observed vs expected behaviour.
3. Ask the user only the questions whose answers change the behaviour, at most 4, in one round, with a recommended answer for each.
   Decide everything else yourself and list it under Decisions.
4. Write the spec in this shape:

```markdown
## Problem
Who is affected and what happens today (for bugs: repro steps, observed, expected).

## Goal
One or two sentences.

## Acceptance criteria
- [ ] Observable, testable statements. Each one maps to a test or an E2E check.

## Out of scope
Things a reasonable reader might assume are included but are not.

## Decisions
Choices made while writing this spec, with a one-line reason each.

## Verification
The E2E flow(s) that prove it, platforms included.
```

5. Save it: update the issue body (`gh issue edit <n> --body-file`) if it is empty or a stub, otherwise add it as a comment headed `Spec`.
   With no issue, create one: `gh issue create --title ... --body-file ...`.
   Print the issue URL.
