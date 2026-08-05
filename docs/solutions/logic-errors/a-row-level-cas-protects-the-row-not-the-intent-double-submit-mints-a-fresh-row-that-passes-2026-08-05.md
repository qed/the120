---
module: fp-image-lab
date: "2026-08-05"
problem_type: logic_error
component: api
severity: high
symptoms:
  - "A paid vendor call is made twice for one user intent, while every concurrency guard reports success"
  - "The comment above the guard names 'a second tab' as the threat it stops; a second tab is precisely what it does not stop"
  - "Both duplicate runs look completely legitimate in the data — same prompt, different ids, no collision anywhere"
root_cause: wrong_scope_of_guard
resolution_type: migration
tags:
  - idempotency
  - compare-and-swap
  - double-submit
  - concurrency
  - paid-external-call
  - unique-index
---

# A row-level CAS protects the ROW, not the INTENT — a double-submit mints a fresh row that passes it

## Problem

`fp_image_lab_images` rows are minted before any AI-image vendor call, and the
mark-attempt transition is an atomic compare-and-swap so two concurrent requests
cannot both dial the vendor for one cell:

```sql
update public.fp_image_lab_images
   set attempted_at = now()
 where id = $1 and state = 'requested' and attempted_at is null
returning *;
-- zero rows back ⇒ someone else has this cell ⇒ do NOT call the vendor
```

That CAS is correct. The comment above it was not. It claimed to be "the whole
defence against double spend … a staff user who gets impatient (or opens a
second tab) and fires the same cell twice."

A second tab does not fire the same cell. It does not know the first tab's image
ids. It POSTs the composed prompt, which mints **a new run plus a fresh set of
image rows with fresh uuids** — and every one of those passes its own CAS
cleanly, because nothing has ever touched them.

## Symptoms

- A compare run over 3 models is composed once and billed twice: 6 vendor calls
  for 3 intended cells.
- No error, no collision, no log line indicating anything unusual — the second
  run is indistinguishable from a deliberate re-run.
- Reproduces from a browser Reload on the POST, a double-clicked Generate
  button, or a second tab — all of which are routine when a request takes 30s+
  with no response.

## What Didn't Work

Strengthening the CAS. It was already correct at its own scope; adding
predicates to it cannot help, because the second request never touches the first
request's rows. The instinct to "make the concurrency guard stronger" is the
wrong axis entirely — the guard needed to move up a level, not tighten.

## Why This Happens

A CAS is keyed on an identifier that **must already exist**. It can therefore
only defend against a second visit to a row that is already there. The
user-visible duplicate-submit happens strictly *earlier* than that: at the point
where the intent is turned into rows in the first place.

Stated generally: **the guard's scope must match the thing you are deduplicating.**
Deduplicating attempts on a row ≠ deduplicating the user's intent.

## Solution

Add an intent-level key the client mints **once per compose**, and let the
database refuse the duplicate:

```sql
create table if not exists public.fp_image_lab_runs (
  id              uuid primary key default gen_random_uuid(),
  staff_id        uuid not null,
  idempotency_key text not null,
  …
);

-- scoped per staff member so two people composing concurrently never collide
create unique index if not exists fp_image_lab_runs_staff_idempotency_idx
  on public.fp_image_lab_runs (staff_id, idempotency_key);
```

A resubmitted compose collides on the unique index; the route returns the
existing run instead of minting a second one. The per-row CAS stays exactly as
it was — it is now the second line of defence it was always shaped like, rather
than the only one.

## Why This Works

Two different duplicates need two different guards, at two different scopes:

| Duplicate | Scope | Guard |
|---|---|---|
| Same cell fired twice (retry, two tabs holding one run) | row | atomic CAS on `attempted_at is null` |
| Same intent submitted twice (reload, double-click, new tab) | intent | unique `(actor, idempotency_key)` |

Neither substitutes for the other, and the row-level one is the one that *feels*
like concurrency protection — which is why it gets written first and then
over-credited in its own comment.

## Prevention

- **Read the comment above a concurrency guard as a claim to be falsified.**
  Ask: "what exactly does the second request carry?" If the answer is "a fresh
  id", the guard cannot see it. This defect was found by an adversarial review
  doing precisely that, not by a test.
- **Any route that spends money needs an idempotency key**, minted by the
  client at intent time, enforced by a unique index — not by a check-then-insert
  (which has the same TOCTOU problem one level up).
- Prefer scoping the key per actor (`(staff_id, idempotency_key)`) so two users
  cannot collide with each other's keys.
- Stamp intent before the effect regardless — see
  `docs/solutions/logic-errors/an-external-already-exists-cannot-tell-mine-from-foreign-stamp-intent-before-the-effect-2026-07-29.md`
  — but note that stamping intent *first* is what makes the duplicate-intent
  case possible at all, so the two rules ship together.

## Related

- `docs/solutions/best-practices/claim-before-spend-the-priced-external-call-runs-only-after-the-row-level-claim-2026-07-28.md`
  — **read this one with the correction above.** It establishes the row-level
  claim as the mechanism that bounds priced spend, which is right as far as it
  goes: it bounds *attempts per row*. It does not bound *intents*, and this
  document is the missing half.
- `docs/solutions/logic-errors/idempotency-key-unique-scope-wider-than-the-operation-it-names-silently-swallows-distinct-writes-2026-07-23.md`
  — the opposite failure once you add a key: a uniqueness scope wider than the
  operation swallows writes that were genuinely distinct.
- `docs/solutions/best-practices/a-server-side-timeout-does-not-bound-a-request-that-never-lands-bound-the-clients-own-await-2026-07-27.md`
  — the client-side await bound; a client that times out *before* the server
  budget expires is what makes the user reach for Reload in the first place.
- `docs/solutions/integration-issues/a-stable-idempotency-key-over-params-that-embed-versioned-content-locks-out-retries-after-a-bump-2026-08-02.md`
  — how to choose what the key covers, once you have one.
