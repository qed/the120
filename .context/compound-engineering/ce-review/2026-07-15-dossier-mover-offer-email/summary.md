# ce:review run — feat/dossier-mover-offer-email (2026-07-15, mode:autofix)

**Scope:** `git diff 12ee848` (merge-base with main) — 14 files, 7 commits.
**Intent:** Implement plan `docs/plans/2026-07-15-001-feat-dossier-mover-offer-email-plan.md` (plan_source: explicit).
**Team (12):** correctness, testing, maintainability, project-standards, agent-native, learnings-researcher (always-on) + security, reliability, data-migrations, adversarial, kieran-typescript, julik-frontend-races. Skipped: schema-drift-detector / deployment-verification (no schema.rb; migration already applied + verified via Management API).

## Verdict: Ready with fixes — fixes applied (commit 1870769). 426 tests green, tsc/eslint clean, build compiles.

## Clean reports
security (0 findings), project-standards (0), agent-native (PASS — full parity), learnings-researcher (all 5 documented solutions COMPLY; confirmed PostgREST compares timestamptz by value).

## Findings and dispositions (post-merge, 19)

Applied (in commit 1870769):
1. [P1 julik 0.85] Demote warning read stale `item.offerSentAt` during refresh window → overlay lifted to DossierDetail (`optimisticSentAt`), shared by warning + button.
2. [P2 correctness+adversarial 0.95 merged] Resend CAS token from raw props while `isResend` from overlay → token now from merged `sentAt`.
3. [P2 maintainability+kieran+correctness+adversarial 0.80 merged ×4] `disabled` prop keyboard-bypassable (CSS-only) → onClick guard + dialog send button `disabled={sending || disabled}`.
4. [P2 reliability 0.72] No try/catch around awaited action → stuck "Sending…" → try/catch/finally + sendingRef.
5. [P2 reliability 0.62] Transient read errors conflated with not_found → all reads error-checked, retryable `send_failed`.
6. [P3 reliability 0.60] Audit insert unchecked → captured + console.error (send still succeeds).
7. [P2 maintainability 0.63] Sent badge didn't print in resendable state → print-only mirror badge added.
8. [P1 testing 0.75 + security gap] Footer variants untested → FOOTERS exported + crm-email-footers.test.ts incl. byte-parity vs legacy CASL footer. (Widened gated→safe: test-only export, zero behavior change, parity test proves it.)
9. [P2 kieran 0.72] `as SeatStatus` cast in demoteWarning → typed `SeatStatus` param, cast dropped. (Also resolves testing's unknown-status-test finding via compiler instead of runtime test.)
10. [P2 kieran 0.65 partial] Authority rule restated 3× with ?? vs || → shared `effectiveEmail` helper (trims; || semantics) used by queries.ts + reviews.ts + tests. library.ts's `??` variant left as-is (behavior change → advisory below).
11. [P2 correctness 0.65] Preview first-name from `name.split(" ")[0]` diverges from server's `first_name` → `DossierItem.childFirstName` plumbed (raw column) and used. (Widened manual→safe: one-field plumb, restores the stated one-template invariant.)
12. [P2 julik 0.72] Non-memoized `close` tears down focus trap every render; trap inert while Sending… → useCallback + sendingRef + focusable preview div (tabIndex=0).
13. [P3 correctness 0.60] trim parity queries vs action → via shared helper (item 10).
14. [P2 testing 0.65] Empty-name template fallback untested → test added.
15. [P3 maintainability 0.76] CASL doc comment on wrong constant → comments split/corrected.
16. [P3 maintainability 0.62] Footer `.replace` splice brittle → direct OPEN+close composition, parity test guards bytes.

Advisory / residual (no action, by design or out of scope):
- [P3 data-migrations] `drop constraint` without IF EXISTS in the APPLIED migration — do not edit shipped file; adopt `if exists` as house style for future CHECK swaps.
- [P2 adversarial 0.60] Mid-request platform kill between claim and send leaves phantom sent-stamp — accepted in plan (BCC reconciliation + resend recovery); no proactive anomaly query exists.
- [kieran advisory] `OfferSendResult` flat optional fields vs discriminated union — legit looseness (superseded branch can return already_sent without stamp).
- [kieran advisory] `??` vs `||` in library.ts loadSendFamily — unifying changes library-send behavior for empty-string parent emails; flag for a future deliberate decision.
- Refund-deadline copy goes stale after 2026-09-30 (origin doc defers); no send-time date check.
- Send-vs-move server-side race (no mutual exclusion between sendOfferEmail read and move_candidate commit) — UI locks now hold for keyboard+mouse; sub-second server race accepted (server re-checks truth; demote warning is a client guard by design, documented in plan).

Pre-existing (unrelated, not fixed here): `app/api/welcome/route.ts` injection residual; 51 repo-wide lint problems on main; per-query DB timeouts absent codebase-wide; nurture/copy.ts private SITE_URL duplicate.

## Requirements completeness (plan explicit)
R1–R9, F1, F2: met in diff. R10 (E2E on Cedric) + R11 (S10 release checkpoint): pending — Unit 7 runs after deploy; S10 blocked on Peter (Stripe keys). Not code gaps.

## Testing gaps consciously accepted (per repo pure-rules canon)
Action-level integration (claim/CAS against real Postgres), component wiring (dialog lifecycle, menu keyboard nav), print output — covered by Unit 7 manual E2E checklist in the plan.
