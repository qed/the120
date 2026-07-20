---
title: "A CRM capture modal freezes forever when its server action rejects — an awaited call with no try/finally never resets the submitting flag"
date: 2026-07-20
category: ui-bugs
module: crm
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "Staffer clicked 'Add family'; the button stuck on 'Saving…', every field stayed disabled, and only a full page reload recovered the modal"
  - "No error banner ever rendered — the failure was completely silent"
  - "Escape and backdrop-click did nothing, because close() early-returns while submitting is true"
  - "Triggered only when the action REJECTED (a transient Supabase/network stall, or requireStaff() → redirect() on an expired session) rather than returning {success,error}"
root_cause: async_timing
resolution_type: code_fix
severity: high
related_components:
  - authentication
  - database
tags:
  - server-action
  - try-finally
  - modal-freeze
  - react-client-component
  - async-error-handling
  - next-redirect
  - submitting-state
  - crm-pipeline
---

# A CRM capture modal freezes forever when its server action rejects — an awaited call with no try/finally never resets the submitting flag

## Problem

Two staff-facing CRM capture modals — **Add family** and **Log warm convo** — freeze permanently on their loading label ("Saving…" / "Logging…") whenever the awaited server action *rejects* instead of returning a `{ success }` result. Staff lose the modal entirely: every field is disabled, no error appears, and the only escape is a hard page reload — with no way to tell whether the record was saved.

## Symptoms

- After clicking **Add family** / **Log warm convo**, the submit button sticks on "Saving…" / "Logging…" indefinitely.
- Every input, the Cancel button, and the close-on-backdrop path are all disabled (`disabled={submitting}`), so the modal is fully inert.
- No error banner renders — the failure is completely silent.
- Escape and backdrop-click do nothing, because `close()` early-returns while `submitting` is `true`.
- In `LogWarmConvoModal`, the same freeze hits the "did you mean?" attach-or-create step ("Working…" sticks) via `attachToCandidate`.
- The record is *not* created — DB verification found zero matching rows — so the frozen modal is a pure UI dead-end, not a half-committed write.

## What Didn't Work

- **Blaming the input data ("Josh Barrick").** Suspected a data-specific server failure tied to that name. Ruled out: no special characters, and Zod validation returns `{ success: false }` rather than throwing, so there is no name-specific throw path.
- **Treating it as a recent regression.** Checked git history — the add-family (Unit 4) and warm-convo (Unit 5) modals predate the recent, unrelated gauntlet work; nothing recent touched these handlers.
- **Looking for an orphaned/duplicate DB row.** Verified production via the Supabase Management API (the DB password is stale — used the CLI token from Windows Credential Manager per the documented workaround; auto memory [claude]). Zero `families`/`parents` rows matching "barrick"; live families = 32, matching the user's view. This *proved* the action rejected **before** the insert committed — consistent with an early rejection in `requireStaff()` or a duplicate-probe stall — rather than a mid-write failure.
- **Writing a failing component test first.** No component-test harness exists (no `@testing-library/react`; the vitest suite is pure logic/action tests in node). Standing up a jsdom stack for a 3-line robustness fix would be scope creep; the reproduction here is by construction.
- **A client-side submit timeout.** Considered as a way to cover a truly-never-settling fetch, but rejected as riskier: a timeout could fire *after* the server committed the insert, showing a false failure and inviting a retry that creates a duplicate. `try/catch/finally` is the proportionate fix; the never-settling-fetch gap is accepted (see Prevention).

## Solution

Wrap each awaited server action in `try/catch/finally`, moving the loading-flag reset into `finally`. Applied to **all three** handlers: `AddFamilyModal.handleSubmit`, `LogWarmConvoModal.submit`, and `LogWarmConvoModal.attachToCandidate`.

**Before** (happy-path only — `setSubmitting(false)` runs only if the promise resolves):

```tsx
const result = await addFamily(payload);
setSubmitting(false);          // ← skipped entirely on rejection
if (result.success) { /* toast, reset, onClose, router.push/refresh */ }
else { setError(result.error ?? "Failed to add the family."); }
```

**After** (`AddFamilyModal.handleSubmit`):

```tsx
try {
  const result = await addFamily(payload);
  if (result.success) {
    toast("success", "Family added");
    if (result.warning) toast("info", result.warning);
    reset();
    onClose();
    if (result.familyId) {
      router.push(`/crm/pipeline?family=${result.familyId}`, { scroll: false });
    } else {
      router.refresh();
    }
  } else {
    setError(result.error ?? "Failed to add the family.");
  }
} catch {
  setError("Something went wrong saving the family. Please try again.");
} finally {
  setSubmitting(false);   // always clears — never freezes again
}
```

`LogWarmConvoModal.submit` got the same shape — note it uses an early `return` on both the `!result.success` and the no-email soft-match (`result.candidate && !result.familyId`) branches; `finally` still fires on those returns:

```tsx
try {
  const result = await logWarmConvo(payload);
  if (!result.success) {
    setError(result.error ?? "Failed to log the conversation.");
    return;                       // finally still runs
  }
  if (result.candidate && !result.familyId) {
    setCandidate(result.candidate);
    return;                       // finally still runs
  }
  finish(result.familyId, result.matched);
} catch {
  setError("Something went wrong logging the conversation. Please try again.");
} finally {
  setSubmitting(false);
}
```

`LogWarmConvoModal.attachToCandidate` is guarded identically, with its own "Something went wrong attaching the conversation. Please try again." message.

## Why This Works

**Root cause: an unhandled promise rejection combined with a loading flag that gates the entire modal.** The old code awaited the server action and then reset `submitting` on the *next* line. When the awaited promise rejects, the `await` throws, control leaves `handleSubmit` immediately, and `setSubmitting(false)` never runs. Because `submitting` drives both the button label (`{submitting ? "Saving…" : "Add family"}`) *and* the `disabled` state of every input, the Cancel button, and the close guard (`if (!submitting) onClose()`), a stuck `true` doesn't just show a bad label — it locks the whole dialog with no recovery path and no error surfaced.

**`finally` is the right tool** because it runs on every exit from the `try` block — resolve, reject, and early `return` alike — which is exactly the invariant a loading flag needs: it must be cleared no matter how the handler exits. Putting `setSubmitting(false)` anywhere else (after the `await`, or duplicated across branches) reintroduces a path that can skip it. `catch` then does the second half of the job: it converts a dead modal into a visible, retryable error.

**The server-action-can-still-reject nuance.** The convention says these actions "never throw to the client" — they return `{ success, error? }`. But that in-body contract only covers code that runs *inside* the action's own try. Two things bypass it entirely:

1. `requireStaff()` (`app/crm/lib/auth.ts`) is called *first*, before any try, and can `redirect()` on an expired session — which throws `NEXT_REDIRECT` — as well as doing Supabase lookups (`auth.getUser()`, a `staff` row probe) that can themselves reject.
2. The duplicate probes, the insert, and the audit write can reject on a transient Supabase/network stall.

Any of these rejects the promise the client awaited, sailing straight past the `{ success: false }` path the modal was written to expect. The client must therefore treat "the action rejected" as a real, first-class outcome — which is precisely what the `catch` now does.

## Prevention

- **Reset every loading flag in `finally`, not after the `await`.** Any handler that flips a `submitting`/`loading`/`pending` flag `true` before an `await` must clear it in a `finally`, so resolve, reject, and early-`return` paths all converge on the reset. This is the single rule that prevents the freeze class.
- **Never trust a server action's "never throws" comment from the client.** Auth redirects (`NEXT_REDIRECT`), `requireStaff()` Supabase lookups, and any fetch/DB call can reject *outside* the action's internal try. Client callers must always pair the `await` with a `catch` that surfaces a user-visible, retryable error — the `{ success: false }` branch is necessary but not sufficient.
- **Grep for unguarded call sites when auditing.** Search client components for an awaited action that isn't wrapped:
  ```
  rg -n 'await (addFamily|logWarmConvo|checkDuplicates|\w+)\(' app/crm/components --glob '*.tsx'
  ```
  Any awaited action that toggles a disabling flag and isn't inside a `try/catch/finally` is a latent freeze.
- **Consider a shared submit hook to centralize the guard.** A small `useSubmit(fn)` wrapper that owns the `submitting` state and the `try/catch/finally` would make the safe pattern the default and remove the chance of a future modal re-introducing the happy-path-only shape by hand. (Not built here — three call sites made inline guards proportionate — but worth it as the count grows.)
- **Known residual gap: a promise that never settles.** `finally` runs only when the promise *settles*; a fetch that hangs forever (no resolve, no reject) would still leave `submitting` stuck. A client-side timeout was deliberately rejected because it can fire after a successful commit and cause a duplicate-creating retry. This gap is accepted as lower-risk than the cure; revisit only if never-settling requests are observed in practice.

## Related Issues

- `docs/solutions/best-practices/shared-db-taking-core-must-not-live-in-a-use-server-file-server-action-boundary-2026-07-17.md` — same server actions (`addFamily`, `logWarmConvo`) and the `requireStaff` boundary, viewed from the server side (where the db-taking core may live) rather than the client caller.
- `.context/compound-engineering/todos/006-pending-p2-kanban-optimistic-race-token.md` — sibling client-side async-UI-state defect in the same `app/crm/components/pipeline/` directory (stale optimistic pin vs stuck loading flag).
- `.context/compound-engineering/todos/005-pending-p2-crm-reliability-hardening-error-paths.md` — the server-side cousin of this exact pattern: item #3 flags `proxy.ts getSession()` having no try/catch around an awaited call.
- `docs/solutions/integration-issues/supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md` — the Management-API channel used to verify no orphaned "barrick" row during this investigation.
