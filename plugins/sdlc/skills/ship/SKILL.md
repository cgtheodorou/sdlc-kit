---
name: ship
description: Take one change from issue to merge-ready PR - spec, plan, isolated branch, implement, gates, end-to-end verification, three-axis review, PR. Use when asked to implement, fix or build something in a repo adopted with the sdlc kit.
argument-hint: "[issue-number | description]"
---

Run every phase in order. Do not skip a phase because the change looks small; scale its depth instead.
Steps 6 and 7 are never optional: a small, metadata-only or docs-only change still gets a verifier run and all three reviewers, and CI or the PR review workflow does not replace them.

## 1. Spec
If `$ARGUMENTS` is an issue that already has a spec with acceptance criteria, use it.
Otherwise run the `sdlc:spec` skill first.
For a bug, the spec must contain a confirmed end-to-end reproduction.

## 2. Plan
Launch the `sdlc:planner` agent with the spec.
For anything beyond a few lines, show the user the plan's Approach and Open questions and wait for answers to the open questions.
If there are none, continue.
When running non-interactively (for example from an `@claude` mention in CI), do not wait: pick the most conservative answer to each open question and list it under "Assumptions" in the PR body.

## 3. Branch
Work in an isolated worktree on a branch named `<type>/<issue>-<slug>` (`feat/42-voice-ptt`, `fix/57-upload-stall`) off the freshly fetched default branch.
Use EnterWorktree if available, otherwise `git worktree add`.
Never commit on the default branch, and never touch the user's uncommitted changes in the main checkout.

## 4. Implement
Follow the plan's commit sequence, matching the surrounding code's style, naming and comment density.
Write or update tests alongside the code; for a bug, the failing test or E2E check comes before the fix.
Commit with Conventional Commit messages referencing the issue (`fix(server): ... (#57)`), without AI co-author trailers.
Never hand-edit generated files, CHANGELOGs, or versions that CI owns; the repo's CLAUDE.md says which.

## 5. Gate
Run the `sdlc:gate` skill and fix until green.
The Stop hook also enforces the fast gates whenever you finish, so treat its feedback as a failing build.

## 6. Verify end to end
Launch the `sdlc:verifier` agent with the spec's Verification section and the plan's test plan.
On `VERDICT: fail` or any visual problem, fix and repeat from step 5.

## 7. Review
Run the `sdlc:review` skill against the default branch.
Fix every blocking finding and the nits that are clearly right, re-run gates, and re-run the review if the fixes were substantial.
Disagree with a finding only with a stated reason.

## 8. PR
Open the PR only after the verifier and all three reviewers have returned and their findings are addressed; never end your turn while one is still running.
Push the branch and open a PR with `gh pr create`:
- Title: the Conventional Commit summary.
- Body: `Closes #<issue>`, what changed and why, the acceptance criteria as a checked list, the verification evidence (what was driven, screenshots attached or linked), and anything left for the human reviewer.

Then watch CI (`gh pr checks <n> --watch`) and fix failures, including flaky or pre-existing ones you encounter.
Report the PR URL and status to the user. Do not merge unless the user asks.
