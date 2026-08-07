---
module: fp-v3-onboarding
tags: [window-open, noopener, popup-blocker, fallback, cross-file-invariant, handoff]
problem_type: ui_bug
component: frontend_stimulus
severity: medium
symptoms:
  - "A graceful fallback path runs for every user instead of the rare case it was written for"
  - "The primary path appears implemented and is never actually taken"
  - "Nothing errors, nothing looks broken, and no test fails"
root_cause: wrong_api
resolution_type: code_fix
---

# `window.open` with `noopener` always returns null — so the blocked-popup fallback silently absorbed every desktop handoff

## Problem

The account-ready screen opens First Profit in a new tab, using the standard
sync-open/async-navigate pattern (open synchronously inside the click handler, before
any `await`, so the popup blocker does not stop it; navigate once the one-time code is
minted). It handled a blocked popup gracefully by falling back to a visible manual link:

```ts
const win = window.open("", "_blank", "noopener,noreferrer");
// ...await the mint...
if (win === null) {
  // "your browser blocked the new tab" -> render a manual link instead
} else {
  win.location.href = destination;
}
```

Per the HTML spec, **`window.open` returns null whenever `noopener` is requested** —
the whole point of `noopener` is that the opener gets no handle to the new window. So
`win` was null on every call, for every browser, blocked or not. Every desktop family
took the "your browser blocked the new tab" path.

Nothing broke. No error, no failed test, no console warning. The fallback is a
perfectly good experience — a visible link that works — so the defect presented as
"the feature works, slightly differently than described." It was found only while
changing the surrounding code for an unrelated reason.

## Symptoms

- A branch written for a rare failure case is, in fact, the only branch that runs.
- The "happy path" code is present, reviewed, and unreachable.
- Because the fallback is graceful, there is no signal: no exception, no log, no
  visual defect, and any test asserting "the user can get there" passes via the
  fallback.
- Often paired with a comment or design doc describing the primary path as the normal
  case.

## What Didn't Work

- **Reading the code.** The pattern is textbook-correct: synchronous open, null check,
  fallback. The bug is a property of the API, not the shape of the code.
- **Testing that the user can reach the destination.** They can — via the fallback.
  A test at that altitude is satisfied by the failure mode.
- **Manual use.** The fallback link is unremarkable; a person clicking through would
  reasonably assume it was the intended design.

## Solution

If you need the handle, do not ask for `noopener`; sever the relationship yourself:

```ts
const win = window.open("", "_blank");   // no features string
if (win) win.opener = null;              // same protection, handle retained
// ...await the mint...
if (win === null) { /* genuinely blocked -> manual link */ }
else win.location.href = destination;
```

`win.opener = null` gives the same protection `noopener` was there for, while leaving
the handle the navigate-after-await pattern requires. (The destination here is
first-party, so the reverse-tabnabbing risk `noopener` guards against is already low —
but nulling it costs nothing and keeps the guarantee.)

The two are mutually exclusive by design: **`noopener` and "keep the handle" cannot
both be true.** Any code that opens with `noopener` and then inspects or uses the
return value has a contradiction in it.

## Why This Works

`noopener` is defined to break the opener relationship in both directions — the child
cannot see `window.opener`, and the parent is not given a `WindowProxy`. Returning null
is the specified behavior, not a browser quirk or a blocker heuristic. Assigning
`opener = null` after the fact achieves the child-side protection without asking the
platform to withhold the handle.

## Prevention

- **Never combine `noopener` with a return-value check.** If the code reads `win`, drop
  `noopener` and null `opener` manually. Treat `window.open(..., "noopener")` returning
  something as impossible.
- **A fallback that silently absorbs a bug is a bug detector you disabled.** When a
  branch exists for a rare condition, make taking it observable — log it, count it, or
  surface it in the state the tests can see. Here, one log line on the
  "blocked" branch would have shown 100% of desktop sessions hitting it on day one.
- **Assert which branch ran, not only that the outcome was reached.** A test that says
  "the family can get to First Profit" passes through either path. A test that says
  "the new tab was navigated" would have failed immediately.
- **A safety argument that depends on another file's behavior is a cross-file
  invariant — name the file.** The server-side decision never to un-burn a consumed
  handoff code was justified partly by "the family is still standing on the
  account-ready screen holding their credentials." That was a claim about a *client*
  component, and it was only true on desktop; the mobile branch navigated the tab away
  before the exchange ran. When a comment in module A justifies a behavior using a
  property of module B, say so explicitly in the comment so the two cannot drift apart
  silently — and re-check it whenever either side changes.
- Related: [a flag that gates the page does not gate its Server Actions](../security-issues/a-flag-that-gates-the-page-does-not-gate-its-server-actions-v3-signup-2026-08-05.md)
  (same family: a guarantee assumed at one layer that the other layer never provided).
