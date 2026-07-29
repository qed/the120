---
title: A pending transition's resolution must not override user navigation, and the resolved step must own the URL
date: 2026-07-29
category: ui-bugs
module: funnel-miniapp
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - Tapping Back while a forward action is in flight lands the user forward anyway when the action resolves
  - Browser Back to the bare (no ?step=) URL renders the SSR-time landing step under client state that has already moved on
root_cause: async_timing
resolution_type: code_fix
severity: medium
related_components:
  - hotwire_turbo
tags: [router-replace, back-navigation, pending-transition, url-state, server-prop, miniapp, next-app-router]
---

# A pending transition's resolution must not override user navigation, and the resolved step must own the URL

## Problem

Unit 5 of the funnel-dashboard reconnect added visible ← Back controls and a server-resolved initial step to the mini-app's URL-derived step machine (`app/start/child/[childId]/MiniAppShell.tsx`). Review caught two navigation hazards before ship: a race where an in-flight forward action's completion stomps a Back navigation the user just made, and a staleness trap where the server-computed landing step is frozen at SSR time.

## Symptoms

- Parent taps "Confirm door", then immediately taps ← Back; when `confirmDoorAction` resolves it fires its unconditional `go(next)` and yanks the UI forward, silently overwriting the Back.
- After confirming a door or composing a project in-session, pressing browser Back enough times to reach the original bare `/start/child/[id]` history entry re-renders with the *original* `serverInitialStep` (e.g. `handoff`) while client state (`confirmedSlug`, `composeView`) is already further along — an internally inconsistent screen.

## What Didn't Work

- Reasoning that "every `go()` writes `?step=`, so the server prop can never shadow later navigation" — true for forward navigation, false for history: the bare-URL entry stays in the stack, and a soft back-navigation to it re-renders the same component instance with the frozen prop, never re-running the server.
- Leaving Back controls un-guarded because they "only navigate" — navigation is exactly what the async completion also does, so the last writer wins and it may not be the user.

## Solution

Two complementary fixes:

1. **Pending-guard every navigation affordance, not just forward CTAs.** The Back buttons take `disabled={pending}` (same idiom as the forward buttons); the handoff's exit link renders inert (`pointer-events-none opacity-30`, `aria-disabled`, `tabIndex={-1}`) while pending. A resolution can then never race a navigation the user made mid-flight, because no navigation can be made mid-flight.

2. **Materialize the resolved step into the URL on mount.** When the request had no `?step=`, a mount-time `useEffect` runs `router.replace` writing the resolved step into the URL (preserving the rest of the query exactly as `go()` does). The bare-URL history entry never survives, so browser Back can only ever land on entries whose `?step=` reflects a step the user actually visited; the frozen SSR prop is consulted exactly once, for first paint.

The derivation stays a pure rule shared by server and client: `resolveStep(rawStep, serverInitialStep)` in `app/lib/funnel/miniapp-rules.ts` — a present param (even invalid) resolves through `parseStep`'s fail-open; only a *missing* param takes the server landing.

## Why This Works

Both bugs are the same shape: **two writers of navigation state with no precedence rule.** In (1) the writers are the user and an async completion; the fix serializes them (no user navigation while a completion is pending). In (2) the writers are the SSR snapshot and the session's live progress; the fix retires the snapshot the moment the client can own the URL, making the URL the single durable record. This extends the repo's existing "URL is the single source of step state" decision to cover history entries, not just forward pushes.

## Prevention

- Any component that navigates on async completion (`go(...)` after an awaited action) must pending-guard *all* navigation affordances it renders, backward ones included — or check that the current step is still the one the transition started from before navigating.
- A server-computed "initial X" prop consumed by a client component is a snapshot, not a fact. If the component can outlive the snapshot (soft navigation, history), either materialize the resolved value into durable client state (URL) on mount, or re-derive from live client facts — never keep falling back to the prop.
- Walk the history stack in review: for every entry the flow can create (including the entry URL itself), ask "what renders if the user Backs onto this after state moved on?"

## Related Issues

- `docs/solutions/logic-errors/client-draft-state-scoped-by-a-server-fact-must-reset-when-the-fact-changes-2026-07-28.md` — same component, complementary failure: stale *draft state* under Back/Forward; this doc covers stale *navigation* and the stale *URL entry*.
- `docs/solutions/ui-bugs/router-push-then-refresh-races-next16-client-cache-redirect-from-the-action-instead-2026-07-28.md` — sibling Next 16 router race (two router operations, later one wins).
- `docs/solutions/logic-errors/raw-vs-resolved-the-caller-passed-the-store-value-where-the-derived-answer-was-meant-2026-07-28.md` — the frozen SSR prop is the prop-shaped instance of raw-vs-resolved.
