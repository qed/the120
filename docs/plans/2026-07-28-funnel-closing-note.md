# The closing note — First Profit funnel complete

*2026-07-28. Sixteen of seventeen units built, reviewed, and merged (PRs #66,
#68, #70, #72, #78–#82, #84, #85, #87–#92). U15 remains blocked on the mailbox
vendor. Suite at close: 135 test files / 3,487 tests; tsc, build, lint clean.
Ten production migrations applied and verified during the build
(20260805120000 → 20260814120000).*

## What exists now

A cold visitor can travel the whole distance: landing CTA → /start capture
(C1, real account, RLS-authorized) → children → the seven-step mini-app
(doors → templates → quiz → AI compose with canned fallbacks → tasks →
Reveal with share card) → the rewired wizard (pre-done, Workshops removed,
Scholars unstranded) → C2 submission → the review screen → staff offer (the
DB sync trigger bridges the applicant ladder) → Next Steps → C3 checkout
with dispute-grade policy acceptance and an ordering-safe Stripe webhook →
child-aware nurture and a stateful retention schedule. Every conversion
emits into `funnel_events`, and the ads question — which entry surface
converts, C1→C2→C3 — is one query.

## Peter's list (accumulated, in rough priority)

**Wording/copy revisions (drafted by the build, flagged inline):**
1. R47's formula in the requirements doc is inverted (`2026 − 11 + grade`);
   implemented as `2021 − grade`. Fix the text.
2. U13 review-wait + waitlist screens — `DRAFT_CLAIMS_FOR_PETER` in
   `offer-rules.ts` ("five business days", waitlist ordering).
3. U14 refund policy — `POLICY_CLAIMS_FOR_PETER` in `deposit-rules.ts`
   (refund process wording; post-deadline-tuition needs Ontario counsel).
4. U17 retention — `RETENTION_CLAIMS_FOR_PETER` in `retention-rules.ts`
   (365/14 days AND the inactivity definition itself).
5. R61 deviation: no project name in nurture subjects (privacy posture).

**Product decisions:**
6. Should PENDING (bank-debit) deposits hold a seat in `seats_claimed()`?
7. The staff-side waitlist move: nothing writes `waitlisted` yet.
8. ~~`applied-but-no-deposit` nurture sequence~~ — DONE (follow-ups pass,
   2026-07-28): the offer-nudge fires 3 days after the offer email, anchored
   on child_reviews.offer_email_sent_at. KNOWN deviation documented in the
   engine: the gate is family-wide (any child's deposit silences it).
9. ~~Migration-lock tripwire (a)~~ — DONE (follow-ups pass): migrations
   newer than the cutoff must match the holder named in MIGRATION-LOCK.md;
   a transfer in the same PR passes by construction. Tripwire (b) remains
   the collision guard.

**External/launch preconditions:**
10. ZDR agreement with the compose model provider (U10; `FUNNEL_COMPOSE_MODEL`
    env unset = graceful fallback until then).
11. Mailbox vendor + funnel-student address convention → unblocks U15
    (arrival, provisioning, guard widening).
12. Hero photography (slots ship blue; lands with its `<Image>` wiring).
13. Bot resistance before ad traffic (also owns `lp_view`/`explainer_start`
    emits and the dirty `start_view` denominator).
14. R64 mobile-first pass — claimed by zero units.

**Verification runs that need a keyed environment:**
15. Stripe test-mode e2e deposit + replayed webhook (U14's verification).
16. Seeded full-cycle nurture run + staged retention rehearsal (U17's).
17. U11 by-eye screenshot pass against the design handoff.

**Carried operational items:**
18. ~~Alerting~~ — DONE (follow-ups pass): `notifyOps` mails
    admissions@the120.school on retention-cron failure, the weekly retention
    summary, the webhook's DOUBLE-PAID case, and the capture-ingest
    reconcile path. Awaited on serverless request paths.
19. One-click minted resume tokens for nurture deep links (currently /start,
    resume point derived server-side).

## Follow-ups pass (2026-07-28, PR #95)

Items 8, 9, and 18 closed after the build completed (one adversarial review
pass; its stale-anchor, unawaited-serverless-send, and test-env-mail findings
fixed before merge). R61 is now covered point by point.

## How it was built

Five steps per unit, without exception: build → two-agent adversarial +
correctness review with verify-by-execution → compound (docs/solutions/ —
fourteen new lessons this build) → squash-merged PR with re-measured suite
counts → a hand-off prompt as the recovery point. The reviews were not
ceremony: they found the projects-RLS production outage before it happened,
the offer bridge that existed only in fixtures, the refund that out-of-order
delivery would have lost forever, the emit that forged conversions, and the
retention cron that would have 405'd every Monday. Every one of those is a
merged fix with a pinned test.
