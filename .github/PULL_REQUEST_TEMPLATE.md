<!--
Keep it short. What changed, why, and how you know it works.
-->

## What

## Why

<!-- The real case that motivated it. "A pnpm workspace was launched with npm"
     beats "improve package manager support". -->

## Verification

- [ ] `npm test` green
- [ ] `npm run build` green
- [ ] If this fixes a bug: there is a test for it, **and I broke the fix on
      purpose to confirm the test goes red**
- [ ] If this touches launching, stopping or ports: verified on a real project
      (started it, saw it serve, stopped it, confirmed the port was freed)
- [ ] If this changes the REST/WS contract: `SPEC.md` updated in this PR

<!-- Discovery changes: say which real project layout motivated it, and confirm
     the classification keys off manifests/markers rather than folder names. -->

## Out of scope

<!-- Anything you noticed but deliberately left alone. -->
