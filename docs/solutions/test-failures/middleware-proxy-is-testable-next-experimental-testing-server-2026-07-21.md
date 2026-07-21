---
title: "\"We can't test the proxy\" is false — next/experimental/testing/server ships in the repo"
date: 2026-07-21
category: docs/solutions/test-failures
module: testing
problem_type: test_gap
component: proxy_middleware
symptoms:
  - "A plan or code comment asserts the repo has no way to construct a NextRequest, so proxy/middleware logic is left untested"
  - "A pure helper is extracted 'so it can be tested', then never imported by the production file — green tests that prove nothing"
  - "`config.matcher` changes ship with no test; nobody knows whether `/crm` bare or `/pathology` actually route into the gate"
root_cause: incorrect_assumption
resolution_type: test_added
severity: high
tags: [nextjs, proxy, middleware, vitest, test-theatre, dead-code, matcher, auth-gate]
---

# "We can't test the proxy" is false — `next/experimental/testing/server` ships in the repo

## Problem

While fixing two session-desync bugs in `proxy.ts` (the gate for `/crm`, and from The Path's Unit 6 also `/path`), the working assumption — written into the plan, the module docstring, and the test file — was:

> the repo has no way to build a NextRequest in a test

That assumption drove a bad design. Rather than test the gate, a pure helper `authCookieNames(cookies)` was extracted "so the carry-over is assertable", given three tests, and documented as one of the module's two responsibilities. `proxy.ts` never imported it. It reduced to `cookies.map(c => c.name)`.

Three independent reviewers converged on it. The suite was green, the coverage was theatre, and the actual carry-over — the highest-blast-radius logic in the change, the thing that silently ends a live admin session if it regresses — had zero tests.

## Root cause

The assumption was never checked. `next/experimental/testing/server` **is present** in Next 16.2.10 and exports:

- `unstable_doesMiddlewareMatch({ config, url, headers, cookies })` — asserts the real router against a `config.matcher`
- `getRedirectUrl`, `getRewrittenUrl`, `isRewrite` — assert on a returned response

It fails to `require()` under plain Node with `Invariant: AsyncLocalStorage accessed in runtime where it is not available`, which reads like "unsupported here" and is easy to accept as confirmation. It isn't. Next looks for `AsyncLocalStorage` on `globalThis` (edge-runtime convention); Node keeps it in `node:async_hooks`. One line bridges it:

```ts
import { AsyncLocalStorage } from "node:async_hooks";
(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??= AsyncLocalStorage;
```

After that it works in a plain `environment: "node"` vitest file — no jsdom, no new dependency, no config change.

## Resolution

1. **Deleted `authCookieNames` and its three tests.** Dead code with tests attached is worse than an honest gap: it reports coverage where none exists.
2. **Extracted the decision that actually existed.** The carry-over loop had one real branch — which headers survive onto a redirect/rewrite. That became `shouldCarryHeader(key)`, wired into `proxy.ts` and tested. Extract the *predicate the production path calls*, never a parallel helper it ignores.
3. **Added matcher tests against the real router**, importing `config` from `proxy.ts` so the assertions track the shipped value. These confirmed `/crm` bare and `/crm/` route in (so the CRM index cannot bypass the gate) and `/pathology` does not.

The header predicate also caught a second bug the reviewers found: the carry-over copied *every* non-`set-cookie` header, including Next's internal `x-middleware-*` wire protocol. `NextResponse.next()` stamps `x-middleware-next: 1` on itself, so a rewrite shipped two contradictory routing directives on one response, with the outcome left to undocumented router precedence.

## Prevention

- **Verify "X is untestable" before designing around it.** The check here cost one `node -e` and one `ls node_modules/`. The assumption cost a dead abstraction, three meaningless tests, and an untested auth gate.
- **A pure helper is only worth extracting if the production path calls it.** Before adding tests for an extracted function, grep that the non-test code imports it. If nothing does, the extraction is decoration.
- **`config.matcher` is testable and should be tested** — routing is exactly where an auth gate silently stops covering something. Import `config` from the proxy so the test cannot drift from the shipped value.
- **Extract the branch, not the loop.** An unconditional copy has no decision to test; the `if` inside it does.

## See also

- `docs/solutions/test-failures/vitest-include-allowlist-new-test-dirs-silently-never-run-2026-07-18.md` — the other way this repo produces false-green suites
- `app/crm/lib/access.ts` + `app/crm/__tests__/auth-guard.test.ts` — the pure-verdict-module pattern done right, where `requireStaff()` genuinely calls the tested function
- `docs/plans/2026-07-21-001-feat-the-path-t1-core-loop-plan.md` — Unit 1
