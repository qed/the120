# The 120 CRM — Pipeline Stages Update — Build Spec

**Version 1.0 — July 20, 2026**
**For:** Ethan (build owner) · **From:** GTM sprint (Week 2)
**Deliverable:** Add three funnel stages to the Pipeline so the CRM mirrors the real sales motion instead of jumping Interested → Dossier Submitted.

---

## 1. The problem

The Pipeline today has three stages — **Interested → Dossier Submitted → Deposit Paid.** But the real motion (and the way deposits actually close) runs through a conversation and a call *before* a dossier ever appears. Right now 8 families who've had a call held and 16 in real conversation are all invisibly lumped into "Interested," so we can't see where families stall or measure conversion between steps.

## 2. The change

Insert three stages **between Interested and Dossier Submitted**, in this order:

`Interested → Conversation → Call Booked → Call Held → Dossier Submitted → Deposit Paid`

### Stage definitions

| Stage | Definition (entry criteria) | How a family enters it |
|---|---|---|
| **Interested** | In the system, consented, no two-way contact yet | Account created / RSVP / opt-in form (unchanged) |
| **Conversation** | A real two-way exchange has happened (reply received, not just a send) | Manual set by Peter, or auto when an inbound reply is logged |
| **Call Booked** | A call is on the calendar, not yet held | **Auto** when a Cal.com booking is created and matched to the family by email; manual override allowed |
| **Call Held** | The intro call happened | **Auto** from Cal.com "completed" status where available; else manual after the call |
| **Dossier Submitted** | Child dossier submitted for review | Existing trigger (unchanged) |
| **Deposit Paid** | $250 deposit paid (live Stripe) | Existing trigger (unchanged) |

> Note: a family can reach a stage without the earlier one being explicitly logged (e.g. an inbound stranger books a call directly). Treat stages as a **furthest-reached** marker, not a mandatory sequence — the pipeline shows the deepest stage a family has hit.

## 3. UI requirements

- **Filter chips** (top of Pipeline): add `CONVERSATION`, `CALL BOOKED`, `CALL HELD` with live counts, in funnel order, between `INTERESTED` and `DOSSIER SUBMITTED`. Keep `ALL`, `WARM NETWORK`, `NEEDS ATTENTION`.
- **Kanban view:** one column per stage, same order. Cards drag between columns and update stage on drop.
- **Table view:** the existing Stage column uses the new values; keep it sortable in funnel order (add a stage rank so sorting isn't alphabetical).
- **Stage pills:** extend the existing status-pill styling to the three new stages (suggest a cool-to-warm ramp so "further right" reads as "hotter").

## 4. Data / migration

- Add the three values to the stage enum with an explicit **rank** (Interested=1, Conversation=2, Call Booked=3, Call Held=4, Dossier=5, Deposit=6) so ordering is data-driven everywhere.
- **Backfill the current 32 families** to their true stage (Peter has the mapping): ~6 not-yet-messaged and messaged-only stay **Interested**, 8 in real dialogue → **Conversation**, and the **Call Held** cohort → **Call Held**, with the 2 dossiers and 1 deposit already correct. Peter will confirm the exact per-family assignment.
- Preserve stage-change timestamps (created_at per stage transition) — needed for the weekly metrics and to spot stalls.

## 5. Why it's worth doing now (ties to the tracker)

These stages are exactly the funnel the GTM tracker measures each Friday (Conversation → Call Booked → Call Held → Deposit). Once the CRM emits them, the weekly numbers come straight from the Pipeline instead of Peter counting by hand, and the "stalled 14 days at any stage" nurture trigger (sprint §5) becomes automatable.

## 6. Open questions for Peter / Ethan

1. **Auto vs. manual:** confirm Cal.com can fire booking-created and call-completed webhooks we can match by email. If not, Call Booked/Held start manual.
2. **Split "Interested"?** Worth a lightweight `Contacted` (messaged, no reply) sub-state so "6 not messaged vs. 10 messaged-no-reply" is visible? (Optional — Peter asked for the three above; flag if you want it.)
3. **"Needs Attention"** logic: should a family auto-flag into Needs Attention after N days with no stage change? (Pairs naturally with the new stages.)
4. **No-show handling:** if a booked call is missed, does it revert Call Booked → a "No-show" state or stay Call Booked with a flag?
