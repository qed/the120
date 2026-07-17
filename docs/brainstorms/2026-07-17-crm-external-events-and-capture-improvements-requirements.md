---
date: 2026-07-17
topic: crm-external-events-and-capture-improvements
---

# CRM External-Events & Capture Improvements

## Problem Frame

Five CRM improvements, all rooted in one structural gap plus two standalone
fixes. The structural gap: **the CRM only knows about events that flow through
its own staff server actions** (`app/crm/lib/actions/*`). Anything that happens
*outside* a staff click — a robot nurture email, a gauntlet tournament entry, a
Cal.com booking — is invisible to the pipeline, the timeline, and the signals.
Staff therefore write personal notes blind to what the automation already did,
qualified consented leads sit stranded in side tables, and funnel stamps are
keyed by hand.

The two standalone items: a fast-capture shortcut for warm conversations, and a
confirmed bug where the "ask for one introduction" co-pilot nudge can never be
dismissed.

Affected: CRM staff (Peter/Ethan) doing daily pipeline work; indirectly every
prospect family whose timeline is incomplete or who gets double-asked for a
referral the robot already requested.

### The five items at a glance

| # | Item | Type | Root |
|---|------|------|------|
| 1 | Nurture emails invisible on timeline | Feature | External event → CRM |
| 2 | Gauntlet players → auto CRM lead + signal | Feature | External event → CRM |
| 5 | Cal.com webhook auto-sets `call_booked` | Feature | External event → CRM |
| 3 | One-step "log warm convo" capture | Feature | Speed of capture |
| 4 | Referral nudge can't be dismissed | Bug | Missing flag setter |

## Requirements

**A. Referral-nudge bug (item 4)**

- R1. Add a one-click **"Mark referral asked"** action in the family drawer
  (co-pilot card / header action row) that sets `families.deposit_asked_referral
  = true`, dismissing co-pilot Rule 2.
- R2. **Auto-set** `deposit_asked_referral = true` when the nurture T+10 deposit
  "referral ask" email successfully sends — same discipline as existing nurture
  logging (a failed send sets nothing). Robot-sent asks self-dismiss the nudge.
- R3. Once the flag is set, Rule 2 ("Founding 120 welcome — ask for one
  introduction", `engine.ts:174-183`) no longer fires. (Holds by construction
  today — the only missing piece is a setter; verified no writer exists.)

**B. Fast warm-contact capture (item 3)**

- R4. **Global "Log warm convo" quick action** (button at the top of the
  pipeline): name + optional email + note → upsert a lead and set source, the
  `warm-convo` signal, heat, and `last_touch_at` in a single step. Captures
  brand-new warm contacts, not only existing ones.
- R5. **Same one-click collapse inside an existing family drawer**: note +
  `warm-convo` signal + heat + `last_touch_at` in one action, replacing today's
  four separate writes.
- R6. Heat behavior: the action sets a **"warm" floor** — it raises heat toward
  warm but never lowers an already-higher `heat_score`.
- R7. Dedup: global capture matches a live family by `lower(email)` (respecting
  the existing `families_email_live_unique_idx` and the merge rules in
  `families-rules.ts`); it never clobbers existing identity or consent.

**C. External events into the CRM (items 1, 2, 5)**

*Nurture visibility (item 1)*
- R8. The family-detail query (`fetchFamilyDetail`) fetches `nurture_sends` and
  passes them into `buildTimeline` (`queries.ts`) — which is a pure function, so
  the fetch is added upstream, not inside it. `buildTimeline` renders automated
  emails as a **distinct "automated / robot" event type** (a new value on the
  `TimelineEntry` type union), visually differentiated from staff library sends.
  Note: `nurture_sends` has no subject column, so the event label is derived in
  code from the sequence + step (see the label-granularity question below).
- R9. Automated nurture events are **display-only**: they do **not** update
  `last_touch_at`. A robot email must not reset the human follow-up staleness
  clock that drives the co-pilot's day-based rules.

*Gauntlet bridge (item 2)*
- R10. On tournament entry **confirmation** (`confirmed_at` set — double opt-in
  complete), create-or-match a `families` lead with source `gauntlet`, the
  `gauntlet-played` signal, and consent carried from the confirmed entry.
- R11. Match by `lower(email)` to an existing live family: if found, add the
  `gauntlet-played` signal without overwriting the family's existing `source`,
  identity, or consent; if not, create a new lead (source `gauntlet`).
- R12. Pending / unconfirmed entries stay in `gauntlet_tournament_entries` only
  — they never enter the pipeline.

*Cal.com booking sync (item 5)*
- R13. New authenticated **Cal.com webhook endpoint**: `BOOKING_CREATED` →
  stamp `call_booked` (via a staff-less core extracted from `stampCall` +
  system actor); an unmatched booker email → create a new lead (source
  `booking`).
- R14. A `booking`-sourced lead gets **CASL implied-consent** on an inquiry
  basis: `consent_source = 'booking-inquiry'` with the standard time-limited
  implied-consent window, so it is nurture-eligible immediately (a booking is a
  direct inquiry). Matching an existing family never overwrites its consent.
- R15. `BOOKING_CANCELLED` → clear `call_booked` **only if that stamp was set by
  the webhook** (track stamp origin); a manually-set `call_booked` (call booked
  off-Cal.com by phone/text) is never wiped by a Cal.com cancel. Reschedule →
  update the stamped time. Matching a booking to an existing family
  stamps/clears `call_booked` **only** — never identity or consent (mirrors R11).
- R16. Webhook verifies the Cal.com signing secret (env-scoped like
  `STRIPE_WEBHOOK_SECRET`), following `app/api/stripe/webhook/route.ts`; handlers
  are idempotent + ordering-tolerant (dedupe on booking uid).

## Success Criteria

- The referral nudge disappears the moment staff mark it asked *or* the robot
  sends the T+10 ask — no deposit-paid family shows it permanently. (Item 4)
- A warm contact met in person is fully logged (lead + signal + heat + touch) in
  one action, whether or not they already exist. (Item 3)
- Opening any family shows a complete timeline including robot emails; staff can
  see "the robot emailed them this morning" before writing a personal note.
  (Item 1)
- Every gauntlet entrant who confirms **after this ships** appears in the
  pipeline as a `gauntlet`-source lead with the `gauntlet-played` signal.
  (Pre-existing confirmed entries are deliberately out of scope — backfill is a
  follow-up, see Scope Boundaries.) (Item 2)
- `call_booked` reflects the actual Cal.com calendar without a manual stamp, and
  clears when a call is cancelled. (Item 5)

## Scope Boundaries

- **`call_held` stays manual.** Only `call_booked` is automated from Cal.com;
  whether a call actually happened remains a staff judgment/stamp.
- **No new nurture sequences or copy.** Item 1 makes existing nurture sends
  *visible*; it does not change what the robot sends.
- **No LLM in the co-pilot.** Rule 2 stays deterministic; item 4 only adds the
  missing flag setter.
- **Pending gauntlet entries are not ingested** — only confirmed (opt-in) ones.
- **No backfill of existing confirmed gauntlet entries** in this scope (chosen
  "on confirm", not "on confirm + backfill"). Can be a follow-up.

## Key Decisions

- **Item 3 operates both globally and in-drawer** (create-or-match + one-click
  collapse): covers "someone new" and "someone already tracked".
- **Item 4 ships manual + auto dismiss together (R1+R2)**: de-duplicates robot
  vs human referral asks, and lets staff dismiss after an in-person ask the robot
  never made. R2's setter lives in the cron's post-send success branch, keyed to
  the sequence/step id.
- **Item 2 triggers on confirm (double opt-in), no backfill**: consent verified
  before a lead enters the pipeline — matches the project's CASL discipline.
- **Item 5 keeps full scope** — creates leads on unmatched bookings and syncs
  cancels/reschedules — with two guardrails from review: (a) `booking` leads get
  CASL implied-consent on an inquiry basis (`consent_source = 'booking-inquiry'`),
  and (b) a Cal.com cancel clears **only** webhook-created stamps, never a
  manually-set `call_booked`.
- **Nurture events are display-only (R9)**: keeps automated touches from
  corrupting the human-staleness signal the co-pilot depends on.

## Dependencies / Assumptions

- Cal.com supports booking webhooks (`BOOKING_CREATED` / `CANCELLED` /
  rescheduled) with a signing secret. Booking is confirmed Cal.com
  (`cal.com/peter.k/the120`, `NEXT_PUBLIC_BOOKING_URL`). **Verify the exact
  event names + signing scheme against Cal.com docs during planning.**
- Signals/sources live in `constants.ts`: `gauntlet-played` and `warm-convo`
  signals already exist; source `gauntlet` exists; sources for booking-created
  leads (`booking`) and manually-captured warm contacts are new/to-be-chosen and
  trivially added. (Exact warm-convo source value → deferred question below.)
- The `parents→families` DB trigger (`crm_core.sql:207-347`) is an existing
  precedent for auto-ingesting rows from another table into `families`.

## Outstanding Questions

### Deferred to Planning
- [Affects R10-R12][Technical] Ingest gauntlet entries via a DB trigger (mirroring
  `parents→families`) or in the confirm route (`app/api/gauntlet/tournament/confirm`)?
  Note: the `parents→families` trigger writes `family_notes` with a null author
  and **skips `crm_audit_log`** — so "follow the precedent" means these ingests
  are unaudited unless a system actor + new audit action are added.
- [Affects R13-R15][Needs research] Cal.com webhook event names, payload shape, and
  signature verification scheme. Also: how Cal.com models a reschedule (discrete
  event vs. cancel+create) — the latter degrades R14 into clear-then-restamp.
- [Affects R13/R15][Technical] `stampCall` (`families.ts:339`) opens with
  `requireStaff()` and writes `crm_audit_log`/`family_stage_history` keyed to a
  `staff.staffId` (`crm_audit_log.actor` is `uuid not null`). A webhook has no
  staff session, so the stamping logic must be extracted into a staff-less core
  with a synthetic/system actor before R13 can "reuse the stampCall path".
- [Affects R7/R10/R11/R13][Technical] Concurrency + idempotency for create-or-match:
  at-least-once webhook delivery and near-simultaneous same-email arrivals across
  paths can double-insert (colliding on `families_email_live_unique_idx`) or
  double-apply signals/stamps. Decide a conflict strategy (ON CONFLICT upsert vs.
  catch-and-rematch) and dedupe external events on a provider event/booking id.
  See the repo's "blind upsert on a public endpoint" solution note.
- [Affects R7/R11/R13][Technical] Unify the three "match live family by
  `lower(email)`, else create" call sites into one shared primitive so dedup/
  consent rules don't diverge; define the identity-resolution fallback when a
  booking/gauntlet email diverges from a family's CRM email (email-only matching
  fragments one person into multiple leads).
- [Affects R10/R11][User decision] Consent precedence when matching a family that
  **previously revoked** consent and now re-consents via gauntlet: does the fresh
  opt-in re-subscribe (R10) or does the prior opt-out win (R11)? CASL-sensitive.
- [Affects R4/R7][Technical] Match key for global warm-convo capture when **no
  email** is given — name-only matching risk (false merges); options: require
  email, create-always-when-emailless, or a "did you mean this family?" confirm
  step in the capture form.
- [Affects R4][Technical] Exact `source` value for a manually-captured warm
  contact (reuse `warm-network` vs. add a `warm-convo` source).
- [Affects R10/R11][Technical] Created gauntlet leads have **no parent name or
  phone** (`gauntlet_tournament_entries` stores only email/handle/consent) — decide
  the `parent_name`/`consent_source` to stamp so the pipeline isn't full of
  "Unnamed family" rows.
- [Affects R8][Design] Robot timeline event label is a **content** decision, not
  just technical: a generic "automated email" label leaves staff unable to see
  that the specific T+10 referral-ask (item 4's auto-dismiss trigger) is what
  cleared the nudge. Prefer sequence+step (e.g. "Deposit · T+10 referral ask").
- [Affects R1][Design] Where "Mark referral asked" lives — header action row
  (existing mutating-button pattern) vs. the co-pilot card (currently read-only;
  putting an action there is a new pattern).
- [Affects R4/R5/R6][Design] New-surface interaction specifics: weight of the
  global button vs. the existing single primary "Add family" CTA; the one-click
  in-drawer action's note-capture surface; whether the warm-floor heat write
  flips the family into the "manual override" display state; and post-submit
  matched-vs-created confirmation feedback.
- [Affects R9][Design] Once robot emails are visible on the timeline but
  deliberately don't move `last_touch_at`, relabel the "last touch" chip (e.g.
  "last human touch") so the staleness-vs-timeline gap doesn't read as a bug.
- [Affects R2][Technical] Exact write point for the auto-set — the cron's
  post-send success branch (not `sendNurtureEmail` / pre-send claim) — and key it
  to the sequence/step id, not email copy, so editing nurture text can't misfire it.

## Next Steps

-> `/ce:plan` for structured implementation planning.
