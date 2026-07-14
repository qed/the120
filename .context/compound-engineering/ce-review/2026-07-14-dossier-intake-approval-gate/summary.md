# ce:review run — feat/dossier-intake-approval-gate (2026-07-14)

Scope: `git diff da5f373..HEAD` — 22 code files + 2 migrations (7 commits).
Plan: docs/plans/2026-07-14-002-feat-dossier-intake-approval-gate-plan.md (plan_source: explicit).
Mode: autofix (invoked from ce:work); parent workflow applied the gated/manual fixes itself.
Reviewers (13): correctness, testing, maintainability, project-standards, agent-native, learnings-researcher (always-on) + security, api-contract, data-migrations, reliability, adversarial, kieran-typescript, julik-frontend-races.

## Applied fixes (this run)

1. **[P1, 4 reviewers converged] Checklist counted raw workshop ids while the wizard shows the sanitized view** — a legacy Scholars row holding only retired K–2 ids read 100% complete while the workshops step showed "0 of 3". Added `hasLiveWorkshopPick` to `app/dashboard/data.ts` and threaded it through **all three lockstep mirrors** (data.ts checklist, crm reviews-rules dossierChecklist, nurture rules dossierCompleteness — changed together per the mirror rule). New raw-path tests in wizard-rules.test.ts (the prior "all-retired" test pre-sanitized its fixture and never exercised the real path).
2. **[P2 security 0.8] HTML injection into the admissions email** — child/parent names interpolated unescaped into the Resend HTML body. Now `escapeHtml`-wrapped (reusing app/crm/lib/library-rules).
3. **[P1 reliability 0.72] Status-echo mismatch misreported staff-advanced rows as submit failure** — store now adopts the DB's echoed status when it's beyond draft (self-heal) and only fails on a draft echo (the real coercion case). Prevents the false-failure loop that would locally unlock a dossier already in review.
4. **[P2 reliability] sendEmail could throw past the unclaim path** — sendEmail is now never-throw (try/catch) with an 8s AbortSignal timeout; notify route also normalizes throws defensively.
5. **[P2 julik 0.72] Remove-during-submit race** — "Remove this child" disabled while the submit save is in flight (a remove racing submit could email admissions about a just-deleted child).
6. **[P2 correctness 0.78] StepReview hint told already-paid offered families to reserve again** — hint is now depositPaid-aware.
7. **[P3 adversarial] StepGroup Scholars-switch confirm counted raw picks** — now counts the sanitized (visible) selection.
8. **[P3 julik] doSubmit re-entrancy guard; deposit-refresh setTimeout cleanup** (DashboardApp).
9. **[P3] RESERVE_GATE_MESSAGE docstring softened** (client renders verbatim; no branching implied).

## Accepted / advisory (no action)

- Silent drop of a legacy 4th workshop pick on first edit (adversarial P2): by design per plan (cap is a product decision; population ≈ 0; StepGroup-style confirm not warranted for an invisible pick).
- DossierPreview/CRM show the raw stored selection while the editable wizard shows sanitized (adversarial P2): intentional — preview/CRM are the record; tombstone titles keep them readable.
- Maintainability: sanitize derivation duplicated between DossierEditor and StepWorkshops (two identical one-liners, commented); WorkshopSelectionBar extraction; DossierEditor's own depositPaid vs hasPaidDeposit — noted, deferred (see residual).
- api-contract advisory: checkout 400-narrowing is a coordinated first-party rollout; release note in PR.
- agent-native: checkout 400s carry prose only, no machine `code` field; staff approval (move_candidate) has no API surface — conscious asymmetry for now.

## Residual work (downstream)

- todo: add a `code` field (`NOT_APPROVED` | `ALREADY_PAID` | `NOT_SUBMITTED`) to /api/checkout error responses for programmatic callers.
- todo: functional-patch overload for store.updateChild so array toggles compute against ref-time state (theoretical same-tick lost-update).
- todo: consider extracting WorkshopSelectionBar from DossierEditor; migrate DossierEditor.depositPaid to hasPaidDeposit.
- ops: run the children_notified_guard SQL replay verification (parent-JWT full-row payload) per the status-echo doc's Prevention #4 — trigger applied to prod 2026-07-14, replay recommended.
- ops: post-deploy purge + 24–48h re-verification (plan rollout steps 3/6); welcome route shares the unescaped-HTML pattern (pre-existing, separate fix).

## Verdict

Ready with fixes (all applied). 393 tests green, build clean. Pre-existing lint errors in untouched files (Gauntlet/TimeBackSimulator/DashboardApp effect) are out of scope.
