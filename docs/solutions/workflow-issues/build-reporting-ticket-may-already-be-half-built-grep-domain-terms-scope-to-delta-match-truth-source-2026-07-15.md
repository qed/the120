---
title: "A 'build X reporting' ticket may already be half-built — grep the domain terms first, scope to the delta, and reuse the existing tally's truth-source"
date: 2026-07-15
category: docs/solutions/workflow-issues
module: crm
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - A ticket is phrased as "build/add X reporting, dashboard, tally, view, or report"
  - Working in a CRM/analytics surface where multiple views show overlapping metrics
  - A ticket implies greenfield but the domain may already have a partial implementation
related_components:
  - brief_system
  - documentation
tags: [crm, scoping, code-reuse, ticket-scoping, grep-first, truth-source, reporting]
---

# A "build X reporting" ticket may already be half-built — grep first, scope to the delta

## Context

The GTM-4 ticket read as greenfield: *"Ambassador reporting — signups per
referral code + a registry of issued codes."* The instinct is to build a
dashboard from scratch. Grepping the domain terms first
(`referral|ambassador|attribution|heard about`) surfaced an already-shipped
`SourceTally` component fed by `computeSourceTally` that renders **leads +
deposits per AMB-\* code** on the main CRM dashboard.

So the ticket was not "build a tally." The real gap was only two things the
existing tally couldn't do: (a) show a code with **zero signups yet** (the W2
just-issued state), and (b) name **who owns** a code. That reframes the work
from *build a dashboard* to *add a registry + a page that surfaces zero-signup
codes* — reusing the existing computation instead of writing a second one.

## Guidance

For any ticket phrased "build / add **X reporting | dashboard | tally | view |
report**," grep the feature's domain terms across `components/` and `lib/`
**before** designing. Finding a partial implementation changes three things:

1. **Scope** — "build" becomes "extend." Often the delta is a fraction of the
   ticket as written.
2. **Design** — the new view must compute from the **same truth-source** as the
   existing one, or the two will disagree. In GTM-4, `/crm/ambassadors` maps paid
   deposits parent→family **exactly** like `computeSourceTally`, so the new page
   and the dashboard tally can never show different numbers for the same code.
3. **Estimate** — a "new dashboard" ticket that is really a registry table + one
   page is hours, not days.

Say the reframing out loud (in the PR / roadmap) so the PM sees the ticket was
already partly delivered — GTM-4's roadmap entry notes the registry
"supersedes the lightweight registry / SQL snippet the ticket originally scoped."

## Why This Matters

- Building greenfield when a tally already exists creates **two code paths
  computing the same number from different sources**. They drift, staff see
  conflicting figures, and the CRM's "every number derives from truth, never
  hand-entered" guarantee quietly breaks — the most expensive kind of bug in a
  tool people make decisions from.
- The wasted-effort cost is obvious; the trust cost is worse and shows up later.
- Reusing the existing computation also means the new view inherits its already-
  reasoned edge cases (refund netting, parent→family mapping, AMB-\* matching)
  for free.

## When to Apply

- Any ticket that reads as "build/add reporting, a dashboard, a tally, a metric,
  or a view."
- Especially on analytics/CRM surfaces where several screens show overlapping
  numbers and a "new" screen likely re-derives an existing metric.
- Before writing a plan or estimate — the grep is 30 seconds and can halve scope.

## Examples

The 30-second grep that reframed the ticket:

```
$ rg -il 'referral|ambassador|attribution|hear about us' app/crm
app/crm/components/dashboard/SourceTally.tsx      # already: leads+deposits per AMB code
app/crm/lib/gtm.ts                                # already: computeSourceTally()
...
# → ticket is "extend", not "build". Real delta: registry + zero-signup rows.
```

Reuse the existing truth-source so the two views can't disagree:

```ts
// app/crm/(app)/ambassadors/page.tsx — same paid-deposit → family mapping
// that computeSourceTally uses on the dashboard, so numbers can never diverge.
const familyByParent = new Map(
  families.filter((f) => f.parent_id).map((f) => [f.parent_id, f.id])
);
const depositFamilyIds = deposits
  .filter((d) => d.status === "paid")
  .map((d) => familyByParent.get(d.parent_id))
  .filter(Boolean);
```

## Related

- `docs/solutions/best-practices/crm-audit-action-allowlist-db-check-constraint-drifts-from-ts-enum-2026-07-15.md`
  — the other learning from the same GTM-4 build (audit-action CHECK-constraint drift).
- `docs/solutions/best-practices/atomic-claim-then-send-db-guarded-stamp-column-dedupes-best-effort-email-2026-07-14.md`
  — same CRM "derive from truth, never hand-enter" principle in the nurture path.
