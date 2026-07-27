---
title: "a fire-and-forget beacon that re-derives identity server-side attributes to whoever holds the session when the POST lands — log the sender AND the claim"
date: 2026-07-27
module: staff-bar residue beacon (app/lib/staff-bar/actions.ts, StaffBar.tsx)
category: integration-issues
problem_type: integration_issue
symptoms:
  - "Telemetry/audit log lines name an account that was not involved in the event they describe"
  - "A device report filed under the NEXT user after a handover"
root_cause: "The Server Action attributed the event to the live session at processing time, but the event was observed on the client at an earlier time, and the session changed in between"
resolution_type: schema_change
tags: [server-actions, telemetry, attribution, race-condition, shared-device, audit]
last_updated: 2026-07-27
---

# A fire-and-forget beacon that re-derives identity server-side attributes to whoever holds the session when the POST lands

## Problem

Unit 5 added a residue beacon: when a shared iPad finishes a handover still holding
another account's un-landed check-ins, the client fires a Server Action that writes
one `[fw/residue]` log line so a human at a desk can go find the device. For sound
security reasons the action refused to trust a client-supplied account id and
re-derived the actor from the live session (`getUser()`).

Two sound decisions, one race. **The client observes the outcome at time T1; the POST
lands at time T2; a handover between them changes what the server derives.** Guide A's
reconcile detects `clear_failed`, the beacon POST crawls off over venue wifi, A signs
out, B signs in, the POST lands — and the log attributes A's residue to B. The person
reading the log to "go find the device" chases the wrong account. Fire-and-forget
makes the window ordinary rather than exotic: nothing awaits the beacon before the
session can change, by design.

## What Didn't Work

- **Trusting the client's id** — rejected first, correctly: an endpoint that records
  whatever account id it is handed lets any caller attribute residue to an arbitrary
  account, and this record's whole value is that a human acts on the name in it.
- **Deriving from the live session** — the misattribution above. Each option fixes
  the other's flaw; neither alone is right.

## Solution

Carry **both identities as different facts**, because they answer different questions:

```ts
const residueBeaconSchema = z.object({
  // ...
  /** The actor the CLIENT observed the outcome for — a CLAIM, not the attribution.
   *  Constrained to a uuid so nothing free-text can ride into the log line. */
  claimedActorUserId: z.uuid(),
});

// server side, after zod:
console.log(`[fw/residue] ${JSON.stringify({
  sessionUserId: sessionUser.id,        // WHO SENT THIS — authenticated
  claimedActorUserId: parsed.data.claimedActorUserId, // who the device says it was
  // ...
})}`);
```

`sessionUserId` is authenticated and answers "who transported this report".
`claimedActorUserId` is untrusted data (validated to a uuid, never free text) and
answers "who the device observed". **They differ exactly when a handover raced the
POST — the mismatch IS the race, made visible** instead of silently resolved in
favour of the wrong answer. A session-less POST is still dropped: with no
authenticated sender there is nobody safe to attribute even transport to.

Same payload, three more rules that came out of the same review:

- **A device identifier**, because the beacon's question was "WHICH iPad" and an
  account id cannot answer it — one guide signs into several devices across a
  weekend. A random uuid persisted in localStorage is enough; on storage failure
  every beacon carries a fresh one, which itself reads at the desk as "an
  unpersistable device".
- **`console.log`, not `console.error`, for the routine line.** Error-level telemetry
  on a successful path teaches severity-based alerting to ignore the prefix.
- **Don't pay for identity you don't use.** The first draft ran the full session
  loader (auth round trip + grants query) to attribute a log line; the grants exist
  to compute a role nothing in a log line reads. One bounded `getUser()`.

## Why This Works

Client-observed-time and server-processed-time are different points on a shared
device's timeline, and a fire-and-forget POST guarantees the gap. No single identity
field can be simultaneously authenticated and contemporaneous with the observation —
so stop trying to pick one, and record the disagreement as data.

## Prevention

Any endpoint that (a) is called fire-and-forget from a client, (b) describes an event
observed EARLIER on that client, and (c) attributes it to "the current user" has this
race. Shared devices make it common instead of rare. The pattern: authenticated
sender + validated claim, both logged, mismatch meaningful.

## ROUND 2 (Unit 6, 2026-07-27) — the race has a second victim, and the open endpoint has a second problem

The durable table landed (`path_fw_residue_reports`), and its review found two more
lessons in the same mechanism:

**1. Fire-and-forget against `auth.signOut()` does not misattribute — it DROPS.**
The success-path report was dispatched fire-and-forget moments before the sign-out
action ran. Two independent requests, no ordering: when the sign-out's
`auth.signOut()` won, the beacon's own `getUser()` found a dead session and the
report was dropped entirely — silently, on the single most common residue-leaving
path, the one the feature was approved to cover. The Round-1 fix (log sender AND
claim) cannot help here; there is no sender left to log.

**The fix is structural: a report about a session is written by the request that
still holds the session.** `signOutStaffBar` takes the residue payload as a second
zod-validated argument and writes the row itself, before ending the session. Same
request, same session context, no race, and authenticated by construction. The
fire-and-forget action remains only for paths where the session outlives the report
(the mount-time reconcile, the refused sign-out).

**2. A table humans ACT on, fed by an open endpoint, needs a role gate — zod is not
authorization.** The Server Action validated shape (uuids, enums, bounds) and
required only "any authenticated session". Any parent or student account could
therefore insert well-formed rows naming arbitrary claimed actors and devices —
poisoning the exact "which iPads hold un-landed work?" query staff would physically
act on. Every legitimate sender holds a role by construction (the bar mounts only on
guarded layouts), so gating on `isStaff || isFwGuide` loses nothing; a per-user rate
limit bounds a looping bundle. The test that pins it: a role-less session produces
NO row, and the 21st report in a window is dropped.
