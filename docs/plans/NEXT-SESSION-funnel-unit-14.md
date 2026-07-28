# NEXT SESSION — Funnel Unit 14: Next Steps, checkout, and deposit integrity

*Written 2026-07-28, after Unit 13 merged as PR #89 (origin/main at `5668354`).
Recovery point: start a fresh session from this file if the continuous run breaks.*

## Two lanes ACTIVE

Lane A (fieldwork, Peter) holds `main` in the `120-The120` worktree — branch from
`origin/main`. Re-read `supabase/MIGRATION-LOCK.md` immediately before authoring
any migration; the version-uniqueness tripwire test guards collisions.

## Where the build stands

Units 1–13 merged (#84 U9, #85 U10, #87 U11, #88 U12, #89 U13). Funnel runs
CTA → mini-app → wizard (pre-done) → C2 submit → review screen → staff offer
(the DB sync trigger now bridges applicant_state) → offer email → dashboard CTA.
Suite: 131 files / 3,412 tests; tsc, build, lint clean.

Production migrations this build: 20260808120000 (projects RLS + state guard),
20260809120000 (child email), 20260810120000 (applicant-state sync trigger).

## Unit 14 scope — MONEY, TEST-FIRST (plan lines ~1202–1248, read in full)

**Goal:** Next Steps, checkout, deposit integrity. R50, R51, R51a, R52, R52a, R52b.

- Create `app/start/next-steps/*` (R50: three swipes — progress made, set your
  goal with editable input, secure the seat; reached from the offer email or
  dashboard once `offered`, NEVER directly from submission), and
  `app/lib/funnel/deposit-rules.ts`.
- Modify `/api/checkout` (funnel-session path; validate `origin` — never trust
  the header into redirect URLs; idempotency key as the SECOND argument, derived
  from a persisted attempt row, NOT bare `deposit:${childId}` which prunes at
  24h) and `/api/stripe/webhook` (add `async_payment_succeeded` /
  `async_payment_failed` / `expired`; record dedupe key AFTER the idempotent
  deposit write; claim-then-send for non-idempotent effects).
- **Both Stripe routes currently have ZERO tests** — add
  `app/api/__tests__/checkout.test.ts` + `stripe-webhook.test.ts`, following
  `app/api/webhooks/calcom/__tests__/route.test.ts`. NOTE: `app/api/**/__tests__`
  is already in the vitest allowlist.
- **Carried items to discharge here:** (1) the webhook 23505 catch (Peter's
  decision "Leave to U14, document" — see
  docs/solutions/database-issues/partial-unique-index-under-live-upsert-*.md);
  (2) the refund bug: a redelivered `completed` after a refund re-sets `paid`
  without clearing `refunded_at`, leaving `hasPaidDeposit` and `isLivePaid`
  disagreeing.
- R51a: FULL refund-policy text inline at the point of payment, above an
  unticked checkbox; persist accepted text's version, hash, timestamp, IP (may
  need a migration — re-read the lock first). A checkbox with only a link is
  rejected by card issuers as dispute evidence.
- R51: $250, refundable until Sept 30 2026 — machine-readable Date constant
  beside DEPOSIT_REFUND_DEADLINE_LABEL in site.ts; collapse the three duplicate
  literals (F7).
- Checkout at zero seats → refused, routes to waitlist. Ownership refusal ==
  non-existent child (no existence oracle).
- Verification: test-mode e2e deposit + replayed webhook → exactly one paid row.

## Standing discipline (U1–U13 distilled; full list in NEXT-SESSION-funnel-unit-13.md)

Pure rules → server-only cores with deps seams → thin actions. supabaseServer IS
PostgREST (RLS policies!). CLAIM BEFORE SPEND. Sanitize THEN validate. Guards not
satisfiable by accident. Execute requirements' formulas across their domain;
assert invariants. Parity via each mirror's raw path. **Trace every WRITER of a
state column a reader distinguishes** (the U13 critical). CRLF: node heredocs.

## After Unit 14

U16 (events — FAQ_OPEN_EVENT call site awaits in MiniAppShell) → U17 (nurture).
U15 BLOCKED (mailbox vendor + funnel-student address convention, Peter).
Peter-owned: hero photography; ZDR; Ontario counsel; R64 mobile-first; U11
screenshot pass; R47 requirements-text fix; U13 drafted-copy revision
(DRAFT_CLAIMS_FOR_PETER); staff-side waitlist move (nothing writes `waitlisted`).
Carried: bot resistance before ads; capture-ingest alerting.
