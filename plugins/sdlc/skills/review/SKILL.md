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
   With no linked issue, the PR description is the spec.
3. Always launch all three reviewers, however small the diff, in parallel in one message, and wait for all three to return before writing anything (do not end your turn or post while any is still running; in a headless or CI run the session ends with your turn):
   - `sdlc:spec-reviewer` with the diff command, commits and spec.
   - `sdlc:standards-reviewer` with the diff command and commits.
   - A security pass: if the `claude-security` plugin is available use its change-scan; otherwise a read-only general-purpose subagent briefed to look only for exploitable vulnerabilities introduced by this diff, each with a concrete attack scenario.
   Tell each reviewer to search with the Grep, Glob and Read tools rather than shell pipelines, since CI permits only a narrow set of shell commands (no `grep`, `git grep` or `git fetch`; the checkout already has full history).
   Every reviewer must look beyond the diff for places the change should have touched but did not (other docs, callers, tests, config stating the same fact).
4. Report under `## Spec`, `## Standards & correctness` and `## Security`, keeping each axis's findings separate and ordered blocking first.
   End with one line: counts of blocking findings per axis and an overall `APPROVE` or `CHANGES REQUESTED` (any blocking finding means changes requested).
5. With `--comment` and a PR, post the full Markdown report, keeping its headings and line breaks, through a quoted heredoc (`gh pr comment <n> --body-file - <<'EOF'` ... `EOF`), editing your previous review comment instead of adding a new one if one exists (`gh pr comment <n> --edit-last`).
   Where an inline-comment tool is available, also attach blocking findings to their lines.
