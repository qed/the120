---
title: "A 404 is not proof of revocation — terminal UI states in a poller need consecutive confirmation, and the state machine belongs in a rules module"
date: 2026-07-28
category: best-practices
module: first-profit
problem_type: best_practice
component: fw-board
symptoms:
  - "Revoked board link showed 'connecting' forever while polling a dead token every 4s (checks 3.5.3, 3.18.2)"
  - "Naive fix (single 404 → terminal) would let one transient blip permanently kill a healthy projector board"
root_cause: design_gap
resolution_type: code_fix
severity: medium
last_updated: 2026-07-28
related_components:
  - fw-board-rules
tags:
  - polling
  - terminal-state
  - tri-state
  - 404
  - state-machine
  - no-jsdom
---

# A 404 is not proof of revocation — terminal poller states need consecutive confirmation

## Problem

The board poller had no terminal state: a revoked token 404'd forever as "connecting". But the obvious fix — treat a 404 as terminal — is wrong on two counts discovered at review time:

1. The server deliberately maps **transient DB read errors** to the same bare 404 (`fw-board-loader.ts` fail-closed + anti-enumeration collapse).
2. Venue middleboxes/captive portals can answer genuine HTTP 404s.

Either would have permanently killed a healthy board mid-event (poll stopped, frame cleared) on one bad response.

## Solution

`fwBoardConnectionState(prev, outcome)` — a pure reducer in `fw-board-rules.ts` returning `{ phase: "live" | "catching_up" | "connecting" | "dead_link", consecutive404 }`:

- **Two consecutive 404 responses** → `dead_link` (sticky terminal: absorbs every later event; interval stops; generic recovery copy — no revoked/expired/never-existed distinction leaks).
- A **single 404** still clears the displayed frame immediately (children's names off the projector — security acts on suspicion) but stays non-terminal — display and terminality are separate decisions. **Amendment (same day):** "clears the displayed frame" was initially scoped to one state store; adversarial review found the independent celebration overlay kept a name on screen until terminality. The first-404 clear must sweep *every* name-bearing store — see `docs/solutions/security-issues/revocation-clearing-must-sweep-every-name-bearing-state-store-2026-07-28.md`.
- An answered non-404 (200 *or* 503) resets the 404 run — it proves the token still resolves. A **thrown fetch is no information**: it neither breaks nor extends the run, so `404 / wifi-blip / 404` is still terminal.
- Header pill, interim body copy, and terminal panel all render from one exported presentation table keyed by phase, so surfaces cannot disagree.

## Prevention

- Terminal dispositions driven by a fail-closed signal need **tri-state input** (authoritative refusal / could-not-tell / success) *and* confirmation across polls before acting irreversibly. Sibling doc: `offline-drain-reuses-a-fail-closed-signal-across-a-safety-boundary-irreversible-action-needs-tri-state-2026-07-24.md`.
- Under the no-jsdom canon, the counter/memory (`consecutive404`) must live INSIDE the reducer's state, not in component refs — otherwise the terminality decision is untested control flow in a `.tsx`.
- When you add a state machine, make every user-facing surface (header, body, panel) a lookup off the machine's output; leaving one hardcoded string behind reintroduces the disagreement the machine was built to kill.

## Related

- Branch `fix/fp-bug-work-order`, plan `docs/plans/2026-07-28-001-fix-fp-blockers-shouldfix-plan.md` (Unit 2, Open Questions: 404-authoritativeness decision).
