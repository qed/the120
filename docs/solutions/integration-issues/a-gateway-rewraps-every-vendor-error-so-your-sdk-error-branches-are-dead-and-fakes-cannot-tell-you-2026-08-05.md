---
module: fp-image-lab
date: "2026-08-05"
problem_type: integration_issue
component: api
severity: high
symptoms:
  - "Every production failure normalizes to the same opaque fallback code while the unit tests prove five distinct codes work"
  - "A fired AbortSignal.timeout is not classified as a timeout — the abort arrives as a generic 500-shaped error"
  - "rate_limited and the preserved HTTP status are unreachable in production, so operator triage collapses to 'the model is broken'"
root_cause: logic_error
resolution_type: code_fix
tags:
  - vercel-ai-gateway
  - ai-sdk
  - error-classification
  - abortsignal
  - test-fakes
  - unreachable-branch
---

# A gateway re-wraps every vendor error, so your SDK error branches are dead — and fakes that throw the SDK's error class cannot tell you

## Problem

An adapter called image models through **Vercel AI Gateway** using gateway
strings (`"openai/gpt-image-2"`) and normalized failures into a closed union
(`timeout | rate_limited | safety_blocked | provider_error | unconfigured`).
Classification keyed on the `ai` SDK's own error type:

```ts
if (APICallError.isInstance(err)) {
  if (err.statusCode === 429) return { kind: "rate_limited" };
  return { kind: "provider_error", detail: `api_error:${err.statusCode}` };
}
return { kind: "provider_error", detail: "unknown_error" };
```

126 tests passed. Three of the five branches were unreachable in production.

## Symptoms

- `rate_limited` never occurs — a real 429 records as `provider_error`.
- `api_error:<status>` is never emitted, so the status code the code
  deliberately preserved is always discarded.
- A misconfigured gateway (auth failure) reports as `provider_error/unknown_error`
  on every cell, so staff read *"this model is broken"* rather than *"the
  gateway is not authenticated."*
- A fired `AbortSignal.timeout` is **not** classified as `timeout`.

## Why This Happens

**1. The gateway owns the error type.** Every `doGenerate` in
`@ai-sdk/gateway` is wrapped in `catch (error) { throw await asGatewayError(error) }`.
`asGatewayError` converts an `APICallError` into a `GatewayError` subclass —
and (v4.0.30):

```ts
abstract class GatewayError extends Error {
  readonly type: string;        // 'rate_limit_exceeded' | 'authentication_error' | …9 values
  readonly statusCode: number;
  readonly isRetryable: boolean;
}
```

It extends `Error`, **not** `APICallError`, and carries a private-symbol marker
entirely separate from it. So `APICallError.isInstance(err)` is `false` for
essentially every failure that crosses the gateway.

**2. An abort is laundered into a generic error.** `AbortSignal.timeout()`
rejects with a `DOMException` named `TimeoutError`. The gateway's own
`isTimeoutError` only inspects `error.code` against undici's `UND_ERR_*`
constants — a `DOMException` has no `.code` — so it falls through to the default
branch and emerges as `GatewayResponseError` with `statusCode: 500` and a name
that says nothing about timing out. Any classifier checking
`err.name === "TimeoutError"` misses its own timeout.

That second one is the expensive half: the timeout outcome was the one
deliberately marked *billed* (vendors bill on generation, not delivery), so
mis-classifying it as `provider_error` recorded the most expensive outcome on
the priciest model as **unbilled**.

## What Didn't Work — and why the tests were complicit

Every error-classification test injected a literal `APICallError`:

```ts
generateImage: async () => { throw new APICallError({ statusCode: 429, … }); }
```

That is the one error class the real edge **cannot produce**. The suite proved
the branch worked and was structurally incapable of noticing the branch was
unreachable. Same for timeouts: the test synthesized
`const e = new Error("aborted"); e.name = "TimeoutError"` — a shape that only
exists in the test.

**The general trap:** when a fake stands in for a boundary, it encodes your
belief about what that boundary throws. If the belief is wrong, the fake and the
code are wrong *together*, consistently, and green.

## Solution

Classify on the wrapper, and decide aborts from the **signal**, not the error:

```ts
// 1. Duck-type the gateway error (the package is a TRANSITIVE dep — do not
//    import it in production code; only tests import the real subclasses).
const type = typeof (err as { type?: unknown }).type === "string" ? …;
const status = typeof (err as { statusCode?: unknown }).statusCode === "number" ? …;
if (type === "rate_limit_exceeded" || status === 429) return { kind: "rate_limited" };

// 2. An abort is known from the signal we own, never from the thrown error —
//    the gateway may re-wrap it as anything at all.
if (ctx.timeoutSignal.aborted) return { kind: "timeout", cause: "adapter_timeout" };
if (callerSignal?.aborted)     return { kind: "timeout", cause: "caller_aborted" };
```

and test against the shapes the edge really produces:

```ts
import { GatewayRateLimitError, GatewayResponseError } from "@ai-sdk/gateway";
// …including the production abort shape: our signal fires, and the gateway
// re-wraps it as a GatewayResponseError whose name says nothing about timing out.
```

## Why This Works

The thrown error is the *gateway's* artifact and it may change shape under a
lockfile bump. The abort signal is **ours** — we constructed it, so it is the
only trustworthy witness that we hung up. Keying the most expensive
classification on a value we own removes the dependency entirely.

## Prevention

- **Ask what the edge actually throws, and read the dependency's `catch` blocks
  to find out.** A provider SDK behind a gateway/proxy/wrapper rarely surfaces
  its own error types.
- **A test fake must reproduce the boundary's real output shape.** If the fake
  throws a class the production path can never yield, the test is testing a
  fiction. Import the real error classes in tests even when production code
  duck-types them.
- **Never classify an abort from the thrown error's name.** Check the signal.
- Note the dependency subtlety here: `@ai-sdk/gateway` is transitive (not in
  `package.json`), and `GatewayTimeoutError` is not exported from the package
  index at all — so production duck-types `type`/`statusCode`, and only the
  tests reach for the concrete classes.
- Grep for branches keyed on a foreign error class and ask "can this fire?"
  Unreachable-branch bugs are invisible to coverage tools when a fake reaches
  them.

## Related

- `docs/solutions/logic-errors/a-classifier-that-reads-free-text-containing-user-content-lets-the-user-steer-it-2026-08-05.md`
  — the other classification defect found in the same review: what the
  classifier reads mattered as much as which errors reach it.
- `docs/solutions/best-practices/a-server-side-timeout-does-not-bound-a-request-that-never-lands-bound-the-clients-own-await-2026-07-27.md`
  — the timeout half of this, one layer up.
