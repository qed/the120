---
title: "Supabase autoconfirm let anyone forge CASL consent via someone else's email; enabling confirmations required a signup retrofit (profile in user_metadata, self-healing dashboard store)"
date: 2026-07-13
category: security-issues
module: supabase-auth
problem_type: security_issue
component: authentication
symptoms:
  - "Anyone could sign up with another person's email; the on_parent_created trigger linked the attacker to that email's lead family, overwrote contact identity, and set consent_given = true (forged CASL consent, permanent address squat in auth.users)"
  - "Flipping mailer_autoconfirm to false alone broke every signup: signUp() returns no session, so the immediate parents-profile upsert failed RLS (auth.uid() = id) and users saw an error while the auth user was still created"
  - "Production auth site_url was http://127.0.0.1:3000 with allow-list https://127.0.0.1:3000 — all confirmation/recovery links would have redirected to localhost"
  - "Sign-in with an unconfirmed account surfaced Supabase's raw 'Email not confirmed' error"
root_cause: missing_validation
resolution_type: code_fix
severity: critical
related_components:
  - database
  - email_processing
tags:
  - supabase
  - email-confirmation
  - mailer-autoconfirm
  - rls
  - user-metadata
  - casl-consent
  - site-url
  - management-api
---

# Supabase autoconfirm let anyone forge CASL consent via someone else's email; enabling confirmations required a signup retrofit

## Problem

Production Supabase had `mailer_autoconfirm: true`, so signups required no proof of email ownership: an attacker signing up with a CRM lead's email got linked to that lead's family by the `on_parent_created` trigger (matches by email), overwriting contact identity and OR-merging `consent_given = true` — forged CASL consent plus a permanent squat on the address in `auth.users`, with no UI recovery path. The trap: flipping `mailer_autoconfirm: false` by itself breaks production signup, because the signup flow upserted the `parents` profile row immediately after `signUp` — with confirmations on there is no session, the upsert runs unauthenticated, and RLS (`auth.uid() = id`) rejects it even though the auth user was created and the confirmation email sent. (Found as a P0 by the adversarial reviewer in the CRM branch's 11-reviewer review; see `docs/plans/2026-07-13-001-feat-the120-crm-plan.md`.)

## Symptoms

- With autoconfirm on: any signup using a lead's email hijacks that lead's CRM family and forges CASL consent (`consent_given` forced true via OR-merge in the trigger). The address becomes unrecoverable through the UI (`updateContact` refuses parent-linked families).
- With autoconfirm flipped naively: signup shows an error ("new row violates row-level security policy" on `parents`) despite the auth user being created and the confirmation email going out — the user is stranded half-signed-up.
- Production `site_url` was `http://127.0.0.1:3000` (allow-list `https://127.0.0.1:3000`): every confirmation and password-reset email would have redirected users to localhost. It had sat undetected since project creation because autoconfirm meant no email link was ever exercised.

## What Didn't Work

- **Flipping the config first.** `mailer_autoconfirm: false` alone converts every production signup into an RLS failure, because the deployed client assumed `data.session` exists after `signUp`.
- **Trusting `data.session` after `signUp`.** The old `AccountModal.handleSubmit` went straight from `signUp` to a browser-client `parents` upsert and a bearer-authenticated `/api/welcome` call. Both require a session; with confirmations on, `data.session` is `null`.
- **Assuming `site_url` was ever set.** The project had shipped and operated with autoconfirm on, so nothing ever exercised the redirect URLs; the localhost default sat undetected until the confirmation flow was about to go live.

## Solution

Ordering is part of the fix: retrofit the app and **deploy it first**, then flip the config. The retrofitted code works under both autoconfirm states (the `data.session` check branches on it), so the deploy is safe before the flip.

**1. Put the full profile into auth metadata at signUp, with a redirect** (`app/components/account/AccountModal.tsx`):

```ts
const { data, error } = await supabase.auth.signUp({
  email: form.email,
  password: form.password,
  options: {
    emailRedirectTo: `${window.location.origin}/dashboard`,
    data: {
      first_name: form.firstName,
      last_name: form.lastName,
      // The full profile lives in auth metadata: with email confirmations
      // on there is no session at signup, so the dashboard creates the
      // parents row from this metadata on the first signed-in visit.
      phone: form.phone,
      postal_code: form.postalCode.trim().toUpperCase(),
      casl_consent: form.caslConsent,
      casl_consent_at: new Date().toISOString(),
      heard_about: heardAbout,
      referral_code: referralCode,
    },
  },
});
```

**2. Branch on the missing session — skip the RLS-doomed writes** (same file, immediately after):

```ts
if (!data.session) {
  // Email confirmations are on — no session until the link is clicked,
  // so the parents upsert below would be rejected by RLS. The dashboard
  // (store.tsx) creates the row post-confirmation and sends welcome #1.
  setNeedsConfirm(true);
  setSubmitted(true);
  return;
}
```

`SuccessView` renders a `needsConfirm` variant — "Check your inbox", with the confirmation steps.

**3. Dashboard self-heal creates the profile once a session exists** (`app/dashboard/store.tsx`, in `loadFamily`):

```ts
let parentRow = parentRes.data;
if (!parentRow && user.user_metadata?.first_name) {
  // Confirm-email signup flow: the profile was captured in auth metadata
  // because no session existed at signup (RLS blocks anonymous writes).
  // Create the parents row on the first signed-in visit, then fire
  // welcome email #1 (the route is idempotent).
  const m = user.user_metadata;
  const { error } = await supabase.from("parents").upsert({
    id: user.id,
    first_name: m.first_name ?? "",
    last_name: m.last_name ?? "",
    email: user.email ?? "",
    phone: m.phone ?? "",
    postal_code: m.postal_code ?? "",
    casl_consent: Boolean(m.casl_consent),
    casl_consent_at: m.casl_consent_at ?? new Date().toISOString(),
    heard_about: m.heard_about ?? "",
    referral_code: m.referral_code ?? "",
  });
  if (error) {
    console.error("[dashboard] profile create failed:", error.message);
  } else {
    parentRow = { first_name: m.first_name ?? "", last_name: m.last_name ?? "", email: user.email ?? "" };
    void fetch("/api/welcome", {
      method: "POST",
      headers: { Authorization: `Bearer ${activeSession.access_token}` },
    }).catch(() => {});
  }
}
```

**4. Map the new sign-in error to human copy** (`app/dashboard/SignIn.tsx`):

```ts
setError(
  /invalid login credentials/i.test(error.message)
    ? "Email or password doesn't match — try again."
    : /email not confirmed/i.test(error.message)
      ? "Confirm your email first — check your inbox for the link we sent."
      : error.message
);
```

**5. Fix redirect config via the Management API** (`PATCH /v1/projects/{ref}/config/auth`):
- `site_url`: `https://the120.school`
- `uri_allow_list`: `https://the120.school/**,https://jointhe120.vercel.app/**,http://localhost:3000/**,http://127.0.0.1:3000/**`

**6. Deploy steps 1–4 to production, THEN** `PATCH { "mailer_autoconfirm": false }` via the same endpoint.

**E2E verification recipe (production, no clickable inbox needed):**

1. `POST /auth/v1/signup` (anon key) with a Resend black-hole address (`delivered+confirmtest@resend.dev`) plus the metadata payload → assert user id present, `confirmation_sent_at` set, and NO `access_token`.
2. `POST /auth/v1/token?grant_type=password` before confirming → assert rejected ("Email not confirmed").
3. Simulate the link click via SQL through the Management API query endpoint: `update auth.users set email_confirmed_at = now() where email = '...'` (playbook: `docs/solutions/integration-issues/supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md`).
4. Password grant again → session issued. Upsert the `parents` row with the user's bearer token (mimics the `store.tsx` self-heal) → assert success under RLS.
5. Assert the trigger-created `families` row exists with `consent_given = true` and signup stamped.
6. Cleanup: delete the test `families` and `auth.users` rows; verify zero remain.

## Why This Works

- **The trigger now only fires for verified emails.** `on_parent_created` runs off the `parents` row, and that row is only ever created when a session exists — which, with confirmations on, means the email was proven. Identity and consent flowing into the CRM are trustworthy. This is the actual P0 closure; the config flip alone just moves the failure.
- **Auth metadata is the profile's waiting room.** `options.data` rides along with the unconfirmed user, needs no RLS, and survives until the first signed-in dashboard visit — no data is lost between signup and confirmation.
- **The RLS write is deferred until it can succeed.** The `parents` upsert moves from "no session, guaranteed RLS rejection" to "session in hand, `auth.uid() = id` passes" — the self-heal runs exactly when the policy's precondition holds.
- **Idempotency makes the retry-shaped flow safe.** The self-heal is an upsert and `/api/welcome` is idempotent, so repeat dashboard visits (or the modal path when autoconfirm is on) can't duplicate rows or emails. The same code working under both config states is what makes deploy-before-flip a zero-downtime ordering.

## Prevention

- **Before flipping any Supabase auth setting, grep the signup flow for post-`signUp` writes that assume a session.** Anything touching an RLS-protected table between `signUp` and the confirmation click breaks the moment confirmations turn on.
- **Always check `site_url` and `uri_allow_list` on new Supabase projects — the defaults are localhost.** They fail silently until the first real confirmation or password-reset email goes out.
- **Keep an E2E recipe that simulates confirmation via SQL** (`update auth.users set email_confirmed_at = now()`) so the full confirm → session → RLS-write → trigger chain can be verified against production without a clickable inbox.
- **Use black-hole addresses like `delivered+x@resend.dev` for production email tests** — the send is real (Resend accepts and drops it), no inbox needed, no human's mailbox involved.
- **Treat "deploy code, then flip config" as the default ordering** whenever a config change tightens an assumption the deployed client currently relies on.

## Related Issues

- `docs/solutions/integration-issues/supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md` — the Management-API playbook the E2E's SQL confirmation-simulation and the config PATCHes run through.
- `artifacts/roadmap.md` §S5 — the P0 resolution record (email confirmations enabled 2026-07-13, E2E-verified).
- `docs/plans/2026-07-13-001-feat-the120-crm-plan.md` — the plan whose 11-reviewer autofix review surfaced the P0 (adversarial reviewer, confirmed live via `GET /config/auth`).
- Implementation: `app/components/account/AccountModal.tsx`, `app/dashboard/store.tsx`, `app/dashboard/SignIn.tsx`.
- GitHub issues: none related (searched `supabase OR confirmation OR signup`, zero results).
