---
title: "A blind `upsert(onConflict:\"col\")` on a public write endpoint is two bugs: it can't infer a `lower(col)` expression index, and it lets anyone overwrite another party's row"
date: 2026-07-16
category: docs/solutions/database-issues
module: gauntlet / tournament entries
problem_type: database_issue
component: database
symptoms:
  - "PostgREST upsert with onConflict naming a bare column can 503 when the only uniqueness is a functional index on lower(col)"
  - "A public, unauthenticated upsert lets a second caller overwrite an existing row (email, consent, confirmation) by reusing its conflict key"
root_cause: wrong_api
resolution_type: code_fix
severity: high
related_components:
  - authentication
tags: [supabase, postgrest, upsert, on-conflict, expression-index, functional-index, casl, consent, ownership, public-endpoint]
---

# A blind `upsert(onConflict:"col")` on a public write endpoint is two bugs

## Problem

The unauthenticated tournament-entry route (`app/api/gauntlet/tournament/enter/route.ts`) wrote entries with `db.from("gauntlet_tournament_entries").upsert({...}, { onConflict: "handle" })`. That single call carries two independent defects: PostgREST cannot reliably resolve `onConflict: "handle"` against a **functional/expression** unique index (`unique (lower(handle))`), and — because the upsert blindly overwrites on conflict — anyone who reuses an existing handle **overwrites that family's `parent_email`, CASL `consent`, and `confirmed_at`** (a PII/consent-hijack, P0).

## Symptoms

- **Conflict-target inference:** the table's uniqueness is `create unique index … on gauntlet_tournament_entries (lower(handle))` — an *expression* index, not a constraint on the bare `handle` column. `ON CONFLICT (handle)` has no matching unique index/constraint to infer, so the write can fail (surfacing here as a 503 from the route's error branch) rather than performing the intended upsert. (Flagged by review as "likely errors — verify before building on it"; avoided rather than reproduced.)
- **Silent overwrite / hijack:** with the upsert succeeding, a second submission reusing a taken handle updates the existing row — resetting `parent_email` to the new caller's address, re-stamping `consent`, and nulling `confirmed_at`. A griefer who knows a family's handle knocks their confirmed entry off the board and redirects their standings mail. Nothing errors; consent state just changes without the owner acting (same harm class as the forged-consent doc below).

## What Didn't Work

- **`onConflict: "handle"` (bare column).** PostgREST needs the conflict target to match an actual unique constraint or index *specification*; a functional index on `lower(handle)` is not addressable as `(handle)`. Relying on it is fragile across PostgREST versions and silently wrong at best.
- **Treating a handle collision as "same family re-entering."** The upsert design assumed a conflict only ever meant the original submitter updating their own row. On a public endpoint with a guessable, self-chosen key, that assumption is false — and it's what enables the hijack.
- **Accepting `parent_email` as proof of ownership.** Email is not a secret; anyone who knows the target's email would pass an email-match check. It cannot gate a privileged overwrite.

## Solution

Drop the blind upsert. **Select first, then branch explicitly** — and never overwrite a *confirmed* row:

```ts
// Look up the existing entry case-insensitively (matches the lower(handle) index),
// so we branch on real state instead of relying on conflict inference.
const { data: existing, error } = await db
  .from("gauntlet_tournament_entries")
  .select("id, confirmed_at, last_email_at")
  .ilike("handle", handle)
  .maybeSingle();
if (error) return json({ error: "Entries aren't open yet — try again soon." }, 503); // table absent → degrade, never 500

if (existing) {
  if (existing.confirmed_at) {
    // P0 fix: a CONFIRMED entry (a consented lead) is never overwritten.
    return json({ error: "That handle's taken — pick another." }, 409);
  }
  // still-pending: safe to refresh (the common typo/resend case), with a resend throttle
  await db.from("...").update({ /* new email, token, consent_at, confirmed_at: null */ }).eq("id", existing.id);
} else {
  await db.from("...").insert({ /* ... */ }); // plain insert; a real race loses to the index, which is correct
}
```

Ownership for any *update* branch is proven by a **session `user_id`** or the **original `confirm_token`** — never `parent_email`. The double-opt-in stays intact because overwriting a pending row still requires a fresh confirmation click.

## Why This Works

- **Explicit select-then-branch removes the conflict-inference dependency entirely** — the code reads the row (via `ilike`, which the `lower(handle)` index serves) and decides, so there is no `ON CONFLICT` target to mis-resolve. A genuine concurrent insert race simply loses to the unique index and returns an error, which is the correct outcome for a duplicate handle.
- **Protecting confirmed rows closes the hijack at the state level, not the identity level.** You don't need to authenticate the guest to stop the P0 — you just refuse to destroy a row that already represents a real, consented lead. Pending rows carry no confirmed consent, so refreshing them is low-harm and preserves the legitimate "fix my typo'd email" path.

## Prevention

- **Never `upsert(onConflict: "x")` against a functional/expression unique index.** Either add a plain unique *constraint* the target can name, or (preferred for anything with authz/merge nuance) select-then-branch. Grep `create unique index .* on .*(lower(|upper(|coalesce(` before writing an upsert against a table.
- **On any public/unauthenticated write, an upsert is an authorization decision.** "Conflict → update" silently grants overwrite to whoever presents the key. Decide explicitly: reject, or update only with proof of ownership (session id / secret token — **not** a guessable field like email).
- **Protect the row states that represent real consent/leads.** Make "confirmed/consented" rows immutable to re-submission; only mutate not-yet-confirmed rows.
- **Keep the table's own graceful-degradation contract:** on a missing table (pre-migration) return a soft 503, never a 500 — the select-then-branch preserves this because the read error is caught before any write.

## Related Issues

- `docs/solutions/security-issues/supabase-autoconfirm-forged-consent-email-confirmation-signup-retrofit-2026-07-13.md` — the same "row/consent overwritten via a shared, guessable key" harm class, via the `on_parent_created` email-merge trigger. This is the public-endpoint upsert variant.
- `docs/solutions/security-issues/state-changing-email-links-mutate-on-get-scanner-prefetch-false-confirm-2026-07-16.md` — sibling fix from the same tournament-hardening pass (double-opt-in confirm must POST, not GET).
- `docs/solutions/database-issues/upsert-insert-arm-poisons-excluded-status-guard-coercion-submit-fails-2026-07-14.md` and `…/stale-status-echo-full-row-upsert-vs-trigger-guard-coerce-not-raise-2026-07-14.md` — the repo's other "prefer targeted UPDATEs over upserts when state/guards are involved" lessons.
