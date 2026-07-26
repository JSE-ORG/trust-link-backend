<!--
Read CONTRIBUTING.md and SPECIFICATION.md before opening this PR.
PRs that violate the specification will be rejected.
-->

## What

<!-- One or two sentences on what this changes. -->

## Why

Closes #

## How

<!-- The approach. Call out anything a reviewer would not guess from the diff. -->

## Checklist

- [ ] Linked issue above, and the scope matches what the issue asked for
- [ ] `npm run validate` passes locally (typecheck, lint, test)
- [ ] Tests added or updated for the changed behaviour
- [ ] Coverage did not drop
- [ ] No `any` types introduced
- [ ] Services go through a repository, never Prisma directly
- [ ] No secrets, keys, or real addresses committed
- [ ] Conventional commit title, for example `fix(escrow): correct auto release eligibility query`

## Notes for the reviewer

<!-- Anything you are unsure about, or deliberately left out of scope. -->
