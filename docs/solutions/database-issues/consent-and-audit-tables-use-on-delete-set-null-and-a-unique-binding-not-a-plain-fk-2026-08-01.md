---
title: "A compliance/audit record's FKs should be ON DELETE SET NULL (not RESTRICT or CASCADE), and its 'binding' column needs a UNIQUE constraint — a plain FK is an app assumption, not a DB invariant"
date: 2026-08-01
category: database-issues
module: fp-signup
problem_type: database_issue
component: schema
symptoms:
  - "A consent/audit record references a child/parent/attempt via a plain FK; deleting the referenced row either blocks (RESTRICT) or destroys the evidence (CASCADE)"
  - "A record is supposed to bind to exactly one target, but nothing stops two records binding one target to different things"
root_cause: schema_design
resolution_type: code_fix
severity: medium
tags:
  - foreign-key
  - on-delete
  - consent
  - audit
  - unique-constraint
  - coppa
  - data-retention
related_components:
  - database
  - fp-signup
---

# Compliance/audit records: SET NULL FKs + a UNIQUE binding, not a plain FK

## Problem

First Profit Slice B added `fp_parental_consent` — a verifiable-parental-consent
record that references the child, parent, and signup attempt it was captured for.
Two schema-shape questions decide whether it works as compliance evidence:

1. **What happens to the consent record when the child/parent is deleted?**
2. **What stops one signup attempt from getting two consent records bound to
   different children?**

The naive answers (RESTRICT FKs; a plain non-unique FK on the binding column) are
both wrong for a compliance record.

## What Didn't Work

- **`ON DELETE RESTRICT`** (the posture the sibling `fp_player_*` game tables use):
  correct there (fail loudly rather than lose game state), but for a consent record
  it means a routine account deletion (R28 data-rights erasure, or a CRM parent
  delete) is BLOCKED while any consent row references the child — the deletion the
  law requires can't complete.
- **`ON DELETE CASCADE`**: deleting the child would DESTROY the consent evidence —
  the opposite failure. Compliance evidence must survive the deletion of the account
  it references (it's the proof you were allowed to create that account); a
  deliberate erasure request deletes it EXPLICITLY, in a controlled order.
- **A plain (non-unique) FK on `signup_attempt_id`** to "bind" consent to the
  attempt: the comment says the binding prevents mis-attaching consent to the wrong
  child at mint time, but nothing in the schema enforces one active consent per
  attempt. Two rows (a duplicate submit, a retry) leave mint-time code with two
  candidates and no rule — the exact mis-attachment the binding exists to prevent.

## Solution

- **FKs `ON DELETE SET NULL`.** The record survives account deletion (unlinks
  rather than blocks or cascades); a routine delete succeeds; an explicit erasure
  request deletes the consent row itself in order.
  ```sql
  child_id  uuid references public.children (id) on delete set null,
  parent_id uuid references auth.users   (id) on delete set null,
  signup_attempt_id uuid references public.fp_signup_attempts (id) on delete set null,
  ```
- **A partial UNIQUE index makes the binding a DB invariant**, not an app
  assumption — at most one ACTIVE consent per attempt:
  ```sql
  create unique index if not exists fp_parental_consent_attempt_active_uidx
    on public.fp_parental_consent (signup_attempt_id)
    where revoked_at is null and signup_attempt_id is not null;
  ```
  (`where revoked_at is null` still allows a revoke-then-re-consent history.)

## Why This Works

SET NULL decouples the record's lifetime from the referenced rows' lifetime, which
is exactly what an evidence record needs: it outlives what it references, and is
removed only by an intentional erasure step. The partial unique index turns "one
consent per attempt" from something mint-time code must get right unaided into
something the database refuses to violate — so a duplicate submit fails at write
time instead of silently creating an ambiguous pair.

## Prevention

- **Decide FK `ON DELETE` behavior per the record's PURPOSE, not by house default.**
  Operational/state rows: RESTRICT (fail loud) or CASCADE (clean up with the parent).
  Evidence/audit/consent rows: SET NULL (survive the delete; erase explicitly).
- **If a column is described as "binding" or "the anchor that prevents X," back it
  with a UNIQUE (often partial) constraint.** A plain FK expresses "references" not
  "at most one" — the invariant you're relying on is only an assumption until the
  DB enforces it.
- **Capture must-capture legal fields as NOT NULL / non-empty-checked** (age band,
  jurisdiction) so a caller bug can't silently persist an empty, unretrofittable
  value — use `NOT VALID` then `VALIDATE` to stay non-blocking on existing rows.
- Sibling record: the `fp_player_tables` RESTRICT posture (correct for game state) —
  the contrast is the point: same project, opposite FK posture, because the records
  serve opposite purposes.
