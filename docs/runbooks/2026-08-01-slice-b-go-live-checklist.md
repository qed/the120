---
title: "Slice B go-live checklist + confirmation audit (Unit 11)"
type: runbook
status: ready-to-run (human/gated)
date: 2026-08-01
plan: docs/plans/2026-08-01-001-feat-slice-b-signup-provisioning-plan.md
---

# Slice B — go-live checklist + confirmation audit

The single ordered checklist a human follows to take First Profit signup +
child provisioning live. It folds in the R26/R27 email wiring recap, the
`is_test` CRM-exclusion counts-unchanged guard, the cross-repo deploy order, and
pointers to the two gated runbooks (live-provisioning acceptance protocol; RLS
re-probe). Nothing here runs automatically — each box is a deliberate human step.

## A. Pre-flight (both repos, on the release branches)

- [ ] `[T120]` `npm run test` green (incl. the Unit 11 E2E + stress suites),
      `npx tsc --noEmit` clean, `npm run lint` clean.
- [ ] `[FP]` `npm run test` / `npx tsc --noEmit` / lint clean (incl. the FP
      signup-flow E2E if present).
- [ ] Legal has signed off on the consent TEXT (`FP_CONSENT_POLICY.text`,
      version `2026-08-01.1`). The schema is hedged (jsonb evidence), but the
      wording is a launch gate.
- [ ] Confirm `GOOGLE_WORKSPACE_SA_KEY` is **unset** in production (mailbox leg
      parks `pending`; no mailbox burned) and `FP_SIGNUP_TEST_ONLY` is **on**
      (unset = on = gate CLOSED; only test-family signups allowed).

## B. Confirmation audit — R26 recap + R27 digest wiring

- [ ] **R26 recap** (`sendSignupRecap`, wired at `app/api/fp/signup/child`):
      fires AFTER a fully-minted child, BEST-EFFORT (a recap failure never
      changes the 200). Idempotent at Resend (`fp-recap:<familyId>`), so multiple
      children in one signup collapse to one delivery. Suppresses guarded test
      families + unsubscribed families internally. Confirm a test-family signup
      does NOT deliver a recap (suppressed) and a real one would.
- [ ] **R27 digest** (`buildProgressDigest` + `sendProgressDigest`,
      `app/fp/lib/parent-email`): selection respects `digestHasContent` (no empty
      digests) and the same `isRealFamily` suppression. Confirm the digest cron
      is scheduled and skips test/unsubscribed families.
- [ ] Both emails use `escapeHtml` and contain **no em dashes** (repo style).

## C. Confirmation audit — `is_test` CRM exclusion, counts UNCHANGED

The rule lives in ONE place: `app/crm/lib/test-family-filter.ts`
(`excludeTestFamilies` / `isRealFamily`), applied via the NULL-safe
`.not("is_test", "is", true)` (keeps `false` AND `null`, drops only `true`).

- [ ] The 7 EXCLUDE reads are all wrapped (nurture cron; `fetchPipeline`,
      `fetchDossierQueue`, `fetchLibrary`; CRM dashboard, sprint, ambassadors).
- [ ] The counts-unchanged guard test passes: excluding test families does NOT
      change REAL-lead counts (guards the false-negative — a `= false` predicate
      would silently drop NULL rows). Re-confirm real pipeline/GTM counts before
      and after the first test signup are identical.
- [ ] A guarded test signup sets `families.is_test = true` (server-side
      post-insert UPDATE) and is absent from every EXCLUDE surface, present only
      on self-scoped/ops reads.

## D. Confirmation audit — RLS re-probe (Unit 0 holds post-build)

- [ ] Run the RLS re-probe against production with a THROWAWAY test-parent
      session (see `scripts/rls-reprobe-fp-parent.ts`):
      `FP_PARENT_SESSION=<token> RLS_OTHER_CHILD_ID=... RLS_OTHER_DEPOSIT_ID=...
      RLS_OTHER_PROJECT_ID=... npm run rls:reprobe`.
- [ ] All checks PASS: 0 rows on another family's children/deposits/projects;
      `families` staff-gated (0 rows — reconcile if not); no path_* rows;
      `fp_parental_consent` denied/invisible. Any FAIL blocks go-live.

## E. Deploy order (cross-repo, NO half-live window)

1. [ ] **`[T120]` backend ships FIRST.** It is backward-compatible and
       unreferenced by any live CTA, so it is safe to deploy while the FP CTA
       still points at the old flow. Verify the Slice B routes answer live
       (OPTIONS/CORS + a guarded test-family start → verify → consent → child).
2. [ ] Run the **live-provisioning acceptance protocol** (the ONE scripted
       real-Workspace run; separate runbook). Enable → drive ONE mailbox →
       disable → R28 cleanup. Bounded name burn.
3. [ ] **`[FP]` CTA cutover LAST.** Repoint the Landing CTA to signup (behind
       `VITE_ENABLE_SIGNUP` if available) only AFTER the backend is verified live
       and the acceptance run + cleanup are done. This is the final cutover.
4. [ ] Lifting the launch gate (`FP_SIGNUP_TEST_ONLY=off`) to admit real families
       is a SEPARATE, separately-reviewed change — not part of this checklist.

## F. Post-cutover watch

- [ ] Watch `funnel_student_provisioning` for claims parking `pending`
      (`workspace credential not configured`) — expected while the credential is
      off; the FP re-drive re-parks them quietly (no ops page for that reason).
- [ ] Watch the stale-claim sweep: any NON-workspace-unconfigured park pages ops
      once. Investigate `exception` parks (incl. the underivable-name finding
      below).
- [ ] Confirm no unexpected `users.insert` after the acceptance run (credential
      should be unset again).

## G. Known Unit 11 FINDING to resolve before real path-b usage

- [ ] **FP path-b children are created first-name-only, but the student-address
      deriver needs a last name.** The full-sequence E2E surfaced that a path-b
      mint over real end-to-end state parks the drive at `exception`
      (underivable) and compensates — Unit 5's own test masked this by canning
      `readChildName` to return a last name. Resolve (derive the student address
      from the first name alone, or capture/synthesize a last name) before
      enabling real Workspace provisioning for path-b signups. Until then, path-a
      (existing-credential) signups are unaffected.
