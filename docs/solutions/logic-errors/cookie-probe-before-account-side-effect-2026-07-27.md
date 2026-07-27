---
title: "A success verdict built on a silently-swallowed side effect: @supabase/ssr's cookie adapter eats Server-Component writes, so signInWithPassword 'succeeds' with no session — probe the capability BEFORE the side effect"
date: 2026-07-27
category: logic-errors
module: app/lib/funnel/account.ts
problem_type: logic_error
component: authentication
severity: high
symptoms:
  - "signInWithPassword resolves with error: null even though the session cookie was never written to the browser"
  - "A Server Component call site returns a truthful-looking provisioned verdict while the browser holds no session"
  - "The generated password is discarded by design, so the minted account becomes reachable only as a dead email_exists on the next attempt"
root_cause: missing_validation
resolution_type: code_fix
last_updated: 2026-07-27
related_components:
  - service_object
  - database
tags:
  - supabase-ssr
  - cookie-adapter
  - silent-failure
  - fail-closed
  - session-provisioning
  - dependency-injection
  - server-component-boundary
---

# A success verdict built on a silently-swallowed side effect

## Problem

`app/lib/supabase/server.ts` is the standard `@supabase/ssr` server client. Its
cookie adapter wraps every `cookieStore.set` in a bare try/catch, because
`cookies().set()` throws synchronously in a context that cannot mutate the
response — a Server Component, as opposed to a Server Action or Route Handler:

```ts
// app/lib/supabase/server.ts
setAll: (cookiesToSet) => {
  try {
    cookiesToSet.forEach(({ name, value, options }) =>
      cookieStore.set(name, value, options)
    );
  } catch {
    // Called from a Server Component — safe to ignore
  }
},
```

That swallow is correct for the adapter's own contract (reading a session from
a Server Component must not crash). The consequence one layer up: GoTrue's
`signInWithPassword` exchange succeeds independently of cookie persistence.
Called through this client from a read-only-cookies context, it returns
`error: null` — auth succeeded — while the session write silently no-opped.

`provisionOrRecognizeAccount` (funnel U2) creates a brand-new account and then
mints its first session exactly this way. Without a guard it would return
`{ kind: "provisioned" }` from a Server Component — truthful about auth, false
about the browser having a session. And the fix-up path is a dead end: the
generated password is 256-bit random, never disclosed, never stored, so the
account is only ever recognizable as `email_exists` afterward — stranded, with
nothing to resume into until the resume-token unit ships.

The failure is silent at every layer: the adapter's swallow is deliberate; the
sign-in result is accurate about what it measured; the caller's verdict is
truthful about what it checked and wrong about what happened. Caught in
adversarial review before any caller existed — no incident, only a scenario a
reviewer constructed by reading the adapter and the module side by side.

## What would NOT have caught it

- **Trusting `signInWithPassword`'s return value.** It reports the auth
  exchange, not cookie persistence; nothing in the API surface hints a cookie
  write is riding along silently.
- **A source scan asserting "only Server Actions call this."** Satisfiable by
  dead code (zero callers existed), and file location is not execution context.
- **Checking `cookies().getAll()` after sign-in.** Detects the problem only
  after the irreversible side effect (account creation) already ran.

## Solution

**Probe the capability before the side effect.** The first thing the function
does — before `createUser`, before generating a password — is attempt a cookie
write engineered to prove nothing:

```ts
assertCookiesWritable: async () => {
  // cookies().set throws synchronously outside a Server Action / Route
  // Handler. maxAge: 0 means the probe cookie is expired on arrival —
  // nothing persists in the browser.
  const store = await cookies();
  store.set("__funnel_cookie_probe", "1", { maxAge: 0 });
},
```

```ts
try {
  await deps.assertCookiesWritable();
} catch {
  return { kind: "failed", reason: "cookies_unwritable" };
}
// ...only now: createUser → parents insert → signInWithPassword
```

`cookies_unwritable` is a distinct typed member of the result union, so callers
and tests assert on it directly rather than string-matching a log line.

## Why This Works

The probe exercises the exact code path the adapter's `setAll` will later use —
same API, same context, same throw/no-throw — with a payload that is inert on
success (`maxAge: 0`, a key nothing reads). Because it runs strictly before any
mutation, a failed probe means zero side effects: nothing minted, nothing to
compensate. Fail closed, not fail-and-clean-up — the cheapest failure is the
one that never created anything.

The general rule: **when a library deliberately swallows a failure at layer N,
any success contract at layer N+1 that depends on layer N's side effect must
independently verify or pre-probe the capability.** The swallow is not a bug to
route around after the fact; it is a contract gap the layer above closes
itself, before committing to anything the gap could invalidate.

## Prevention

For code that (a) calls a library known to swallow a failure mode internally
and (b) then performs a hard-to-undo side effect whose success depends on the
swallowed behaviour:

1. Find the silent boundary (grep the dependency for bare `catch {}` around
   calls your correctness depends on).
2. Write a probe using the SAME code path, with a no-op-on-success payload
   (expired cookie, dry-run flag, `LIMIT 0`).
3. Run it strictly before the side effect; fail closed with a typed reason.
4. Make the side effect compensable structurally — here
   `parents.id references auth.users(id) on delete cascade` means one
   `deleteUser` unwinds account + parents row atomically, instead of an
   ordered pair of deletes whose interruption strands a half-state.
5. If a source scan is the only guard, add a dependency-injection seam and
   test the branch behaviorally — a scan is satisfiable by dead code; a fake
   that throws under the wrong context is not (see the ROUND 5 addendum in the
   source-scanning doc below).

Behavioral test (through the `ProvisionDeps` seam):

```ts
it("unwritable cookies fail CLOSED before any side effect", async () => {
  const { calls, deps } = fakeDeps({ cookiesUnwritable: true });
  const out = await provisionOrRecognizeAccount(INPUT, deps);
  expect(out).toEqual({ kind: "failed", reason: "cookies_unwritable" });
  expect(calls).toEqual(["cookieProbe"]); // createUser never ran
});
```

## Related Issues

- `docs/solutions/logic-errors/audit-side-record-gated-on-primary-writes-reported-success-not-verified-outcome-retry-makes-it-permanent-2026-07-24.md`
  — the ancestor pattern: reported success is not verified outcome.
- `docs/solutions/security-issues/guard-function-with-no-callers-is-not-a-mechanism-client-side-supabase-auth-bypasses-server-guards-2026-07-23.md`
  — sibling: a Supabase Auth mechanism that looked wired but had no real effect.
- `docs/solutions/integration-issues/supabase-admin-createuser-non-deliverable-email-requires-email-confirm-2026-07-21.md`
  — sibling: Supabase Auth surprises only a live probe reveals.
- `docs/solutions/best-practices/shared-db-taking-core-must-not-live-in-a-use-server-file-server-action-boundary-2026-07-17.md`
  — the Server Component / Server Action boundary this failure lives on.
- `docs/solutions/test-failures/a-source-scanning-test-is-defeated-by-a-spelling-you-did-not-guess-2026-07-27.md`
  — ROUND 5: the DI-seam technique that retires a scan. **ROUND 6** carries the
  correction learned one unit later: a seam that mirrors a client's chained
  builders needs `as unknown as` on both sides and turns the checker off; cut
  the seam at the OPERATION, not the client.
- `docs/solutions/security-issues/constant-response-is-not-constant-timing-and-a-guard-moves-when-you-extract-2026-07-27.md`
  — sibling from the next unit: the same "probe/verify what the layer below
  actually did" instinct, applied to response timing and to a guard that moved
  during a refactor.
- GitHub issues: none (searched cookie/session/server component, zero results).
