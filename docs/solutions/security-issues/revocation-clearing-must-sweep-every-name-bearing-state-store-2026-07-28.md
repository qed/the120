---
title: "Revocation clearing must sweep every name-bearing state store, not just the primary one — a celebration overlay kept a child's name full-screen after the board 'cleared'"
date: 2026-07-28
category: security-issues
module: first-profit
problem_type: security_issue
component: fw-board
symptoms:
  - "On token revocation (first 404), FwBoard cleared the board frame via setFeed(null), but a queued or active First Dollar celebration overlay kept rendering a student's real full name full-screen for up to two ~6.5s CELEBRATION_MS cycles"
  - "Overlay render guard checked only the terminal dead_link phase (reached after two consecutive 404s), not the first 404 that already cleared the frame"
  - "activeRef/queueRef/active — the celebration overlay's own independent state — were not swept by the revocation-clearing branch that cleared the primary frame"
root_cause: missing_workflow_step
resolution_type: code_fix
severity: high
last_updated: 2026-07-28
related_components:
  - fw-board-rules
tags:
  - revocation
  - pii
  - celebration-overlay
  - state-clearing
  - poll-loop
  - incident-response
  - fw-board
---

# Revocation clearing must sweep every name-bearing state store, not just the primary one

## Problem

Revoking a leaked FW projector URL is the only incident-response control available, but a queued or active "First Dollar" celebration overlay could keep a child's name full-screen for up to ~13 seconds after the token was revoked — the overlay is a separate state machine from the grid the revocation code actually cleared. Found by adversarial review on `fix/fp-bug-work-order` (PR #83), fixed in commit `11fe342`, before any production cohort was live.

## Symptoms

- Grid names vanish on the first 404 after revocation, but a `fixed inset-0` celebration overlay continues showing a child's name on top of the cleared frame.
- Overlay persists until `CELEBRATION_MS` (6500ms) elapses or the second consecutive 404 flips `connection.phase` to `dead_link` — and `pump()` can raise a *second* queued name before that.
- No error, no crash — a silent gap: the incident responder sees the grid clear and assumes the leak is contained.

## What Didn't Work

The render guard `{active && connection.phase !== "dead_link" && <CelebrationOverlay .../>}` looked like it already handled revocation: it gates on the connection phase, and the 404 path drives that phase. But `dead_link` deliberately requires **two consecutive 404s** (transient-404 tolerance — the server maps DB read errors to bare 404s), while the frame is cleared on the **first** 404 ("security acts on suspicion"). Display-clearing and terminality are different decisions with different acceptable latencies; the overlay's guard was keyed to the slow, confirmed signal and silently inherited the wrong latency budget. The celebration machinery (`activeRef`, `queueRef`, `setActive`, the `CELEBRATION_MS` hold timer) was a state store the frame-clearing code never touched.

## Solution

The 404 branch now flushes every name-bearing store in the same `cancelled`-guarded continuation (`app/fp/fw/components/board/FwBoard.tsx:173-192`):

```ts
if (res.status === 404) {
  // ... existing revocation comment: REMOVE names, don't mark stale ...
  // "Every name" includes the celebration machinery: a queued or ACTIVE
  // First Dollar overlay carries student names too, and it renders on top
  // of the cleared frame. A celebration dropped on a transient 404 is the
  // accepted cost.
  setFeed(null);
  hasFrameRef.current = false;
  queueRef.current = [];
  activeRef.current = null;
  setActive(null);
  dispatchOutcome({ httpStatus: 404, fetchThrew: false, frameLanded: false, hasFrame: false, ... });
```

Timer safety is incidental, not an added mechanism: the hold timer lives in an effect keyed on `active`, so `setActive(null)` re-runs it and the cleanup `clearTimeout`s the pending hold; a `pump()` racing in afterward finds both refs empty and returns.

## Why This Works

Root cause: **multiple independent name-bearing state stores, only one of which the revocation control swept**. The grid (`feed`/`hasFrameRef`) and the celebration overlay (`activeRef`/`queueRef`/`active` + timer) both render student names but are separate machines updated by separate paths. The fix brings the overlay's clear-latency in line with the grid's (first 404) without touching the deliberately slower `dead_link` terminality decision, which still waits for confirmation and still owns stopping the poll.

## Prevention

- **Review question for any "clear sensitive data on signal X" control:** enumerate every state store that can put the protected data on screen — component state, refs, overlay queues, toasts, timers, caches. Grep for the sensitive field (e.g. the display-name prop) across the component tree; a control that sweeps only the store the author was looking at passes review while siblings keep rendering.
- **Separate "act on suspicion" from "act on confirmation" explicitly.** A security clear should trigger on the first signal even while a tolerance/terminality machine correctly waits for confirmation for its own purposes. Never let a security clear inherit its trigger from a debounced/confirmed state just because it is convenient to key off — check the latency budget against the threat model.
- **Don't trust vacuous negative assertions as guards** (secondary lesson from the same review round): a test asserting a *resolved* runtime string doesn't contain `"${"` is always true — template literals are already evaluated by the time the test sees them. The real guard reads the module source and asserts each literal appears verbatim:

  ```ts
  const source = readFileSync(fileURLToPath(new URL("../fw-board-rules.ts", import.meta.url)), "utf8");
  expect(source).toContain(`"${dotClass}"`);
  ```

  Mutation-test the guard before trusting it (concatenate one value at its definition site → the test must fail). See `app/fp/lib/__tests__/fw-board-rules.test.ts` in commit `11fe342`.

## Related

- `docs/solutions/best-practices/a-404-is-not-proof-of-revocation-terminal-ui-states-need-consecutive-confirmation-2026-07-28.md` — same review pass, distinct lesson: that doc covers **when to stop polling** (consecutive-404 terminality); this doc covers **what to clear on first suspicion**.
- `docs/solutions/best-practices/offline-drain-reuses-a-fail-closed-signal-across-a-safety-boundary-irreversible-action-needs-tri-state-2026-07-24.md` — sibling of the pattern family: a single collapsed decision failing to reach every place it must act.
- GitHub issues: none found (`gh issue list --search "board revocation celebration"` — empty).
