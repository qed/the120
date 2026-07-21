---
title: "admin.createUser on a non-deliverable address can't sign in without email_confirm: true — and config.toml lies about it"
date: 2026-07-21
category: docs/solutions/integration-issues
module: authentication
problem_type: integration_issue
component: authentication
symptoms:
  - "A programmatically-created Supabase auth user exists in the dashboard but signInWithPassword fails with \"Email not confirmed\""
  - "The account's email_confirmed_at is NULL after admin.createUser succeeded"
  - "supabase/config.toml says enable_confirmations = false, so you (reasonably) omit the confirm flag — and every account you create is a lockout"
root_cause: config_error
resolution_type: code_fix
severity: high
tags: [supabase, auth, admin-createuser, email-confirm, non-deliverable, config-toml, child-accounts, provisioning]
---

# admin.createUser on a non-deliverable address can't sign in without `email_confirm: true` — and config.toml lies about it

## Problem

The Path provisions student accounts server-side on **system-generated, non-deliverable** email addresses (an 8-year-old has no inbox). A spike verified whether that even works before the identity layer was built on the assumption. It works — but only with one non-obvious flag, and the local config file actively points you the wrong way.

## Symptoms

- `supabase.auth.admin.createUser({ email, password })` returns a user successfully.
- `signInWithPassword({ email, password })` immediately after fails: **`Email not confirmed`**.
- The user's `email_confirmed_at` is `NULL`.
- Because the address is non-deliverable **by design**, no confirmation email can ever arrive — the account is permanently locked out of a login it looks fully set up for in the dashboard.
- `supabase/config.toml` contains `enable_confirmations = false`, so omitting the confirm flag looks correct.

Verified against production (`deolvqnyvhhnavsifgxz`) on 2026-07-21, users created and deleted, zero left behind:

| createUser call | `email_confirmed_at` | signInWithPassword |
|---|---|---|
| non-deliverable addr + `email_confirm: true` | set | **OK — session returned** |
| non-deliverable addr, **no** flag | `NULL` | **FAILS — "Email not confirmed"** |
| bogus `.invalid` domain + `email_confirm: true` | set | OK (no MX validation happens) |

## What Didn't Work

- **Trusting `supabase/config.toml`.** Its `enable_confirmations = false` (dated to the pre-flip S6 rationale, 2026-07-09, never updated) describes *local* declarative config, not the **hosted** project. Email confirmations were turned **ON** in production on 2026-07-13 (see the autoconfirm doc below). The config file and the live project disagree, and the file loses.
- **Assuming `admin.createUser` auto-confirms because it's the service-role admin API.** It does not. The admin API creates the row but leaves `email_confirmed_at` NULL unless you ask for it — and with confirmations on, unconfirmed means un-signin-able.

## Solution

Always pass `email_confirm: true` when provisioning an account on an address that can never receive a confirmation email (child, service, or system accounts):

```ts
const { data, error } = await admin.auth.admin.createUser({
  email,                    // system-generated, non-deliverable
  password,                 // parent-set
  email_confirm: true,      // ← without this the account can never sign in
  app_metadata: { role: "student" },
});
```

This repo already had the correct precedent in `scripts/seed-staff.ts` (written 2026-07-13, the same day confirmations flipped) — it passes `email_confirm: true` for exactly this reason. Mirror it.

## Why This Works

With hosted confirmations ON, a user can only obtain a session once `email_confirmed_at` is set. For a normal signup that happens when the user clicks the emailed link. `email_confirm: true` sets `email_confirmed_at` at creation time, server-side, skipping the email round-trip entirely — which is the only workable path when the address is deliberately non-deliverable. No MX or deliverability check runs at creation, so the synthetic address (or even a non-routable domain) is accepted without complaint; the confirmation gate is the only thing standing between "created" and "can sign in".

## Prevention

- **Never treat `supabase/config.toml` as the source of truth for hosted auth settings.** It is local declarative config. To read the live state, query the Management API (`GET /v1/projects/{ref}/config/auth`) using the playbook in the CLI-workaround doc below, or just run a spike.
- **Verify auth assumptions with a throwaway create → sign-in → delete spike against production** before building a data model on top of them. It is the cheapest possible check and it caught this in one run. Create the user, assert `signInWithPassword` returns a session, delete the user, and assert none remain.
- **Always pass `email_confirm: true` for non-deliverable/system/child accounts**, and cover it with a test that asserts the provisioning call includes the flag — an omission produces an account that looks fine and cannot log in, which is invisible until a real user tries.
- When a config file and a live system can disagree, write down which one is authoritative where the discrepancy bites (done here: the T1 plan's Supabase-constraints section and Unit 6 approach now say `config.toml` is not authoritative and the flag is mandatory).

## Related Issues

- `docs/solutions/security-issues/supabase-autoconfirm-forged-consent-email-confirmation-signup-retrofit-2026-07-13.md` — the record of confirmations being turned ON in production on 2026-07-13. That doc covers the *browser* `signUp()` flow (no-session self-heal, consent-forgery fix); this one covers the *server-side* `admin.createUser` flow. Same root fact (the 2026-07-13 flip), different API surface and different fix.
- `docs/solutions/integration-issues/supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md` — how to read live hosted auth config via the Management API to check `config.toml`'s claim, and the setup/teardown path for the spike.
- `scripts/seed-staff.ts` — the already-correct precedent that passes `email_confirm: true`.
- `docs/plans/2026-07-21-001-feat-the-path-t1-core-loop-plan.md` — Unit 2 spike findings and the Unit 6 provisioning rule where this is now mandatory.
