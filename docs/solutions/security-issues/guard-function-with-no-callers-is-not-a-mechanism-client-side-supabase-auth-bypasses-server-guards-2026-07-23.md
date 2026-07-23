---
title: A guard function with no callers is not a mechanism — and client-side Supabase Auth calls cannot be gated by server-side code
date: 2026-07-23
category: docs/solutions/security-issues
module: path / First Profit (FW) student provisioning; dashboard + crm sign-in
problem_type: security_issue
component: authentication
symptoms:
  - A documented "mechanism-enforced" invariant is enforced by a function that nothing calls
  - Guessable, name-derived minor email addresses on a deliverable domain are reachable from a public password-reset form
  - A pure TypeScript guard cannot intercept a Supabase Auth call the browser makes with the public anon key
root_cause: missing_validation
resolution_type: code_fix
severity: high
tags:
  - supabase-auth
  - email
  - invariants
  - minors
  - enforcement-tests
  - anon-key
---

# A guard function with no callers is not a mechanism

## Problem

The Founders Weekend (FW) feature provisions dormant accounts for children at
`<first>.<last>.fw@the120.school` — a **real, deliverable domain**, chosen
deliberately (FW-D2 makes the address a future contact channel for the family).
The plan called the no-auth-mail invariant "mechanism-enforced, not remembered,"
resting on three defenses: password-less accounts, `email_confirm: true` pinned
at the type level, and `assertNoAuthMailToFwStudent` as "the single choke-point
any future mail-capable call must pass."

Two of the three were real. The third was not.

## Symptoms

1. `grep -rn assertNoAuthMailToFwStudent app/` returned exactly two hits: the
   function's own definition and its own unit test. **Zero production callers.**
   It was well-tested dead code, and its docstring asserted present-tense
   enforcement that nothing delivered.

2. Two pre-existing, unauthenticated, public forms call Supabase Auth's mailer
   directly **from the browser**:

   ```tsx
   // app/dashboard/SignIn.tsx  (and app/crm/login/LoginForm.tsx)
   await supabaseBrowser()
     .auth.resetPasswordForEmail(email, { redirectTo: `${origin}/reset` })
     .catch(() => {});
   ```

   `email` is raw, user-typed form state. There is no server hop. The browser
   talks to Supabase's `/auth/v1/recover` endpoint using the anon key — which is
   public by construction in a client-side app.

Because FW addresses are name-derived and therefore **guessable**, anyone who
knows a child's name can type their address into either public form.

## What Didn't Work

- **Writing the guard and testing it thoroughly.** Six well-written unit tests
  proved the predicate was correct. None of them proved anything was *using* it.
  Correct-and-uncalled is indistinguishable from absent at runtime.
- **Assuming the choke-point could be retrofitted later.** A pure function can
  only gate code that calls it. No amount of later discipline puts a TypeScript
  function into a path that runs `browser → Supabase`.

## Solution

Two things landed; one was escalated rather than fixed.

**1. Made the guard's absence detectable** — `app/path/lib/__tests__/no-auth-mail-guard.test.ts`
statically scans `app/` for mail-capable Supabase Auth surfaces and fails when a
new one appears without the guard:

```ts
const MAIL_CAPABLE =
  /\b(resetPasswordForEmail|inviteUserByEmail|generateLink|signInWithOtp|reauthenticate)\s*\(/;

/** Adding a line here is a security decision, not a formality. */
const REVIEWED_CALL_SITES = [
  { file: "app/dashboard/SignIn.tsx", why: "client-side; browser→Supabase, no server hop exists to guard" },
  { file: "app/crm/login/LoginForm.tsx", why: "client-side; browser→Supabase, no server hop exists to guard" },
];

// A new call site passes only if it guards its own recipient.
if (source.includes("assertNoAuthMailToFwStudent")) continue;
unreviewed.push(rel);
```

It also pins the reviewed sites' *shape*: if one stops calling `supabaseBrowser()`,
the test fails and forces the allowlist entry — which exists only because the
call is unreachable from server code — to be re-justified.

**2. Corrected the docstring** to describe what the mechanism actually is, and
made the guard refuse a blank recipient (a caller passing an unpopulated field
must not read as cleared-to-send).

**3. Escalated, not fixed:** closing the client-side path requires either routing
both forms through a Server Action, or a project-level Supabase Auth
send-email hook that refuses `*.fw@the120.school`. That is a product/ops
decision, not a code cleanup.

## Why This Works

The test converts an invariant that depended on *memory* into one that depends
on *CI*. The guard still cannot stop a browser call — but the repo now fails
loudly when someone adds a server-side one without it, and the client-side hole
is recorded in code, with a reason, where the next author will meet it.

The severity is currently bounded by a fact outside the codebase: there is no
Workspace catch-all on `*.fw@the120.school`, so recovery mail addressed there
bounces into nothing. **That is the only reason this is not critical today.**
Arming the catch-all — which FW-D2 contemplates — makes it live, and because FW
accounts are password-less, a successful reset would hand the requester a working
credential for a child's account.

## Prevention

- **A guard is not a mechanism until something fails when it is absent.** When
  you write a function whose whole purpose is "every future caller must pass
  through here," write the enforcement in the same commit — a static test, a lint
  rule, or a wrapper type that makes the unguarded call unrepresentable. Otherwise
  you have documentation with a `.ts` extension.
- **Ask where the call actually runs before designing a guard.** Anything the
  browser sends with the public anon key (`resetPasswordForEmail`, `signUp`,
  `signInWithOtp`, magic links) is reachable by anyone with the URL and the key.
  Invariants over those calls must live at the platform level — a Supabase Auth
  hook, or moving the call server-side — never in application code.
- **Grep for callers before believing a docstring.** `grep -c` on a
  security-critical helper is a five-second check that would have caught this at
  authoring time.
- **Deliverable domains for minors need a bounce/catch-all probe recorded, not
  assumed.** The "no catch-all" fact is load-bearing for the whole risk
  assessment; it belongs in a checklist with a date, not in someone's head.

## Related

- `docs/solutions/integration-issues/supabase-admin-createuser-non-deliverable-email-requires-email-confirm-2026-07-21.md`
  — the server-side half of the same no-mail invariant (`email_confirm: true`),
  which *is* genuinely mechanism-enforced via a literal-`true` type.
- `docs/solutions/security-issues/supabase-autoconfirm-forged-consent-email-confirmation-signup-retrofit-2026-07-13.md`
  — same family: a user-typed email plus a client-side Supabase Auth call
  producing an unwanted real-world side effect on someone else's account.
- `docs/solutions/security-issues/state-changing-email-links-mutate-on-get-scanner-prefetch-false-confirm-2026-07-16.md`
  — adjacent: email-triggering flows need deliberate gating.
- Plan: `docs/plans/2026-07-23-001-feat-fw-cohort-sprints-plan.md` (Unit 1;
  Operational Notes carry the two outstanding email probes).
