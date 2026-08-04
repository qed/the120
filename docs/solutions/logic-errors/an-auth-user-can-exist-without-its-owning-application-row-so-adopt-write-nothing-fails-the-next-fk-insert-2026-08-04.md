---
module: fp-provisioning
date: 2026-08-04
problem_type: logic_error
component: authentication
severity: high
symptoms:
  - "An adopt branch classifies a contact as existing, then every child insert fails 23503 on children.parent_id"
  - "auth.users has a row for an email but public.parents does not"
  - "A dual-table pre-check against parents and families classifies a contact as new when an auth user already exists"
root_cause: incomplete_setup
resolution_type: code_fix
related_components:
  - database
  - tooling
tags: [supabase, auth, provisioning, foreign-key, 23503, adoption, half-state, tri-state]
applies_when:
  - "Deciding whether a contact already exists before provisioning them"
  - "Writing an 'adopt existing, write nothing' branch"
  - "Any flow where auth.users and an application-owned table are populated by separate steps"
---

# An auth user can exist without its owning application row — so "adopt, write nothing" fails the next FK insert

## Problem

A cohort runner's adopt branch was defined as: if the email resolves to an
`auth.users` row, the parent exists — make **zero** parent-side writes and go
straight to inserting their children. One real contact had an
`auth.users` row and **no `public.parents` row**. `children.parent_id` is
`uuid not null references public.parents (id)`, so both of her children's
inserts would have failed with `23503`, mid-family, after other families had
already been written.

## Symptoms

- `insert or update on table "children" violates foreign key constraint
  "children_parent_id_fkey"` (SQLSTATE `23503`) immediately after a branch that
  logged "parent: ADOPT".
- An email that a `parents` + `families` pre-check reports as new, but
  `auth.admin.listUsers` finds.
- A CRM `families` row that is still a LEAD (`parent_id IS NULL`) even though an
  auth account for that address exists — the tell that `on_parent_created` never
  fired, because it is `AFTER INSERT ON parents` and no `parents` row was ever
  written.

## Root Cause

Account identity is spread across two systems that are populated by separate
steps, and any step between them can be the last one that ran. `auth.users` is
Supabase-owned; `public.parents` is application-owned and is what the rest of the
schema actually references. An account created through a path that stopped early
— an abandoned signup, a hand-created test account, a partial provisioning run —
leaves the auth half without the application half.

"Exists in the auth system" and "exists in the application" are different
questions. The adopt branch conflated them.

Compounding it: `findAuthUserByEmail` (`app/fp/lib/provision-core.ts`) returns
`null` on a **query error** as well as on genuine absence — it logs and swallows
inside the helper, so the error never crosses the return boundary. A transient
`listUsers` failure therefore looks exactly like "this parent is new", and the
runner would create-and-password-write over a real person's account.

## Solution

**Probe both halves, independently, and make the probe tri-state.**

```ts
// The auth probe: page-walk listUsers directly rather than reusing
// findAuthUserByEmail, whose error path is indistinguishable from absence.
// found | absent | unknown — and `unknown` must abort, never proceed as `absent`.
const authUser = await probeAuthUser(email);   // returns null ONLY on error
if (authUser === UNKNOWN) abortFamily("auth probe failed");

// The application probe: separate, and required even on the adopt path.
const has = await db.from("parents").select("id").eq("id", parentId).maybeSingle();
if (has.error) throw has.error;
if (!has.data) {
  // Adopt the auth user, but the application row is the thing that's missing.
  await db.from("parents").insert({ id: parentId, email, first_name, last_name,
                                    casl_consent: false });
}
```

Note the shape of the fix: adopting a record that exists in the external system
does **not** license writing nothing locally when the local record is the part
that is absent. The rule is not "adopt means no writes" — it is "adopt means no
writes *to what already exists*."

Be deliberate about what the repair write triggers. Inserting the `parents` row
fires `on_parent_created`, which links the contact's existing CRM lead, OR-merges
consent and resets `signup_at` — see
[writing-nothing-to-a-row-does-not-protect-it](writing-nothing-to-a-row-does-not-protect-it-an-adjacent-insert-plus-an-unattended-consumer-still-sends-mail-2026-08-04.md).
It is a real side effect, not a formality, and it must be an explicit decision
rather than something the adopt branch does quietly.

Do **not** repair by setting a password. A confirmed account whose password the
caller knows is a provider-level session bypass — see
[confirmed-account-with-known-password-before-inbox-proof](../security-issues/confirmed-account-with-known-password-before-inbox-proof-is-a-provider-level-session-bypass-2026-08-01.md).
The auth half already exists; leave its credential alone.

## Prevention

- **In any flow spanning `auth.users` and an application table, probe both.**
  Neither presence implies the other.
- **A read that returns `null` for both "absent" and "failed" is not a probe.**
  Wrap it, or write your own, so the caller can distinguish. `unknown` must be a
  distinct, loud, abort-worthy state.
- **Run reconnaissance against production before a batch write.** This was found
  by a read-only recon pass (`scripts/fp-cohort-recon.ts`), not by reasoning —
  it reported "parent: EXISTS -> ADOPT" beside "families: LEAD (parent_id null)",
  and that pairing is impossible if a `parents` row exists.
- **The tell is generalizable:** when a table has an `AFTER INSERT` trigger that
  populates a downstream row, a downstream row in its *un-populated* state is
  evidence the upstream row was never inserted.

## Related

- [post-write-verify-adopt-only-on-ambiguous-error](../best-practices/post-write-verify-adopt-only-on-ambiguous-error-never-on-unique-violation-and-the-verify-read-is-tri-state-2026-07-24.md)
  — the canonical tri-state read rule; this is a straight application of it.
- [optional-field-default-sentinel-not-legal-state-guard-fails-open](../best-practices/optional-field-default-sentinel-not-legal-state-guard-fails-open-2026-07-21.md)
  — the fail-open twin.
- [bulk-import-crm-leads-families-derived-stage-parent-id-consent](../best-practices/bulk-import-crm-leads-families-derived-stage-parent-id-consent-2026-07-15.md)
  — **amendment:** its dual-table pre-check (`parents` + `families`) classifies a
  contact of this shape as new. It needs a third probe against `auth.users`.
- [compensate-by-stable-identity-not-the-handle-you-only-captured-on-success](compensate-by-stable-identity-not-the-handle-you-only-captured-on-success-a-half-built-restrict-child-wedges-teardown-2026-08-01.md)
  — the same saga's other half-state. **No existing doc stated the
  auth-row-without-application-row rule**; do not fold this one into it.
