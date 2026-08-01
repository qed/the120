---
title: "Creating an auth account as confirmed with a caller-supplied password BEFORE inbox verification is a provider-level session bypass — your app's verify route enforces nothing"
date: 2026-08-01
category: security-issues
module: fp-signup
problem_type: security_issue
component: authentication
symptoms:
  - "A multi-step signup 'verifies' the email with a token, but a session can be obtained without ever redeeming the token"
  - "An attacker can POST a victim's email + an attacker-chosen password to the signup endpoint, then sign in directly against the auth provider's public /token endpoint"
  - "The whole 'token proves inbox, password proves ownership' design is enforced only by the app's own /verify route, not by the auth provider"
root_cause: logic_error
resolution_type: code_fix
severity: critical
tags:
  - authentication
  - supabase
  - gotrue
  - email-verification
  - account-takeover
  - session
  - signup
  - coppa
related_components:
  - security
  - fp-signup
---

# A confirmed account with a known password before inbox proof is a provider-level session bypass

## Problem

First Profit's parent signup (Slice B) is multi-step: create the account, email
the parent a single-use token, and only on `/api/fp/signup/verify` (token +
password) hand back a session. The implementation created the account by reusing
`provisionOrRecognizeAccount` (`admin.createUser({ email, password, email_confirm:
true })`) and then, still inside START, immediately overwrote that account's
password with the parent's chosen password from the form — **before the
verification email was even sent.**

That makes the account fully sign-in-capable **at the auth-provider level** with a
password the requester chose, before any proof of inbox control. The entire
verification design was enforced only by the app's own `/verify` route — which the
attacker simply skips.

## Symptoms

- An attacker POSTs `{ email: victim@…, password: attacker-chosen, … }` to the
  public signup endpoint (any allowlisted address pre-launch; any address once the
  launch gate lifts).
- The attacker then calls Supabase's **public** `POST /auth/v1/token?grant_type=password`
  directly with `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (both
  shipped in every client bundle) and receives a full session (access + refresh
  token) for the victim's email — never touching `/verify`, its token, its CAS, or
  its rate limits.
- Full account-takeover / consent-bypass primitive for a children's product: the
  session can then create the child, record consent, and read PII.

## What Didn't Work

- **Enforcing verification in the app's own route.** The token/CAS/rate-limit
  discipline in `/verify` is real, but it is not the only door. GoTrue's `/token`
  endpoint is public and only asks "is this account confirmed, and does the
  password match?" — both of which the START step had already made true. An app
  route cannot gate a provider endpoint the client can call directly with the anon
  key.
- **Relying on `email_confirm: true` being harmless.** It is harmless only if the
  account has no password the requester knows. Combined with a caller-supplied
  password, `email_confirm: true` is what makes the account immediately
  sign-in-capable.

## Solution

Do not give the account a usable, requester-known password until inbox control is
proven. Move the password-set out of START and into verify-completion, after the
token is redeemed:

```ts
// BEFORE (bypassable): START created the account AND set the parent's password,
// before the verification mail was sent.
await provisionAccount(email, parentPassword);   // confirmed + known password
await sendVerificationEmail(...);                // ...too late

// AFTER (safe): START leaves the random, never-disclosed provisioning password.
await provisionAccount(email, randomThrowaway);  // confirmed, but password unknown
await sendVerificationEmail(...);

// verify-completion, ONLY after inbox proof (token redeemed / restricted auto-confirm):
const redeemed = await redeemVerification(token);   // proves inbox control
if (redeemed.status !== "verified") return { ok: false };
await setParentPassword(userId, parentPassword);    // now, and only now
const session = await signInWithPassword(email, parentPassword);
return { ok: true, session };                       // tokens in JSON
```

Through START the account carries the provisioning step's random 32-byte password
that is never disclosed. An attacker who submits a victim's email cannot sign in
(they do not know the random password; a reset would email the victim's inbox;
`updateUser` needs a session). A session is unobtainable for an email until its
verification token is redeemed. Pin it with tests: signing in with the chosen
password FAILS after START and SUCCEEDS only after a redeemed verify.

## Why This Works

Inbox proof (redeeming a token delivered to the address) now strictly precedes the
account becoming usable with a known credential. The provider's `/token` endpoint
still only checks confirmed + password-match, but there is no requester-known
password to match until the app has already confirmed inbox control — so the
provider door and the app door now open at the same moment, for the same reason.

## Prevention

- **The auth provider's endpoints are part of your attack surface, not just your
  app routes.** With a public anon key, clients can call `/token`, `/signup`,
  `/recover`, `/user` directly. Any invariant you enforce only in an app route
  (verification, consent-before-session, step order) is bypassable unless it is
  ALSO true at the provider/DB layer. Ask, for every multi-step auth flow: "what
  can the client do by calling the provider directly, skipping my routes?"
- **Never make an account sign-in-capable with a requester-known credential before
  the step that is supposed to authorize it.** Either keep the provisioning
  password random-and-undisclosed until the gating step, or create the account
  unconfirmed (`email_confirm: false`) and confirm it only at the gating step.
- **A random-but-known-to-you provisioning password is fine; a requester-supplied
  one is not** — the difference is who can present it to `/token`.
- Sibling learning: `guard-function-with-no-callers-is-not-a-mechanism-client-side-supabase-auth-bypasses-server-guards-2026-07-23.md`
  — the same root truth (client-side auth calls route around server guards) from a
  different angle.

## Related

- Found by ce:review of First Profit Slice B Unit 2 (the parent signup route),
  after the review was initially skipped and re-run — the P0 would otherwise have
  shipped. Fixed in `feat/fp-slice-b` commit `111c298`.
