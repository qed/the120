---
module: funnel-applicant-state
tags: [state-machine, triggers, forward-only, service-role, rehearsal]
problem_type: logic-error
---

# Key a state-machine exception by previous state, not by the target pairs you enumerated

## The setup

`children.applicant_state` advances along a forward-only ladder, enforced
by a BEFORE-UPDATE trigger that declines any backwards walk:

```
added → project_created → submitted → in_review → offered → waitlisted → deposited → enrolled
```

`waitlisted` sits **above** `offered`. So the waitlist move needs the
ladder broken deliberately — and the requirements named the transitions
it needed: *→ waitlisted*, *waitlisted → in_review*, *waitlisted →
offered*.

## The bug that framing produces

Write the exception as those three target pairs and you have shipped a
trap. Staff can also pick **`invited`** from the ordinary move menu. That
maps to `in_review`, which is *below* `waitlisted`, so the trigger
declines it — leaving `children.status = 'invited'` with `applicant_state`
still `waitlisted`. The family sits on the waitlist wall with checkout
refused, and nothing errors.

The enumerated list was never the real rule. The rule is: **whenever the
PREVIOUS state is `waitlisted`, write the target explicitly.** Keyed that
way, `invited` — and every future menu entry nobody has thought of — is
covered for free.

Generalised: when you carve an exception out of a state machine, key it on
the state you are *leaving*, not on the pairs you happened to enumerate.
A target list is a snapshot of today's UI; the origin state is the actual
invariant.

## Two mechanics that made it safe

**One UPDATE, not two.** The RPC sets `status` and `applicant_state` in a
single statement. The sync trigger fires `BEFORE UPDATE OF status` and
takes its forward-only baseline from `NEW.applicant_state` — the value
just written — so it can only ever agree with the explicit write. Split
into two statements and the invariant silently moves onto a different
trigger's service-role carve-out. Pinned by a scan test asserting the
function contains exactly one `update public.children`.

**Never change the signature.** `CREATE OR REPLACE` with a new parameter
mints a PostgREST *overload*, and every already-deployed caller starts
getting 300s the moment the migration applies.

## The rehearsal trap that nearly read as a bug

Rehearsing the transitions through the Supabase **Management API** showed
`status` never moving and `waitlisted` never sticking — a perfect
impression of a broken migration.

It was the connection. The Management API runs as `postgres`; the guards
bypass only for `service_role`, so both coerced the writes back. Set the
claim first:

```sql
perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
```

**Rehearse production writes inside a transaction that cannot commit.** Do
the moves in a `do $$ … $$` block and end with `raise exception` carrying
the collected results: the raise guarantees rollback, and the API returns
the results in the error message. Verified the whole chain against live
data and left nothing behind — no rows, no audit entries.
