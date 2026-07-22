---
title: "Dedupe best-effort transactional email with an atomic claim-then-send on a DB-guarded, server-owned stamp column"
date: 2026-07-14
category: best-practices
module: admissions-submission-notification
problem_type: best_practice
component: email_processing
severity: medium
applies_when:
  - "A client-triggered action (submit, checkout, signup) should fire an internal notification exactly once, best-effort"
  - "The dedupe marker lives in a column the client's own REST/ORM write could otherwise touch"
  - "Two concurrent invocations (double-click, retry, multiple tabs) could each observe 'not sent yet' and both send"
  - "The notification is a nudge backed by a reliable side channel elsewhere (a queue badge, a status flag) — not the system of record"
  - "The send runs inside a short-lived serverless request that must not hang on a slow provider"
related_components:
  - app/api/notify-submission/route.ts
  - app/lib/email.ts
  - supabase/migrations/20260714200000_add_submission_notified_at.sql
  - app/dashboard/DossierEditor.tsx
tags:
  - dedupe
  - race-condition
  - server-owned-column
  - trigger-guard
  - atomic-update
  - best-effort
  - fire-and-forget
  - transactional-email
---

# Dedupe best-effort transactional email with an atomic claim-then-send on a DB-guarded, server-owned stamp column

## Context

The dossier wizard needed to notify admissions@the120.school exactly once per submitted dossier (PR #5, R15) — without blocking the submit UX, without a queue/retry infrastructure, and without becoming a vector a parent could exploit to suppress or re-trigger emails. The naive shape — read a `notified` flag, send if false, then write it true — has two independent failure modes: a **race** (two concurrent invocations both read false and both send) and a **forgery hole** (the flag lives on a client-writable table, so a direct REST write could clear or pre-set it). Both were caught by review (security + reliability personas in the 13-reviewer pass) before ship.

## Guidance

**1. Make the dedupe column server-owned two ways, not one.** A client-side convention (the row serializer never includes it) is forgeable by any direct PostgREST call with the same JWT. Back it with a DB trigger that coerces — never raises — any non-service-role write:

```sql
-- supabase/migrations/20260714200000_add_submission_notified_at.sql
create or replace function public.children_notified_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.role() = 'service_role' then return NEW; end if;
  if TG_OP = 'INSERT' then
    NEW.submission_notified_at := null;
    return NEW;
  end if;
  if NEW.submission_notified_at is distinct from OLD.submission_notified_at then
    NEW.submission_notified_at := OLD.submission_notified_at;
  end if;
  return NEW;
end; $$;

create trigger children_notified_guard
  before insert or update of submission_notified_at on public.children
  for each row execute function public.children_notified_guard();
```

A parent's REST call can neither clear the stamp (re-trigger emails) nor pre-set it (suppress the notification); the rest of the row still writes (coerce-not-raise, same discipline as `children_status_guard` — see Related).

**2. Claim atomically, then send — never send-then-stamp.** The service-role client issues a conditional UPDATE and only sends if it actually claimed a row:

```ts
// app/api/notify-submission/route.ts
const { data: claimed } = await supabaseAdmin()
  .from("children")
  .update({ submission_notified_at: new Date().toISOString() })
  .eq("id", childId)
  .is("submission_notified_at", null)
  .select("id");
if (!claimed || claimed.length === 0) {
  return NextResponse.json({ ok: true, already: true }); // someone already claimed
}
```

`UPDATE … WHERE col IS NULL` makes check-and-claim one atomic statement — Postgres row locking does what a mutex would, for free, across serverless instances. Two concurrent invocations both attempt it; only one flips `null → now()` and gets a row back.

**3. On send failure, best-effort unclaim — and make the send unable to hang or throw.** `sendEmail` is never-throw with a hard timeout:

```ts
// app/lib/email.ts
try {
  const res = await fetch("https://api.resend.com/emails", {
    // A hanging provider must not pin the serverless request open.
    signal: AbortSignal.timeout(8000),
    ...
  });
  if (!res.ok) return { ok: false, error: `Resend ${res.status}: ...` };
  return { ok: true };
} catch (err) {
  return { ok: false, error: err instanceof Error ? err.message : "Send failed" };
}
```

```ts
// app/api/notify-submission/route.ts — failure path
if (!result.ok) {
  try {
    await supabaseAdmin().from("children")
      .update({ submission_notified_at: null }).eq("id", childId);
  } catch (unclaimErr) {
    console.error("[notify-submission] unclaim failed:", unclaimErr);
  }
  return NextResponse.json({ error: "Send failed" }, { status: 502 });
}
```

Without the never-throw contract, a rejected fetch throws *between* claim and unclaim, leaving the row permanently claimed-but-unsent — the reliability reviewer caught exactly this in the original draft.

> ⚠ **Caveat (2026-07-15): this unconditional unclaim is only safe when the flow never resends.** If re-sends are possible, a failed racer's blind restore can clobber a concurrent successful resend's stamp (erasing the record of a real email and re-arming a double send). Guard the restore with `.eq(stampColumn, theStampYouClaimed)` and treat zero-rows-restored as "superseded — adopt the newer stamp, no warning". See [resend-safe-atomic-claim-then-send-cas-guarded-claim-and-unclaim-2026-07-15.md](resend-safe-atomic-claim-then-send-cas-guarded-claim-and-unclaim-2026-07-15.md) for the CAS-guarded variant (`sendOfferEmail` in `app/crm/lib/actions/reviews.ts`, `unclaimOutcome` in `app/crm/lib/offer-rules.ts`).

**4. Invoke fire-and-forget from the client, after the confirmed save — never before:**

```ts
// app/dashboard/DossierEditor.tsx (doSubmit)
if (res.ok) {
  // Best-effort — a send failure must never affect the submit UX;
  // the CRM needs-review badge is the reliable signal.
  void fetch("/api/notify-submission", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ childId: child.id }),
  }).catch(() => {});
}
```

**5. Let RLS carry the ownership check.** The route fetches the child under the *caller's* client before ever touching the admin client — a `childId` for someone else's child simply returns no row. Only after ownership is established does the privileged claim UPDATE run.

## Why This Matters

Three cheap, composable pieces close two races and one forgery hole — with no job queue, idempotency-key table, or retry system:

- **Check-then-act double-send race**: folding the check into the UPDATE's WHERE clause removes the window entirely.
- **Claimed-but-unsent stamp**: a throwing send between claim and unclaim silently blackholes all future sends for that entity; never-throw + bounded timeout guarantees the failure path runs.
- **Forgeability**: an application-code convention protects only the paths you wrote; the DB coerce trigger makes the guarantee independent of which client writes.

## When to Apply

- The notification is a **nudge, not the system of record** — a reliable secondary signal (here, the CRM needs-review badge) survives a rare lost email, so best-effort with no retry channel is acceptable.
- The trigger is client-initiated with no durable queue already guaranteeing single delivery.
- The dedupe state must live on a client-writable table (if you control a server-write-only outbox table instead, the coerce trigger may be unnecessary).
- Do **not** use this where true exactly-once delivery is required (billing receipts, legal notices) — that calls for a durable queue with idempotency keys and real retries.

## Examples

**Before (check-then-act — both races open):**

```ts
const { data } = await admin.from("children").select("notified_at").eq("id", id).single();
if (data.notified_at) return already();
await sendEmail(...);   // two racers both reach here; a throw skips the stamp entirely
await admin.from("children").update({ notified_at: now }).eq("id", id);
```

**After (claim-then-send, as shipped):** the conditional-UPDATE claim in §2, gated by the trigger in §1, wrapped by never-throw send + unclaim in §3, invoked fire-and-forget in §4, under an RLS-scoped ownership fetch in §5. Only the invocation whose claim returns a row ever sends; every other concurrent invocation gets `{ ok: true, already: true }`.

## Related

- [resend-safe-atomic-claim-then-send-cas-guarded-claim-and-unclaim-2026-07-15.md](resend-safe-atomic-claim-then-send-cas-guarded-claim-and-unclaim-2026-07-15.md) — **the resend extension of this pattern**: CAS claims on the last-seen stamp, CAS-guarded unclaim (see the §3 caveat above), opaque-string stamp round-trip, stamp-table disambiguation.
- [in-memory-rate-limiter-toctou-race-and-fifo-eviction-clears-lockout-2026-07-22.md](in-memory-rate-limiter-toctou-race-and-fifo-eviction-clears-lockout-2026-07-22.md) — **the same check-then-act race at a different atomicity layer**: this doc collapses check-and-mutate into a DB conditional `UPDATE … WHERE col IS NULL` (row-locking, safe *across* serverless instances); that one collapses it into a single synchronous JS step with no `await` between read and write (safe only *within* one warm instance). Pick the DB mechanism when cross-instance correctness matters.
- `docs/solutions/database-issues/stale-status-echo-full-row-upsert-vs-trigger-guard-coerce-not-raise-2026-07-14.md` — shares the server-owned-column principle (payload whitelist + coerce-not-raise trigger), applied there to `status` against a different failure. Overlap on the prevention dimension only.
- `docs/solutions/database-issues/upsert-insert-arm-poisons-excluded-status-guard-coercion-submit-fails-2026-07-14.md` — reinforces §2's deeper rule: state transitions belong in **targeted UPDATEs**, never upserts, when coercing BEFORE INSERT guards exist (`EXCLUDED` inherits the coercion).
- `docs/solutions/security-issues/admissions-notification-email-html-injection-via-unescaped-child-parent-names-2026-07-14.md` — same route, different lesson (escaping user text in the email body).
- Implementation: `app/api/notify-submission/route.ts`, `app/lib/email.ts`, `supabase/migrations/20260714200000_add_submission_notified_at.sql`, `app/dashboard/DossierEditor.tsx`.
