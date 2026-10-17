---
name: review
description: Review a branch or PR on three independent axes - spec (does it do what the issue asked), standards and correctness, and security - using parallel read-only subagents. Use before merging, or in CI with --comment to post the result on the PR.
argument-hint: "[base-ref | PR-number] [--comment]"
---

1. Resolve what to review.
   - A PR number: `gh pr view <n> --json baseRefName,headRefName,body,closingIssuesReferences`, check it out with `gh pr checkout <n>` if it is not already checked out, and diff against `origin/<base>`.
   - A ref: diff against it.
   - Nothing: diff against the merge-base with the default branch (`git merge-base HEAD origin/HEAD`).
   Use `git diff <base>...HEAD` and `git log <base>..HEAD --oneline`. Stop if the diff is empty.
2. Find the spec: issues referenced by the PR or commits (`Closes #n`, `#n`), then `gh issue view <n> --comments`.
3. Launch in parallel, in one message:
   - `sdlc:spec-reviewer` with the diff command, commits and spec (skip it if there is no spec, and say so).
   - `sdlc:standards-reviewer` with the diff command and commits.
   - A security pass: if the `claude-security` plugin is available use its change-scan; otherwise a read-only general-purpose subagent briefed to look only for exploitable vulnerabilities introduced by this diff, each with a concrete attack scenario.
4. Report under `## Spec`, `## Standards & correctness` and `## Security`, keeping each axis's findings separate and ordered blocking first.
   End with one line: counts of blocking findings per axis and an overall `APPROVE` or `CHANGES REQUESTED` (any blocking finding means changes requested).
5. With `--comment` and a PR, post the report with `gh pr comment <n> --body-file <file>`, editing your previous review comment instead of adding a new one if one exists (`gh pr comment <n> --edit-last`).
   Where an inline-comment tool is available, also attach blocking findings to their lines.
