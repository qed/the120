---
title: "fix: FP bug work order — 7 blockers + should-fix items"
type: fix
status: completed
date: 2026-07-28
origin: docs/FP-BUGS-2026-07-28.md
---

# fix: FP bug work order — 7 blockers + should-fix items

## Overview

Close the 7 blockers and the code-addressable should-fix items from the 2026-07-28 First Profit manual test report. Three blockers collapse into two root causes (a Next 16 client-router `push`/`refresh` race, and a revoked board token rendering as an indefinite "connecting" state), so the work is seven implementation units, ~4.5–5.5 half-days. D1 is decided: **Option A — Founders Weekend is a sub-brand of First Profit** (recorded in the origin document, §1).

## Problem Frame

Manual test run 2026-07-28: 157 pass · 11 fail · 7 partial-odd of 237 checks (see origin: `docs/FP-BUGS-2026-07-28.md`). The failures cluster around: navigation-after-mutation not landing (checks 2.5.8, 3.10.2, 2.4.2), revoked projector-board links dead-ending operators (3.5.3, 3.18.2), a WCAG 1.4.1 colour-only board grid (3.18.5), a silently-suppressed First Dollar celebration (2.7.4), and brand-string drift on guide surfaces (1.1.4, 3.1.6, 3.18.10).

A verification pass confirmed the work order's root-cause claims against the code — all file references check out (minor line drift only: `fwBoardTokenVerdict` is at `fw-board-rules.ts:218` not :226; its server-side-distinction comment at :212-216).

## Requirements Trace

- R1. (B2/B5/S1 — checks 2.5.8, 3.10.2, 2.4.2) After quick-create, sign-in, or invite-claim, the user lands on the destination route within one render, no reload; a newly created student is findable in roster search on the next render.
- R2. (B4/B6 — 3.5.3, 3.18.2) A revoked board link reaches a distinct terminal panel within two poll intervals (≤8s — two consecutive 404s required, see Key Technical Decisions), names a recovery step a non-technical operator can follow, and stops polling. No revoked/expired/never-existed distinction leaks.
- R3. (B7 — 3.18.5) Board cells distinguish verified / not-yet / untouched by a non-colour channel legible at projector distance, and carry a programmatic name (task + state).
- R4. (B1/B3/S9 — 1.1.4, 3.1.6, D1 Option A) Every guide-facing `/fp/fw` title and the guide invite email carry First Profit branding per the §1 inventory, with a drift-guard test.
- R5. (S2 — 2.7.4) First Dollar celebration diagnosis confirms/refutes the clock-skew hypothesis before any fix; if confirmed, the online capture path stops sending a device timestamp. `FW_FIRST_DOLLAR_FRESHNESS_MS` is not widened.
- R6. (S3 — 3.18.10) The cohort sticky header no longer duplicates the StaffBar's application label.
- R7. (S4 — 3.5.5) Board-token expiry boundary is covered by unit test.
- R8. (S5/S6/S7 manifest-half — 3.5.6, 3.10.1) Closed from source with no code change (optional route-header test for S5).
- R9. (Definition of done, origin §8) `npm test` green with the new suites; lint clean on touched files; no new decision logic inline in `.tsx` files; manual re-verification of 2.5.8, 3.10.2, 3.5.3, 3.18.2, 3.18.5, 2.4.2 against a live cohort; generalisable learnings documented under `docs/solutions/`.

## Scope Boundaries

- **Out:** the 62 untested checks (origin §7); the §5 test-harness gaps (second browser profile rig); S8 heap measurement; S7 physical-device iOS QA. All non-code.
- **Out:** any widening of `FW_FIRST_DOLLAR_FRESHNESS_MS` (weakens replay suppression), any loosening of failed checks, any change to the offline sync path's required `capturedAt` (`fw-sync-client.ts`, `fw-sync.ts` — genuinely needs the device stamp).
- **Out:** the `path-*` internal identifiers (IDB/SW/cron) — deliberately kept per `docs/solutions/best-practices/route-rename-boundary-sweep-and-count-bounded-straggler-catcher-2026-07-24.md`; the D1 brand sweep must not touch them.
- **Unchanged invariants:** the board feed's anti-enumeration single-404 contract; the four-layer attestation defence (S6); `resolveFwBoardToken` refusal collapsing; refresh-only `router.refresh()` call sites elsewhere in FW (FwCohortCreate, FwGuideRoster, FwImportExceptions — no push pair, not part of RC-1).

## Context & Research

### Relevant Code and Patterns

- `app/fp/lib/actions/fw-ops.ts` (~12 `revalidatePath` call sites) and `fw-import.ts` (2) — the invalidation pattern `fw-student.ts` is missing.
- `app/fp/lib/__tests__/fw-board-rules.test.ts` — house test style: fixed `NOW` instant, fixture factories (`ev()` helper), `toEqual` on whole discriminated-union results, prose `it` names.
- `app/fp/lib/skin-tokens.ts` + its test — the complete-literal `CLASS_TABLE` + resolver shape for B7's state→presentation mapping.
- `app/lib/staff-bar/__tests__/bar-wiring.test.ts` — the source-scan test pattern: reads production source relative to `import.meta.url`, strips comments before matching, asserts structure not exact spellings.
- `app/fp/lib/fw-nav-rules.ts` — existing constants (`FW_OPS_CREATE_PATH`, `FW_BAND_LABEL`) make it the home for `FW_BRAND_SUFFIX`.
- Vendored Next 16 docs (`node_modules/next/dist/docs/.../04-functions/`): `use-router.md` ("`router.refresh()` … clears the Client Cache for the current route, but does not invalidate the server-side cache — use `revalidatePath`"), `redirect.md` (in a Server Action serves a 303, throws `NEXT_REDIRECT`, must sit outside try/catch), `revalidatePath.md` (in Server Functions "updates the UI immediately"). Confirms the server-side redirect shape for RC-1.

### Institutional Learnings

- `docs/solutions/ui-bugs/server-action-rejection-no-try-finally-freezes-capture-modal-2026-07-20.md` — client components awaiting a server action must reset UI state in `finally` and treat rejection as a real path; `redirect()` throwing is exactly such a rejection. Applies to all three RC-1 client call sites.
- `docs/solutions/best-practices/offline-drain-reuses-a-fail-closed-signal-across-a-safety-boundary-irreversible-action-needs-tri-state-2026-07-24.md` — a terminal disposition needs tri-state input: authoritative refusal (404 response) ≠ could-not-tell (network throw). Shapes RC-2's state machine.
- `docs/solutions/best-practices/offline-sync-device-clock-is-untrusted-input-membership-holds-single-clock-freshness-clamp-and-record-2026-07-22.md` — the direct sibling of S2: one clock for freshness math; clamp AND record. The S2 fix (omit `capturedAt` online) implements single-clock freshness.
- `docs/solutions/best-practices/tailwind-v4-theme-not-scopable-inline-literals-two-namespace-classname-swap-2026-07-22.md` — origin of the complete-literal constraint B7 must respect.
- `docs/solutions/test-failures/a-source-scanning-test-is-defeated-by-a-spelling-you-did-not-guess-2026-07-27.md` — drift-guard scans must anchor structurally, strip comments, resolve paths from `import.meta`, and be mutation-tested (prove each scan can fail).
- `docs/solutions/test-failures/vitest-include-allowlist-new-test-dirs-silently-never-run-2026-07-18.md` — all new tests go under the already-allowlisted `app/fp/lib/__tests__/`; confirm new files appear in the `npm test` run listing.
- `docs/solutions/runtime-errors/use-server-type-reexport-registers-server-reference-referenceerror-2026-07-22.md` + `best-practices/shared-db-taking-core-must-not-live-in-a-use-server-file-server-action-boundary-2026-07-17.md` — action files stay thin, export only async functions, never re-export types.
- `docs/solutions/test-failures/vi-resetmodules-...-fake-timers-only-fire-timers-that-already-exist-2026-07-27.md` — relevant only if RC-2 tests ever touch timers; the plan avoids this by keeping the state machine pure (no timers in tests).
- `docs/solutions/best-practices/memoizing-an-auth-gate-that-redirects-react-cache-throwing-gate-2026-07-27.md` — Next 16 layouts do not re-render on soft navigation; the RC-1 fix must not rely on a layout re-render for freshness.

## Key Technical Decisions

- **RC-1 fix shape: server-side `revalidatePath` + `redirect` from the Server Action** (origin's preference 1, confirmed by vendored Next 16 docs). One round trip, no client-cache race, matches the repo's existing invalidation pattern. `redirect` throws `NEXT_REDIRECT`, so it goes after the action's try/catch (per `redirect.md`), and the client `finally` handles pending-state reset.
- **RC-2: pure reducer in `fw-board-rules.ts`** — `fwBoardConnectionState(prev, pollOutcome)` → `"live" | "catching_up" | "connecting" | "dead_link"`, so terminal stickiness (`dead_link` absorbs every later event) is a tested property of the rules module, not untested control flow in the component. `BoardHeader` renders the machine's output, replacing today's inline `stale`/`hasData` ternary, so header and panel share one disposition source. `dead_link` is the origin's "revoked" terminal state, named generically because it also covers expired and never-existed tokens. Tri-state input: **two consecutive 404 responses** are terminal — a single 404 is not, because the server deliberately maps transient DB read errors to the same bare 404 (`fw-board-loader.ts:87`) and venue middleboxes can answer real 404s; one blip must not kill a healthy board. A thrown fetch/network error is never terminal (stays stale/catching-up).
- **B7: extend the state mapping to complete-literal class strings + labels as a pure exported function**, following the `skin-tokens.ts` CLASS_TABLE shape. Border-style + fill-density differences (not glyphs) at 10px cell size.
- **S2 is diagnose-first**: confirm skew from `path_fw_events` data before changing code; the fix is omission (schema already optional end-to-end), not threshold widening.
- **D1 drift guard is a source-scan test** in the `bar-wiring.test.ts` style, count-bounded, structurally anchored — not exact-spelling pins.

## Open Questions

### Resolved During Planning

- D1 branding: **Option A** (Peter, 2026-07-28) — recorded in origin §1.
- Is `capturedAt` omission safe on the online path? **Yes** — `fw-checkin.ts` schema has it `.optional()`, core accepts `null`, and `clampFwCapturedAt`'s doc comment names omission as the intended online shape.
- Which navigation fix shape? **Server-side redirect** — vendored Next 16 docs confirm origin's preference order.
- S4 test gap: existing suite already rejects at the exact expiry instant; the missing case is the **live side** (`expiresAt − 1ms` still live). Grace is applied at mint time (already inside `expiresAt`) and covered by the mint-verdict tests — there is no verdict-side grace case to add.
- 404 authoritativeness (review finding, feasibility + adversarial, corroborated): a single 404 is NOT proof of revocation — the server maps transient DB read errors to the same bare 404 and middleboxes exist. **Resolved (Peter, 2026-07-28): `dead_link` requires two consecutive 404 polls; acceptance relaxed to ≤8s.**
- Online `capturedAt` omission vs the same-`atMs` tie-break (`fw-board-rules.ts:513-518`, review finding, security + adversarial): omission makes `capturedAtMs === atMs` for all online events, so a same-millisecond pair falls to the id fallback the code's own comment flags. **Resolved (Peter, 2026-07-28): accepted** — online events get distinct server receipt times in practice (a same-ms online pair would need a sub-millisecond double-tap round trip), and offline drains keep the device `capturedAt` the tie-breaker exists for. Guarded by a deterministic regression test (Unit 4); revisit with a server-side sequence stamp only if the test or production shows otherwise. Ops surfacing of `captured_at` (`fw-ops-core.ts:1186`) degrades to receipt time for online events — acceptable, it becomes *more* truthful, not less.

### Deferred to Implementation

- S2 verdict: whether `at - captured_at` in `path_fw_events` actually exceeds 60s for the observed 1.2.4 event — knowable only from production data (Supabase Management API playbook per repo convention).
- B7 projector-distance sign-off: the specified treatment (see Unit 3) must be confirmed legible from the back of the room during implementation; if it fails, iterate before merge — do not ship the guess.
- Whether sign-in / invite-claim actions need `revalidatePath` in addition to `redirect`, or whether the 303 navigation alone delivers fresh RSC payload — decide against observed behaviour; the docs suggest `redirect` alone suffices for a *new* route, while the roster path (`quickCreateFwStudent`) definitely needs `revalidatePath` for search freshness.

## Implementation Units

- [x] **Unit 1: RC-1 — server-side navigation + missing `revalidatePath` (B2, B5, S1)** *(done — sign-in/claim `revalidatePath` resolved "not needed": the server-action redirect carries fresh Flight data rendered after the session cookie is set; manual auth-boundary check still queued)*

**Goal:** Mutation-then-navigation happens in one round trip from the Server Action; created students are immediately searchable.

**Requirements:** R1

**Dependencies:** None

**Files:**
- Modify: `app/fp/lib/actions/fw-student.ts` (add `revalidatePath` for `/fp/fw/cohort/[id]` and `/fp/fw/ops/cohort/[id]`; add `redirect` to the student page after success)
- Modify: the sign-in and invite-claim Server Actions (redirect to `/fp/fw` on success)
- Modify: `app/fp/fw/components/FwQuickCreate.tsx`, `app/fp/fw/(auth)/sign-in/FwSignInForm.tsx`, `app/fp/fw/(auth)/invite/[token]/ClaimGuideInviteForm.tsx` (remove the `push`/`refresh` pair; keep pending-state reset in `finally`)
- Test: `app/fp/lib/__tests__/` — extend the relevant core suites

**Approach:**
- This is a restructure, not a one-line placement rule: capture the core result, early-return every `!ok` variant unchanged (including `claimGuideInviteAction`'s partial-success "password set but sign-in hiccuped" path in `fw-guide.ts`, which must stay a typed return, not a redirect), then `revalidatePath` + `redirect` on the success arm. `redirect()` throws `NEXT_REDIRECT`, so it sits outside any try/catch. The success arms of the exported result types become unreachable on the redirect paths — keep the types unchanged (narrowing them is an export reshape the deploy-skew risk row argues against).
- Client components must not swallow the redirect rejection: per the 2026-07-20 solution doc, reset `submitting` in `finally` and let the navigation happen.
- Actions stay thin (gate → zod → authorize → delegate → typed result); no type re-exports.
- FwQuickCreate's comment "Every leg verified — only now is it safe to route into the tree" is preserved: `runFwQuickCreate` still fully verifies before the action redirects.
- Do not touch the refresh-only (`router.refresh()` without push) call sites elsewhere in FW.

**Test scenarios:**
- Happy path: core result for quick-create still returns `studentId` so the action can build the redirect target.
- Integration (manual, per origin acceptance): quick-create lands on `/fp/fw/cohort/<id>/student/<id>` in one render, form unmounts; new student appears in roster search next render; guide sign-in lands on a populated roster with no reload.
- Integration (manual, auth boundary): the first paint after the sign-in / invite-claim redirect reflects the new session's identity and authorization — no stale prior-session content flash. Only if this holds may the deferred "is `revalidatePath` needed alongside `redirect`" question be answered "no".
- Error path: a failed action (zod refusal, authorization refusal) returns the typed error and the form re-enables (no stuck `submitting`).

**Verification:** Origin acceptance for 2.5.8, 3.10.2, 2.4.2 against a live cohort; `npm test` green.

- [x] **Unit 2: RC-2 — board dead-link terminal state (B4, B6)** *(done — reducer carries `{ phase, consecutive404 }`; two documented judgment calls: an answered 503 resets the 404 run, a network throw doesn't break one)*

**Goal:** A revoked/expired board link reaches a terminal "dead link" panel with a recovery step and stops polling.

**Requirements:** R2

**Dependencies:** None

**Files:**
- Modify: `app/fp/lib/fw-board-rules.ts` (new pure connection-state function + dead-link copy constant)
- Modify: `app/fp/fw/components/board/FwBoard.tsx` (render the state machine's output; stop the interval on `dead_link`; keep the frame-clearing on 404)
- Test: `app/fp/lib/__tests__/fw-board-rules.test.ts`

**Approach:**
- Reducer in the house style — `fwBoardConnectionState(prev, pollOutcome)` with a named-field event object (e.g. `{ httpStatus, fetchThrew, hasFrame, lastOkAgeMs }`), string-literal state result, doc comment explaining the why. The reducer owns terminal stickiness: once `dead_link`, every later event maps to `dead_link`.
- Tri-state disposition (per the 2026-07-24 solution doc): **two consecutive** 404 responses → `dead_link` (terminal, clear frame, stop interval); a single 404 still clears the frame immediately (security: names come off the projector) but stays non-terminal pending the confirming poll; thrown fetch / network error → non-terminal stale states; 503 → non-terminal; 200 → live and resets the 404 count.
- Panel copy (locked): "This board link is no longer active. Ask The 120 staff for a fresh link." — one generic message, no revoked/expired/never-existed distinction (anti-enumeration, `fw-board-rules.ts:212-216`). The terminal panel replaces any interim "catching up / connecting" message immediately on the deciding 404 — no visible intermediate state.
- Recovery mechanic (explicit): there is no self-recovery on the same tab — the token is dead. Staff mints a fresh link from ops; the operator loads the new URL. The panel copy points at exactly that step.
- `BoardHeader`'s inline `stale`/`hasData` ternary is subsumed by the machine's output so the header and the panel can never disagree.
- Component change is renderer-only: no decision branches added to the `.tsx`.

**Test scenarios:**
- Happy path: 200 + frame → `live`.
- Edge: 200 previously, then network throw with recent `lastOkAgeMs` → `catching_up`; no frame yet and no response → `connecting`.
- Happy/terminal: two consecutive 404s → `dead_link` regardless of prior frame state; a single 404 is non-terminal (frame cleared, still polling).
- Edge: 404 followed by 200 resets the consecutive count (a later lone 404 is again non-terminal).
- Edge: network throw when a frame exists must NOT produce `dead_link` (tri-state guarantee).
- Edge: stickiness — after `dead_link`, any later event (200, throw, 503) still yields `dead_link`.
- Error path: 503 → non-terminal (the feed route emits 503 on upstream failure).
- Mutation check: assert `dead_link` copy names a recovery actor ("staff") — structurally, not exact-spelling.

**Verification:** Origin acceptance for 3.5.3 / 3.18.2, amended by this plan's two-consecutive-404 decision: terminal panel within ≤8s of revocation (two poll intervals), polling stops (network tab), ops `Revoked` state unregressed.

- [x] **Unit 3: B7 — board cell non-colour state channel** *(done — projector-distance sign-off still queued as manual QA)*

**Goal:** Verified / not-yet / untouched cells are distinguishable without colour and carry a programmatic name.

**Requirements:** R3

**Dependencies:** Unit 2 (both edit `fw-board-rules.ts` and `FwBoard.tsx` — land Unit 2 first)

**Files:**
- Modify: `app/fp/lib/fw-board-rules.ts` (pure state→{className, label} mapping, complete literals)
- Modify: `app/fp/fw/components/board/FwBoard.tsx` (`cellClass` call sites ~320/~383 consume the mapping; `title`/`aria-label` gains "taskId — state")
- Test: `app/fp/lib/__tests__/fw-board-rules.test.ts`

**Approach:**
- Complete-literal class strings per the Tailwind v4 constraint (comment at `FwBoard.tsx:317-319`; CLASS_TABLE pattern from `skin-tokens.ts`). Never concatenate.
- Non-colour channel at 10px (specified): **verified = solid fill + solid border** (verified colour); **not-yet = empty fill + 2px dashed border** (not-yet colour); **untouched = empty fill + hairline neutral border** (`border-hq-border`). Existing tokens: `--color-verified`, `--color-not-yet`, `--color-hq-sunken` in `app/globals.css`. Acceptance gate: the three states must be distinguishable from the back of the room at projector distance; if the check fails, iterate the treatment before merge — do not ship the guess.
- Programmatic name mechanism: `aria-label` on a bare `<span>` is ignored by most assistive-technology mappings — extend the existing `title` to "taskId — state" AND add `role="img"` + `aria-label` (or a visually-hidden text child).
- Label computation stays out of the `GridRow` memo comparator's `sameCells` cost path (`FwBoard.tsx:404-412`).

**Test scenarios:**
- Happy path: the three states produce three **distinct** complete-literal class strings and three distinct labels.
- Edge: labels contain both the task id and a human-readable state word.
- Mutation check: no returned class string is built by interpolation (assert on the exported table shape).

**Verification:** Origin acceptance for 3.18.5 plus a projector-distance visual check; `npm test` green.

- [x] **Unit 4: S2 — First Dollar celebration: diagnose, then fix (2.7.4)**

> **Diagnosis outcome (2026-07-28, production `path_task_events`): clock-skew hypothesis REFUTED.** All 28 events with `captured_at` in the last 30 days have `at − captured_at` ≤ 0.151s (avg 0.053s) — nothing near the 60s freshness window. The 1.2.4 history on 2026-07-27 (checkmark 18:37:59 → undo 18:38:34 → re-checkmark 18:39:26) matches the baseline-seeding/rung-key explanation instead: the celebration key was already rung (or seeded on board load) from the first checkmark, so the re-verification never re-rings — replay suppression working as designed. Per this unit's decision gate: **no code change made**; reported to Peter. If a first-genuine-verification suppression is ever observed with the board open beforehand, re-diagnose live.

**Goal:** Confirm or refute the clock-skew hypothesis from production data; if confirmed, eliminate the skew window for live taps.

**Requirements:** R5

**Dependencies:** None

**Execution note:** Diagnose-first — do not change any code until step 1 confirms the hypothesis.

**Files:**
- Modify (if confirmed): `app/fp/fw/components/FwTaskView.tsx` (~:286, ~:331 — stop sending `capturedAt` on the online path)
- Modify: the check-in action/logging path to log `capturedAtClamped` from `runFwCheckIn` (`fw-checkin-core.ts:459`) — currently returned but never logged
- Test: `app/fp/lib/__tests__/fw-checkin-core.test.ts` (extend), `app/fp/lib/__tests__/fw-board-rules.test.ts` (freshness gate cases if not already covered)

**Approach:**
- Diagnosis branches: query `path_fw_events` for the recent 1.2.4 checkmark, compute `at - captured_at` (Supabase Management API playbook, `docs/solutions/`). Gap > 60s → skew confirmed → apply the omission fix. Gap ≤ 60s → check the competing explanation before concluding anything: the baseline-seeding rule (`FwBoard.tsx:172-177`) adopts every celebration present in the first poll after a page load as already-rung, so a board tab (re)loaded between check-in and observation suppresses the bell with a perfectly fresh timestamp. Still inconclusive → report findings to Peter for a scope decision; do not guess at a fix.
- Consciously out of scope: no fallback celebration UX (toast/indicator for a suppressed overlay) is added in this pass — if suppression recurs post-fix it gets live re-diagnosis, now aided by the `capturedAtClamped` logging.
- Fix is omission: schema (`fw-checkin.ts:56`) is `.optional()`, core accepts `null`, and `clampFwCapturedAt`'s doc (:633-635) already names omission as the online shape. Single-clock freshness per the 2026-07-22 clock-skew solution doc.
- Do NOT touch the offline path (`fw-sync-client.ts:131`, `fw-sync.ts:48` — required by design) and do NOT widen `FW_FIRST_DOLLAR_FRESHNESS_MS`.

**Test scenarios:**
- Happy path: check-in with `capturedAt` absent → capture time equals receipt time, unclamped (existing behaviour, now exercised by the online path).
- Edge: freshness gate passes for a receipt-time capture (gap = 0), still rejects a stale replay (> 60s).
- Error path: offline replay with required `capturedAt` unchanged (regression guard on the sync path).
- Edge (tie-break regression): two online events on the same `(student, task)` 1ms apart in `atMs` (checkmark then undo, no `capturedAt`) → current state follows `atMs` order; document in the test that a same-`atMs` online pair reaches the id fallback (accepted residual, see Open Questions).

**Verification:** Diagnosis outcome recorded; after fix, a live verified 1.2.4 tap produces the on-screen celebration; `capturedAtClamped` anomalies now visible in logs.

- [x] **Unit 5: S3 — remove duplicate "Founders Weekend" header (3.18.10)** *(done, mutation-tested)*

**Goal:** The cohort sticky header carries only what the StaffBar cannot: cohort name + switcher.

**Requirements:** R6

**Dependencies:** Before Unit 6 (removes a string D1 would otherwise rebrand).

**Files:**
- Modify: `app/fp/fw/(app)/cohort/[cohortId]/layout.tsx` (~:82 — drop the application label; keep `· Staff` context if still meaningful, per the layout doc-comment's intent)
- Test: `app/lib/staff-bar/__tests__/bar-wiring.test.ts` (new assertion: cohort layout source carries no application-label duplication)

**Approach:**
- Exact target (per origin intent — the header carries only what the bar cannot): remove the application-label element from both branches; the sticky header keeps the cohort name and switcher only. The `· Staff` marker goes with it — a dangling "· Staff" with no preceding label reads broken, and staff identity is the StaffBar's job.
- Test: follow the existing bar-wiring source-scan style — comment-stripped, `import.meta.url`-anchored, structural regex, mutation-tested.

**Test scenarios:**
- Happy path: bar-wiring scan asserts the cohort layout renders no "Founders Weekend" application label beneath the bar.
- Mutation check: temporarily re-adding the label makes the test fail (verify once during development).

**Verification:** One application label visible on the guide cohort surface; check 3.18.10 acceptance.

- [x] **Unit 6: D1 Option A — First Profit brand suffix on guide surfaces (B1, B3)** *(done, drift guard mutation-tested both ways)*

**Goal:** All guide-facing titles and the invite email carry First Profit branding; a drift guard prevents recurrence.

**Requirements:** R4

**Dependencies:** Unit 5 (logical ordering, not a technical blocker — the dedup removes a header the brand sweep would otherwise waste work rebranding).

**Files:**
- Modify: `app/fp/lib/fw-nav-rules.ts` (add `FW_BRAND_SUFFIX` constant)
- Modify: the 10 `metadata.title` sites in origin §1 table (all verified at cited lines). The on-screen `FwBoard.tsx` header (~:245, :248) is deliberately NOT modified — see Approach.
- Modify: `app/fp/lib/fw-guide-invite-email.ts` (subject :40, text :42, html :51)
- Test: `app/fp/lib/__tests__/fw-nav-rules.test.ts` (constant), new source-scan drift guard in `app/fp/lib/__tests__/` (every `/fp/fw` `metadata.title` ends with the suffix)

**Approach:**
- Exact target strings (normalized pattern `<thing> · Founders Weekend — First Profit`; bare titles → `Founders Weekend — First Profit`):

| File | Before | After |
|---|---|---|
| `app/fp/fw/(auth)/sign-in/page.tsx` | Guide sign-in — Founders Weekend | Guide sign-in · Founders Weekend — First Profit |
| `app/fp/fw/(auth)/invite/[token]/page.tsx` | Guide access — Founders Weekend | Guide access · Founders Weekend — First Profit |
| `app/fp/fw/(app)/page.tsx` | Founders Weekend | Founders Weekend — First Profit |
| `app/fp/fw/(app)/cohort/[cohortId]/page.tsx` | Roster · Founders Weekend | Roster · Founders Weekend — First Profit |
| `app/fp/fw/(app)/cohort/[cohortId]/student/[studentId]/page.tsx` | Student · Founders Weekend | Student · Founders Weekend — First Profit |
| `app/fp/fw/(app)/cohort/[cohortId]/student/[studentId]/task/[taskId]/page.tsx` | Task · Founders Weekend | Task · Founders Weekend — First Profit |
| `app/fp/fw/(app)/ops/page.tsx` | Founders Weekend — staff ops | Staff ops · Founders Weekend — First Profit |
| `app/fp/fw/(app)/ops/cohort/[cohortId]/page.tsx` | Founders Weekend — weekend ops | Weekend ops · Founders Weekend — First Profit |
| `app/fp/fw/(app)/ops/cohort/[cohortId]/import/page.tsx` | Founders Weekend — import roster | Import roster · Founders Weekend — First Profit |
| `app/fp/fw/board/[token]/page.tsx` | Founders Weekend | Founders Weekend — First Profit |

- Email subject becomes "Your Founders Weekend guide access — First Profit"; body copy gains the same brand linkage; the `/fp/fw/invite/…` setup URL is untouched.
- The projector-visible `FwBoard.tsx` on-screen header (~:245, :248) stays "Founders Weekend" **unsuffixed** (Peter, 2026-07-28) — the brand lives in the tab title via `board/[token]/page.tsx` metadata; on-screen hierarchy at projector distance stays clean.
- Email module stays a plain module (scripts import it); action files untouched.
- Drift guard: glob the `app/fp/fw/**/page.tsx` files relative to `import.meta.url`, strip comments, and require every globbed page to contain exactly one recognised title construct (static `metadata.title` or `generateMetadata`) carrying the suffix — a page with neither construct FAILS the scan (no vacuous pass). Count-bound any allowlist; do not pin exact punctuation beyond the suffix constant itself (em-dash lesson, 2026-07-14 solution doc).
- Leave `path-*` internal identifiers alone.

**Test scenarios:**
- Happy path: drift-guard scan passes over all `/fp/fw` pages and fails if any title lacks the suffix (mutation-test once).
- Happy path: email subject/body contain the First Profit brand while retaining the correct `/fp/fw/invite/…` URL.
- Edge: scan is not satisfied by a comment containing the suffix (comment-stripping verified).

**Verification:** Checks 1.1.4 and 3.1.6 acceptance; drift guard in the `npm test` run listing.

- [x] **Unit 7: S4 + S5/S6/S7 closure — boundary test and close-from-source items** *(done — S4 live-side case added; S5 headers, S6 attestation layers, and the S7 manifest half stand verified from source per the origin doc, no code; S7 device-half stays queued as physical QA)*

**Goal:** Close the remaining should-fix items with a small test addition and documented no-code verdicts.

**Requirements:** R7, R8

**Dependencies:** None

**Files:**
- Test: `app/fp/lib/__tests__/fw-board-rules.test.ts` (S4: live-side boundary — `now = expiresAt − 1ms` → live. Grace is applied at mint time and is already baked into `expiresAt`; the mint-verdict suite covers it — do NOT test `expiresAt + grace`, that double-counts. The expiry-instant rejection already exists at :171-175)
- Optional test: board feed route headers on 200/404/503 paths (S5) — only if cheap without jsdom; otherwise close from source
- No code: S5 (headers verified on all three response paths + `next.config.ts:70-76`), S6 (four-layer attestation verified), S7 manifest-half (`public/path.webmanifest` verified)

**Test scenarios:**
- Edge (S4): `expiresAt − 1ms` → live; existing expiry-instant case untouched.

**Verification:** S4 case in the run listing; S5/S6/S7 marked verified in the test report with source citations; S7 device-half queued as QA, not code.

## System-Wide Impact

- **Interaction graph:** Unit 1 changes Server Action control flow (`redirect` throws) — every caller of the three actions must tolerate rejection; verified only the three listed forms call them. Units 2–3 both touch `fw-board-rules.ts` + `FwBoard.tsx` — sequence or coordinate.
- **Error propagation:** `NEXT_REDIRECT` must not be caught by client `catch` blocks that map rejections to error UI; use `finally` for state reset (2026-07-20 solution doc).
- **State lifecycle risks:** long-lived projector tabs and kiosk PWAs hold old bundles — no export renames/removals (2026-07-27 deploy-skew doc). Unit 1 additionally reshapes the success *return contract*: the action now redirects instead of resolving with `{ ok, studentId }`, so a stale bundle's `if (res.ok)` reads a property off `undefined` and paints its generic error toast even though the mutation succeeded. Accepted knowingly: exposure is near-zero (0 active FW cohorts in prod); deploy while no event is live; a stale tab recovers with one reload.
- **API surface parity:** the board feed route's single-404 contract is unchanged; RC-2 consumes it as-is.
- **Integration coverage:** the push→land-in-one-render behaviour is only provable manually (no jsdom) — origin §8 requires manual re-verification of 2.5.8, 3.10.2, 3.5.3, 3.18.2, 3.18.5, 2.4.2 against a live cohort.
- **Unchanged invariants:** attestation layers (S6), offline sync's required `capturedAt`, anti-enumeration collapse, refresh-only router call sites.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `redirect()` inside try/catch silently converted to an error result | Place `redirect` after the try/catch per `redirect.md`; test error paths still return typed results |
| Stale kiosk/projector bundles after deploy (old action ids, plus Unit 1's success-arm return-contract reshape) | Extend actions in place; no export renames/removals; accept the success-arm reshape knowingly — deploy while no FW event is live (currently 0 active cohorts); stale tabs recover with one reload |
| RC-2 treats a transient 404 (DB blip mapped to 404 by `fw-board-loader.ts:87`, or a middlebox 404) as terminal, killing a healthy board | Two consecutive 404 polls required for `dead_link`; thrown fetches never terminal; a 200 resets the count |
| B7 classes silently dropped by Tailwind scanner | Complete literals only; test asserts table shape; visual check |
| Drift-guard scan passes vacuously (wrong glob, comments, cwd) | `import.meta.url` anchoring, comment stripping, mutation-test each scan once |
| New tests not picked up by CI | They live in already-allowlisted `app/fp/lib/__tests__/`; confirm presence in run listing |
| S2 hypothesis wrong | Diagnose-first gate; no code change until `path_fw_events` confirms skew |

## Documentation / Operational Notes

- Repo lint is pre-existing red on main (~46 errors in gauntlet/dashboard/components) — lint-check only touched files.
- S2 diagnosis uses the Supabase Management API playbook (no DB password; CLI token in Windows Credential Manager).
- Per origin §8: anything learned that generalises gets a `docs/solutions/` note in the matching category (the RC-1 push/refresh race and the RC-2 terminal-state machine are both likely candidates).
- Non-code carried items (explicitly out of this plan): §5 browser-profile rig change, S7 iOS device check, S8 heap-profiling run.

## Sources & References

- **Origin document:** `docs/FP-BUGS-2026-07-28.md` (work order incl. D1 decision record)
- Vendored framework docs: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/` (`use-router.md`, `redirect.md`, `revalidatePath.md`)
- Related code: `app/fp/lib/fw-board-rules.ts`, `app/fp/lib/actions/fw-student.ts`, `app/fp/fw/components/board/FwBoard.tsx`, `app/lib/staff-bar/__tests__/bar-wiring.test.ts`, `app/fp/lib/skin-tokens.ts`
- Institutional learnings: see Context & Research above (12 `docs/solutions/` documents)
