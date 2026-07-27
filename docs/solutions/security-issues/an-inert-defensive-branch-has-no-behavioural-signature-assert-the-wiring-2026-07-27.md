---
title: A defensive branch that changes no behaviour has no behavioural signature — assert the wiring
date: 2026-07-27
category: docs/solutions/security-issues
module: proxy gate / staff front door
problem_type: security_issue
component: authentication
symptoms:
  - Deleting a security branch leaves the entire test suite green
  - A branch's stated purpose is future-proofing, and no assertion covers it
  - A "remove duplicate code" pass would delete a guard with no red test
root_cause: missing_validation
resolution_type: test_fix
severity: medium
tags:
  - proxy
  - auth-gate
  - mutation-testing
  - dead-code
  - enforcement-tests
  - tripwire
---

# A defensive branch that changes no behaviour has no behavioural signature

## Problem

Staff Front Door Unit 2 gated a new `/staff` hub. R6 requires the hub to be
held to *exactly* the CRM's standard, so the new branch in
`resolveProxyOutcome` returns exactly what the catch-all below it already
returned:

```ts
// app/lib/supabase/proxy-rules.ts
if (isStaffPath(pathname)) return resolveAdminClaimOutcome(session);

// /crm, plus anything else the matcher routes in.
return resolveAdminClaimOutcome(session);
```

The branch is not there for today's verdict — it is there so that the day
someone changes the catch-all (adds a prefix branch above it, relaxes the
default for an unknown route), `/staff` keeps the gate R6 chose for it rather
than silently inheriting the new one.

That intent was written into a nine-line comment. It was not written into a
test, and **it could not be**, which is the whole lesson.

## Symptoms

A review agent mutation-tested the branch: deleted the line, re-ran the suite.

```
Tests  50 passed (50)
```

Fifty tests, including an entire `describe` block named for `/staff`, and not
one of them noticed the guard was gone. Five reviewers reached the same place
independently — the testing persona by mutation, the others by reading.

## What Didn't Work

- **Testing the outcomes.** `outcome("/staff", guideSession) === "crm-staff-only"`
  passes with or without the branch, because the catch-all produces the same
  string. Every behavioural assertion about `/staff` is satisfied by the code
  path the branch exists to stop depending on.
- **Testing that `/staff` and `/crm` agree.** This is worse than useless as a
  guard: removing the branch makes them agree *structurally* rather than
  merely *currently*, so the assertion gets stronger as the protection
  disappears.
- **The comment.** Nine lines explaining why the duplication is deliberate stop
  a reader who reads them. They do not stop a bulk refactor, an automated
  simplification pass, or a merge conflict resolved toward the shorter side.

## Solution

Assert the **wiring**, in source, because the wiring is the only thing that
differs between "present" and "absent":

```ts
// app/staff/__tests__/staff-route.test.ts
const src = readFileSync("app/lib/supabase/proxy-rules.ts", "utf8");
const body = src.slice(src.indexOf("export function resolveProxyOutcome"));
expect(body).toContain("isStaffPath(pathname)");

// Ahead of the catch-all, or the branch is unreachable rather than inert.
const branch = body.indexOf("isStaffPath(pathname)");
const catchAll = body.lastIndexOf("return resolveAdminClaimOutcome(session)");
expect(branch).toBeLessThan(catchAll);
```

Re-running the reviewer's mutation now fails on exactly one test, named for
what it protects.

The repo already scans source this way — `sw-discipline.test.ts` pins a
service-worker scope, `fp-rename-straggler.test.ts` sweeps route literals, and
`no-auth-mail-guard.test.ts` enumerates reviewed call sites. This is that
idiom applied to an ordering constraint.

## Why This Works

A test can only observe a difference. When a branch's output is identical to
its fallback's, there is no difference to observe *at the level of behaviour* —
the branch's entire value lives at the level of **structure**, so that is the
level the assertion has to work at.

The ordering half matters as much as the presence half. A test that only
checked `body.includes("isStaffPath")` would pass if someone moved the branch
*below* the catch-all, which is exactly as broken as deleting it and even
harder to see.

## Prevention

- **Before writing a defensive branch, ask what would go red if it vanished.**
  If the honest answer is "nothing", the branch needs a structural test in the
  same commit, or it is a comment with an `if` in front of it.
- **Mutation-test guards whose value is future-proofing.** Delete the line,
  run the suite. Ten seconds, and it is the only way to learn that a guard is
  invisible. This is how the finding surfaced here.
- **Assert ordering, not just presence, whenever first-match-wins decides the
  answer.** Decision tables like `resolveProxyOutcome` are ordered by
  construction; a structural test that ignores order tests half the property.
- **Watch for the assertion that strengthens as the protection weakens.**
  "`/staff` and `/crm` agree" reads like a safety net and is the opposite. If
  removing the mechanism would make a test *more* certainly true, the test is
  measuring the wrong thing.

## Related

- `docs/solutions/security-issues/guard-function-with-no-callers-is-not-a-mechanism-client-side-supabase-auth-bypasses-server-guards-2026-07-23.md`
  — the sibling shape, and the same remedy from the other direction. There the
  guard had **zero callers**; here it has a caller but no observable effect.
  Both are mechanisms with no behavioural signature, and both are fixed by a
  static test written in the same commit as the guard.
- `docs/solutions/test-failures/middleware-proxy-is-testable-next-experimental-testing-server-2026-07-21.md`
  — where the `/staff` matcher assertions come from: extract the branch
  production calls, never a parallel helper.
- Plan: `docs/plans/2026-07-27-001-feat-staff-front-door-plan.md` (Unit 2).
