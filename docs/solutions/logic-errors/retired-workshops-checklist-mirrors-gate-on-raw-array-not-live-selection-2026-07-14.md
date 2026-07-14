---
title: "Retired catalog entries read as 100% complete — checklist mirrors gated on the raw stored array while the wizard rendered the sanitized view; a pre-sanitized test fixture masked it"
date: 2026-07-14
category: logic-errors
module: dossier-workshops-checklist
problem_type: logic_error
component: service_object
symptoms:
  - "A legacy Scholars child whose only stored workshopIds are retired K–2 tombstones reads 100% complete everywhere (dashboard meter, CRM queue %, nurture stall-nudge) — all three mirrors gated 'A workshop of interest' on raw workshopIds.length >= 1"
  - "The Workshops step simultaneously renders 'Selected · 0 of 3' for the same child — a visible self-contradiction between the wizard and the completeness meter"
  - "Submit is enabled with an effectively empty required workshop selection, because Submit gating reads the same raw-length checklist"
  - "The test suite stayed green: the test named 'an all-retired selection empties — and the checklist re-flags workshops' fed the sanitizer's own (empty) output into checklist() — a tautology that never exercised the raw production path"
root_cause: logic_error
resolution_type: code_fix
severity: high
related_components:
  - development_workflow
  - testing_framework
tags:
  - lockstep-mirrors
  - completeness-checklist
  - retired-catalog-entries
  - tombstone-pattern
  - sanitized-view-vs-stored-state
  - test-tautology
  - dossier-wizard
  - workshops
---

# Retired catalog entries read as 100% complete — checklist mirrors gated on the raw stored array while the wizard rendered the sanitized view; a pre-sanitized test fixture masked it

## Problem

When 5 K–2 workshops were retired from the selectable `WORKSHOPS` catalog into a `RETIRED_WORKSHOPS` tombstone array (PR #5, feat/dossier-intake-approval-gate), a new `sanitizeWorkshopSelection()` (drop non-live ids, cap 3) was threaded only into the wizard's render/write path. The three lockstep completeness mirrors kept gating the Scholars "A workshop of interest" item on the **raw** stored array length — so a legacy child holding only retired picks read 100% complete (Submit enabled, CRM shows complete, nudge engine agrees) while the Workshops step itself showed "Selected · 0 of 3". Four independent code reviewers converged on this before it shipped (review artifact, finding 1).

## Symptoms

- Dashboard completeness meter: 100%; Workshops step sticky bar: "Selected · 0 of 3" — same child, same session.
- Submit button enabled despite zero live workshop selections; the family could submit an effectively empty required selection.
- CRM dossier queue and the nurture stall-nudge engine agreed with the wrong 100% (consistent across mirrors — consistently wrong).
- Test suite green: the coverage for exactly this case was a tautology (see below).

## What Didn't Work

**(a) Threading sanitize into the render path and assuming the checklist would "re-flag".** The plan literally claimed *"sanitize is silent, checklist re-flags if they fall below 1"* — but sanitize was render-only:

```ts
// app/dashboard/wizard/StepWorkshops.tsx — the wizard's VIEW is sanitized…
const selected = editable
  ? sanitizeWorkshopSelection(child.workshopIds)
  : child.workshopIds;
```

…while the stored `child.workshopIds` stays raw until the parent's next explicit edit persists the sanitized array. The mirrors read the raw field, so "re-flagging" never fired on load or on completeness computation — only after an edit that would itself fix the state.

**(b) A pre-sanitized test fixture — coverage that tested the sanitizer, not the consumer.**

```ts
// BEFORE (tautological — never touched the production path)
it("an all-retired selection empties — and the checklist re-flags workshops for Scholars", () => {
  const sanitized = sanitizeWorkshopSelection(["the-peace-table", "toy-inventors"]);
  expect(sanitized).toEqual([]);
  const c = child({ groupSlug: "scholars", workshopIds: sanitized }); // already [] !
  const item = checklist(c).find((i) => i.label === "A workshop of interest")!;
  expect(item.done).toBe(false); // trivially true — checklist never saw retired ids
});
```

The fixture was the *output* of the sanitizer under test, so `checklist()` was only ever exercised with an empty array — never with the raw retired ids a real legacy row holds.

**(c) The plan's confidently-wrong "verified" claim.** The implementation plan stated: *"The wizard's three-mirror checklist requires **no edits** (verified; workshop rule ≥1 preserved…)"* — true for the ≥1 *count* rule in isolation, false the moment retirement made "which ids count" part of the question. A claim can be verified against the old world and still be wrong in the new one. (An earlier plan draft also asserted submitted dossiers were immutable; plan review caught that against `stepEditable` in `DossierEditor.tsx`, which keeps Group/Workshops editable post-submit until a deposit is paid — so legacy rows reached the new capped UI on submitted dossiers too.)

```ts
const stepEditable = (s: WizardStepId) =>
  !locked || (!depositPaid && (s === "group" || s === "workshops"));
```

## Solution

One shared live-catalog predicate in `app/dashboard/data.ts`, threaded through **all three mirrors in the same commit** (`f6aadb2`), per the codebase's LOCKSTEP MIRRORS rule:

```ts
// app/dashboard/data.ts
/** Shared by all three lockstep completeness mirrors so they can't drift. */
export const hasLiveWorkshopPick = (ids: string[]) =>
  ids.some((id) => WORKSHOPS.some((w) => w.id === id));
```

```diff
 // Mirror 1 — app/dashboard/data.ts checklist()
-    items.push({ label: "A workshop of interest", done: c.workshopIds.length >= 1 });
+    items.push({ label: "A workshop of interest", done: hasLiveWorkshopPick(c.workshopIds) });

 // Mirror 2 — app/crm/lib/reviews-rules.ts dossierChecklist()
-    items.push({ label: "A workshop of interest", done: f.workshopIds.length >= 1 });
+    items.push({ label: "A workshop of interest", done: hasLiveWorkshopPick(f.workshopIds) });

 // Mirror 3 — app/lib/nurture/rules.ts dossierCompleteness()
-    ...(groupSlug === "scholars" ? [(c.workshop_ids ?? []).length >= 1] : []),
+    ...(groupSlug === "scholars" ? [hasLiveWorkshopPick(c.workshop_ids ?? [])] : []),
```

Companion fix: `StepGroup.tsx`'s switch-away-from-Scholars confirm dialog also moved from the raw length to `sanitizeWorkshopSelection(...).length` — that dialog is about what the parent *sees* selected. `DossierPreview` and the CRM detail pane were deliberately left on the raw record (via `workshopById`'s tombstone resolution): a reviewer needs to see what a family actually picked, including retired picks.

Corrected test — fixture built from the **raw stored shape**:

```ts
it("the checklist re-flags workshops for a RAW retired-only selection (unsanitized store state)", () => {
  const c = child({ groupSlug: "scholars", workshopIds: ["the-peace-table", "toy-inventors"] });
  const item = checklist(c).find((i) => i.label === "A workshop of interest")!;
  expect(item.done).toBe(false);
});

it("hasLiveWorkshopPick: one live id among retired ids satisfies the item", () => {
  const live = WORKSHOPS[0].id;
  expect(hasLiveWorkshopPick(["the-peace-table", live])).toBe(true);
  expect(hasLiveWorkshopPick(["the-peace-table"])).toBe(false);
});
```

## Why This Works

Every derivation of "is the workshops requirement satisfied" — parent checklist, CRM queue %, nurture engine, and (via the sanitized count) the group-switch confirm — now shares one predicate anchored to the same underlying truth (`WORKSHOPS` membership) that the render layer filters by. Render (sanitized view) and completeness (live-pick predicate) are different concerns, but they can no longer disagree about what counts. And because all three mirrors changed in one commit, there was no window with one patched mirror and two stale ones.

## Prevention

- **Retiring or filtering catalog entries splits the world into two domains: stored state and rendered state.** The moment a sanitized view exists anywhere, grep *every* reader of the stored field — checklists, counters, confirm dialogs, previews, nudge engines — and decide raw-vs-filtered explicitly per consumer. A filter introduced in one place does not propagate.
- **Legacy-data tests must build fixtures from the RAW stored shape, never from the output of the sanitizer under test.** If a fixture is `sanitizeX(rawInput)`, the test covers `sanitizeX`, not its consumers — a tautology that reads as coverage.
- **Treat plan claims like "X re-flags automatically" or "Y is immutable once submitted" as assertions to verify against code**, not facts to design around. Find the actual gate (`stepEditable` here) and confirm it before relying on it.
- **When files are documented as lockstep mirrors, change and test all of them in one commit.** A fix applied to one mirror reintroduces this exact bug class in the others.
- Meta-pattern shared with the sibling doc below: **verify against the real production data shape, not an idealized/pre-cleaned one** — there it was replaying the app's actual full-row write payload; here it's feeding the checklist the actual raw stored ids.

## Related Issues

- `docs/solutions/database-issues/stale-status-echo-full-row-upsert-vs-trigger-guard-coerce-not-raise-2026-07-14.md` — sibling incident from the same dossier feature family (same day, same review lineage). Different mechanics (DB trigger write-path vs. completeness derivation), same root-cause class: divergent code paths making different assumptions about the same stored record, with a verification pitfall (idealized test shape) masking each.
- Review artifact that surfaced this: `.context/compound-engineering/ce-review/2026-07-14-dossier-intake-approval-gate/summary.md` (finding 1, 4-reviewer convergence).
- GitHub issues: none related (searched `workshop OR checklist OR completeness`, zero results).
