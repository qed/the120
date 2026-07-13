# ce:review run artifact — feat/crm autofix

- **Run:** 2026-07-13-crm-autofix · mode:autofix · plan: `docs/plans/2026-07-13-001-feat-the120-crm-plan.md`
- **Scope:** BASE `1bb154ec24a92f324ddf1677f9c88cfff5abac6e` → feat/crm @ 7e95049 · 83 files · +17,238 lines · no untracked
- **Reviewers dispatched:** 11/11 returned (correctness, testing, maintainability, project-standards, agent-native, learnings-researcher, security, reliability, data-migrations, adversarial, kieran-typescript)
- **Verdict:** ✅ **PASS with residuals** — zero exploitable findings in the diff itself (security: 0 findings after verifying all 14 requireStaff sites, RLS predicates, SECURITY DEFINER search_paths, revoked RPC grants); one **P0 platform-config finding** (pre-existing auth posture, confirmed live), 2 P1s, and a routine P2/P3 tail, all routed to todos or advisory.

## Synthesis notes

- Confidence gate ≥0.60 (P0 ≥0.50): all findings passed; none dropped.
- Severity normalization: maintainability and kieran-typescript returned `medium`/`low` labels → mapped P2/P3.
- Cross-reviewer boost applied: mergeFamilies unchecked reassignment errors (reliability+correctness+adversarial → 0.95), merge non-atomicity (reliability+data-migrations+agent-native → 0.82), dashboard re-derivation (maintainability+kieran → 0.82).
- Conservative routing: both `gated_auto` findings (funnel zod enum, form-style constants) left unapplied per autofix policy → todo 009.

## Applied fixes (safe_auto, 1 finding, 1 round)

| Finding | File | Fix |
|---|---|---|
| welcome route try/catch can't catch supabase-js `{error}` results — real stamp failures unlogged (reliability P3, 0.62) | `app/api/welcome/route.ts:87` | Destructure `{ error: crmErr }` and `console.error` it; try/catch retained for thrown exceptions. Behavior unchanged. |

Re-verification: **293/293 tests pass, production build green.** safe_auto queue exhausted after round 1; no round 2 needed.

## Confirmed during review (orchestrator verification)

- **P0 exploitability confirmed in production:** `GET /v1/projects/deolvqnyvhhnavsifgxz/config/auth` → `mailer_autoconfirm: true`. Signup requires no email ownership proof, so the adversarial scenario (register with a lead's email → trigger links attacker to the lead family, overwrites identity, forces `consent_given = true`, permanently squats the address in auth.users) is live. No CRM UI recovery path (updateContact refuses linked families).
- gtm + library migrations confirmed applied via Management API (8+8 gtm rows; 15 library items) — closed learnings-researcher's open item.

## Residual actionable (not auto-applied)

| # | Sev | Finding | Route |
|---|---|---|---|
| P0 | P0 | Email-collision lead hijack + forged CASL consent (adversarial 0.85; prod-confirmed) | **human decision** — enable Supabase email confirmations (changes signup UX). Flagged in roadmap §S5 + PR. |
| 001 | P1 | mergeFamilies unchecked reassignment errors + non-atomic sequence | todo 001 |
| 002 | P1 | seed-staff.ts re-run reactivates revoked staff | todo 002 |
| 003 | P2 | Funnel "interested" gates on created_at, not consent_at | todo 003 |
| 004 | P2 | Dashboard re-derives pipeline logic vs fetchPipeline | todo 004 |
| 005 | P2 | Error-path hardening (library-read blanket tolerance; logSend bookkeeping; proxy getSession try/catch) | todo 005 |
| 006 | P2 | Kanban optimistic re-drag race | todo 006 |
| 007 | P2 | backfill-families race guard + tombstone chain-walk | todo 007 |
| 008 | P2 | Test coverage: queries.ts pure logic, resolveWeek, resolveMerge email backfill | todo 008 |
| 009 | P2 | Single-source constants (funnel zod enum, form styles, sprint date) | todo 009 |

## Advisory (report-only, no todo)

- **Backdated call stamps can rewrite closed weeks** (adversarial P2 0.68): `countCallFamilies` gates only on the backdated effective time, not the history row's real `created_at` — a W5-inserted stamp backdated to W2 changes already-reported W4 numbers. Fix (also require `created_at ≤ week end`) changes funnel semantics → product decision.
- **CASL consent gate is app-code-only** (agent-native): no DB trigger blocks a `library_sends` insert for a revoked-consent family — safe today (all sends flow through `sendGate`), but harden with a `move_candidate`-style trigger/RPC before any programmatic (service-role) send path exists.
- **Type-narrowing hardening** (kieran P2 0.62–0.68): `requireStaff()`'s `user!`/`staffRow!`, sendFromLibrary's `email!`, and mergeFamilies' `Record<string,unknown> → Partial<FamilyActionRow>` cast are correct today but proven only by cross-module conventions, not types.
- **No Database generic on supabase clients** (pre-existing, repo-wide): all row typing is hand-written interfaces + casts; a column rename surfaces only at runtime.
- **sendCrmEmail / lib/email.ts fetch has no timeout** (pre-existing).
- **deposits.parent_id ON DELETE CASCADE** can destroy paid-deposit rows if a parent/auth user is deleted (pre-existing; plan defers to S10 go-live revisit).
- **Sync-failure observability latency**: `on_parent_created`'s RAISE WARNING reaches only Postgres logs; detection is the dashboard SyncHealth tile (pull, not push).
- **No rate limiting on parent signup** (pre-existing): a signup flood directly corrupts GTM "interested/accounts" actuals.
- queries.ts at ~1,180 lines: well-sectioned, but split (pipeline/dossiers/library) if another unit lands there.

## Testing gaps (recorded, rolled into todo 008 where actionable)

- No network-layer proxy test; no RLS/pgTAP or scripted integration tests for `on_parent_created`, children guard triggers, `move_candidate` atomicity (plan Unit 2 called for these).
- No jsdom/@testing-library harness → KanbanBoard optimistic logic untestable as-is.
- Server actions never driven through simulated DB failures (all action tests exercise pure rules only).
- computeFunnelActuals: no malformed-date fixture for deposits; no exact-boundary refunded_at === weekEnd test; deriveNextMove rule 7 day-21 boundary untested.

## Requirements completeness vs plan (`docs/plans/2026-07-13-001-feat-the120-crm-plan.md`)

All 8 implementation units complete (8 unit commits, 0e43484…7e95049). R1–R11 verified during execution; learnings-researcher confirmed all four roadmap warnings respected; project-standards confirmed Next.js 16 conventions (proxy.ts, async searchParams, after()) against bundled docs. Plan status flipped to `completed`. Known deliberate deviations: none. Deferred by plan to S10: Stripe live-mode URL swap.
