# NEXT SESSION — Funnel Unit 13: review state and the offer bridge

*Written 2026-07-28, after Unit 12 merged as PR #88 (origin/main at `f0f8aa6`).
Recovery point: if the continuous run breaks, start a fresh session from this file.*

## Two lanes ACTIVE — handle with care

Lane A (fieldwork, Peter, worktree `120-The120`) holds `main` checked out — branch
from `origin/main`, never `git checkout main` here. The 20260808120000 version
collision is repaired (see MIGRATION-LOCK.md; version-uniqueness tripwire test now
exists). **Re-read the lock immediately before authoring any migration.** U13 needs
no migration on current reading (offer flow rides existing tables).

## Where the build stands

Units 1–12 merged (#84 U9, #85 U10, #87 U11, #88 U12). The mini-app is complete;
the wizard receives the funnel's work pre-done; Scholars unstranded (8 items
everywhere). Suite: 130 files / 3,392 tests; tsc, build, lint clean.

**⚠ Flag for Peter (from U12):** R47's literal formula in the requirements doc is
inverted (`2026 − 11 + grade` → grade 12 born 2027). Implemented as the evident
intent `2021 − grade`; the requirements text needs correcting.

## Unit 13 scope (plan lines ~1138–1178 — read in full)

**Goal:** the F5 rung — a real admissions process after C2; staff open the deposit
through the path that already exists. Requirements R49a, F5.

- Create `app/start/review/*`, `app/start/waitlist/*`, `app/lib/funnel/offer-rules.ts`.
- Modify `app/crm/lib/offer-rules.ts` — ALL THREE renderings (text, duplicated
  html, and the confirm-dialog preview in OfferEmailButton.tsx) must carry the
  same deposit target. R40b's escape-at-render obligation lands HERE if project
  fields enter the email.
- **DECISION ON FILE (Peter, 2026-07-28): I draft the review-wait and waitlist
  screens, Peter revises. Flag factual claims** (review timelines, seat counts,
  refund terms) prominently — neither screen exists in the design handoff.
- The review screen must say what happens next and WHEN, or it reads as the stall
  it exists not to be. The waitlist screen is a routing destination named three
  times in the plan.
- Offers do NOT reserve seats: `seats_claimed()` counts paid deposits only. Either
  cap outstanding offers or surface remaining-minus-outstanding at the point of
  offer — silently over-offering sends admitted families to a waitlist wall.
- Before an offer, the deposit route is refused SERVER-side, not merely hidden.
- Verification: the existing staff offer flow for non-funnel families is unchanged.
- Test file location is deliberate: `app/crm/__tests__/funnel-offer-rules.test.ts`
  (the narrow allowlist form, NOT app/crm/lib/__tests__/).

## The five steps (protect all)

1. Build. 2. FULL review (adversarial + correctness, verify-by-execution).
3. /ce:compound. 4. Commit → PR → squash-merge; plan checkbox with re-measured
counts. 5. Write `NEXT-SESSION-funnel-unit-14.md` naming U14 (Next Steps,
checkout, deposit integrity — test-first, MONEY; discharge the carried 23505
webhook catch + the partial-refund refunded_at fix).

## Standing discipline (U1–U12 distilled)

1. Pure rules; server-only cores with deps seams; thin actions; no supabaseAdmin
   in funnel cores. `supabaseServer()` IS PostgREST — user-session tables need
   RLS policies, pinned by migration-scan tests.
2. CLAIM BEFORE SPEND. Raw-vs-resolved + state-scoped-by-server-fact. Sanitize
   THEN validate. Guards must not be satisfiable by accident (sweep what renders;
   word boundaries). Scans for absences; behaviour by execution.
3. A requirement's literal formula can be wrong: execute it across its domain,
   assert INVARIANTS (ranges, monotonicity), implement the intent, flag the text.
4. Parity fixtures enter through each mirror's own raw path, never another
   mirror's sanitized output.
5. CRLF: node heredocs with \r\n-normalization for scripted edits.

## After Unit 13

U14 (checkout/webhook, MONEY) → U16 (events; FAQ_OPEN_EVENT call site awaits in
MiniAppShell) → U17 (nurture/retention). U15 BLOCKED (mailbox vendor, Peter).
Peter-owned: hero photography; ZDR (launch precondition); Ontario counsel; R64
mobile-first; U11 by-eye screenshot pass; R47 requirements-text fix; migration-lock
tripwire (a) (lane-prefix vs holder). Carried: bot resistance before ad traffic;
alerting on "[funnel/capture] lead ingest THREW".
