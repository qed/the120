---
module: funnel
date: "2026-07-28"
problem_type: logic_error
component: frontend_stimulus
severity: high
symptoms:
  - "After switching doors, the templates advance button is enabled with no card visibly selected"
  - "One tap seeds the new group's quiz with the OLD group's template answers"
  - "Deep link to ?step=quiz shows stale answers under the new group's questions, and the blocker gate passes them"
root_cause: logic_error
resolution_type: code_fix
tags:
  - client-state
  - stale-state
  - scoped-state
  - wizard
  - url-state
  - invalidation
related_components:
  - service_object
---

# Client draft state scoped by a server fact must reset when the fact changes

## Problem

In the mini-app wizard (U9, `MiniAppShell.tsx`), the template choice and
seeded quiz answers are client state whose MEANING is scoped by a server fact:
the child's confirmed door (group). Confirming a *different* door updated the
fact but left the downstream draft state alive. A child who confirmed makers,
picked a template, went Back, and confirmed scholars carried
`templateId: "makers-commission"` and makers-copy answers into the scholars
flow. Both reviewers rated it the unit's top finding.

## Symptoms

- On the new group's templates screen, no card matched the stale id, so
  nothing rendered selected — but `disabled={!templateId}` was false, so
  "This one →" was armed by invisible state. One tap called
  `seedAnswers("makers-commission", …)` (a GLOBAL lookup, not scoped to the
  confirmed group) and seeded the scholars quiz with makers answers.
- Browser Forward straight to `?step=quiz` showed the old answers under the
  new questions; `quizBlockers` passed them (any non-empty text passes), so a
  wrong-group project could reach compose without a keystroke.

## What Didn't Work

Relying on the render layer to hide the staleness. The stale id was invisible
in the UI (no card highlighted), which made the bug *worse*, not better: the
state still fed `disabled` and the advance handler. Invisible ≠ inert.

## Solution

Two independent guards — reset at the fact-change site, and re-validate at
the use site:

```tsx
// 1. In confirm(): a DIFFERENT door invalidates everything downstream of it.
if (result.slug !== confirmedSlug) {
  setTemplateId(null);
  setOwnIdea("");
  setAnswers({});
  setQuizNotice(null);
  setSeededFrom(null);
}

// 2. At the use site: an id is only valid if it belongs to the CONFIRMED
// group. Stale ids read as unselected.
const validTemplateId =
  templateId === OWN_IDEA.id ||
  templatesForGroup(confirmedSlug).some((t) => t.id === templateId)
    ? templateId
    : null;
```

Everything that previously read `templateId` for a decision (`disabled`, the
advance handler, the seed call) reads `validTemplateId`.

## Why This Works

The reset handles the normal path; the use-site validation handles every path
the reset can't see (future call sites, refactors that move the reset,
history/URL navigation orders nobody anticipated). This is the state-shaped
sibling of the raw-vs-resolved rule (see
`raw-vs-resolved-the-caller-passed-the-store-value-where-the-derived-answer-was-meant-2026-07-28.md`):
once a piece of state is scoped by another fact, the raw value's only
legitimate consumer is the resolver that checks the scope.

## Prevention

- When introducing client state, name the fact that scopes it. If that fact
  can change while the component lives (server confirm, prop update, URL
  navigation), write the invalidation in the same commit as the state.
- Guard both ends: reset where the scoping fact changes, AND derive a
  validated view at the point of use. Either alone has a hole.
- In URL-state wizards, walk the adversarial navigation orders explicitly:
  Back past a committed step, change the commitment, Forward again. Every
  step's client state must be either still-valid or visibly re-requested.
