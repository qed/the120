# NEXT SESSION — Funnel Unit 16: event stream, CRM stages, live dossiers

*Written 2026-07-28, after Unit 14 merged as PR #90 (origin/main at `da04f71`).
U15 stays BLOCKED (mailbox vendor + funnel-student address convention, Peter).
Recovery point: start a fresh session from this file if the continuous run breaks.*

## Two lanes ACTIVE

Lane A (fieldwork, Peter) holds `main` in the other worktree — branch from
`origin/main`. Re-read `supabase/MIGRATION-LOCK.md` immediately before authoring
the events migration (this unit HAS one). Version-uniqueness tripwire guards
collisions; check `ls supabase/migrations | tail` for Lane A additions first.

## Where the build stands

Units 1–14 merged (#84–#90). The funnel is feature-complete end to end:
CTA → mini-app → wizard → C2 → review → offer (DB-bridged) → Next Steps →
checkout (C3) with dispute-grade policy acceptance and an ordering-safe
webhook. Suite: 133 files / 3,442 tests; tsc, build, lint clean.

Production migrations so far: 20260808120000, 20260809120000, 20260810120000,
20260811120000, 20260812120000 — all applied + verified.

## Unit 16 scope (plan lines ~1331–1373 — read in full)

**Goal:** answer the question the whole build exists to answer. R56–R60.

- Create `supabase/migrations/<ts>_funnel_events.sql`, `app/lib/funnel/events.ts`
  (server-side emit helper), `app/lib/funnel/event-rules.ts` (pure). Modify
  `app/crm/lib/constants.ts` + `engine.ts`. Test `funnel-event-rules.test.ts`.
- Events SERVER-side only (minors; client analytics is a privacy + loss surface).
- Full segmentation tuple on every event; **NO PII in properties, ids only**
  (that is what lets the retention purge preserve measurement).
- Stage vocabulary exactly once, `as const satisfies`, loader `.in()` filter and
  pure function share the SAME exported constant (asserted by identity).
- The plan's own warning: retrofitting events across shipped units is the shape
  to avoid — but the earlier units did NOT emit as they shipped (the helper
  lands here), so U16 must wire the emit points now: capture (C1), door_confirmed
  (doorConfirmOutcome already carries preselected/switched_from — U8), compose,
  C2 submit, offer, C3 webhook fulfil, FAQ_OPEN_EVENT (the named call site waits
  in MiniAppShell). Wire them at the CORES/server actions, never client.
- `entry_source` stamped once at C1 (families column, U1/U4); resume must not
  re-stamp — pin it.
- Paginated CRM reads refuse rather than truncate at PostgREST's 1000-row bound
  (the documented postgrest-max-rows lesson).
- Verification: the ads question (home vs each landing, by conversion) from ONE query.

## The five steps (protect all)

Build → FULL review (adversarial + correctness, verify-by-execution) →
/ce:compound → commit/PR/squash-merge + checkbox with re-measured counts →
write `NEXT-SESSION-funnel-unit-17.md` (nurture/retention — the LAST unit).

## Standing discipline (distilled; full lists in earlier handoffs)

Pure rules → server-only cores with deps seams → thin actions. supabaseServer IS
PostgREST (RLS policies, pinned). CLAIM BEFORE SPEND. Sanitize THEN validate.
Guards not satisfiable by accident. Trace every WRITER of a state column.
Zero-row UPDATE acknowledged = event lost (webhooks deliver out of order).
Execute requirement formulas; assert invariants. CRLF: node script files (not
bash heredocs with template literals).

## Peter's list (growing — surface at the end of the build)

R47 wording fix; U13 DRAFT_CLAIMS_FOR_PETER + U14 POLICY_CLAIMS_FOR_PETER
(refund process + post-deadline tuition → Ontario counsel); pending-deposits-in-
seats_claimed product question; Stripe test-mode e2e verification; U11 screenshot
pass; hero photography; ZDR; R64 mobile-first; staff waitlist move (nothing
writes `waitlisted`); mailbox vendor (U15); bot resistance before ads;
capture-ingest alerting.
