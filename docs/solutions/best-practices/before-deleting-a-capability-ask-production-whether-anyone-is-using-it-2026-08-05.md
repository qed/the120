---
module: fp-v3-onboarding
tags: [retirement, deletion, production-data, review-triage, evidence, blast-radius]
problem_type: best_practice
component: service_object
applies_when:
  - "A unit deletes a user-facing capability, route, or surface"
  - "A review argues from code about whether a deletion strands real users"
  - "Triaging findings that all sound equally plausible on paper"
---

# Before deleting a capability, ask PRODUCTION whether anyone is using it

## Context

A unit deleted ~16,800 lines of First Profit UI from the marketing/signup app.
Review produced two findings that read almost identically on paper — each said "a
deleted surface carried a real capability, and real families may be mid-flight":

1. `/fp/family` carried the parent's self-serve **unpublish** control for their
   child's PUBLIC page, and a sent email promised *"You can take the page offline
   any time from your family dashboard."*
2. `/fp/invite/[token]` carried **co-parent invite acceptance**, with a 7-day TTL,
   now an unconditional redirect that never reads the token — so any invite sent
   in the last week dies silently with no error and no retry.

Both were correctly reasoned from the code. Both cited real deleted modules. From
the diff alone there was no way to rank them, and the honest response to each in
isolation is "that sounds bad, we should rebuild it."

Two single-row queries against the production database settled both, in
**opposite directions**:

```sql
select count(*) filter (where published) from public.fp_public_sites;
-- 1  ->  a real child's page is live RIGHT NOW. The regression is real, and it
--        is a child-safety control. Escalate.

select count(*) from public.path_parent_invites;
-- 0  ->  the feature was never used by anyone, ever. No family is stranded.
--        Not a rebuild; just an unfinished retirement to tidy up.
```

The finding that *sounded* more urgent (silent data loss, a ticking 7-day window)
was the theoretical one. The finding that sounded like a routine capability
regression was the one affecting a live child's public page.

## Guidance

**When a review says "this deletion may strand real users", the next action is a
query, not a debate.** Code review can only establish that a capability *could*
be used. Production establishes whether it *is*.

- **Ask the question the finding implies, in one query.** "How many rows exist
  where this feature was actually exercised?" Usually a `count(*)`, sometimes with
  a recency filter matching the TTL (`created_at > now() - interval '7 days'`).
- **Query for zero as eagerly as for non-zero.** A zero is not a formality — it
  converts "we must rebuild this before shipping" into "finish the retirement",
  which is a completely different unit of work. Both answers are wins.
- **Let the data set the severity, then say which way it moved.** Report the
  number, not just the conclusion, so the decision is auditable later.
- **Escalate the confirmed one to the OWNER, not to the fixer.** A live
  capability regression is a product decision (restore it? move it to the other
  app? accept a staff-mediated workaround?), and the person who can answer that is
  not the person writing the patch.
- **A zero still leaves work.** Here it left `canInviteCoParent`, `inviteVerdict`
  and `PARENT_INVITE_TTL_MS` exported with no callers — the half-retired state the
  grep-to-zero pattern exists to prevent. Unused-but-live verdict logic is an
  invitation for someone to wire it back up to a surface that no longer exists.

## Why This Matters

Deletion reviews have a structural bias toward false alarms. Every deleted
capability *looks* load-bearing in the diff, because the diff shows the capability
and not its usage. Reviewers, correctly, cannot distinguish "this was the heart of
the product" from "this shipped and nobody ever clicked it" — that information is
simply not in the repository. It is in the database.

Without that check the two outcomes are both bad: rebuilding dead features burns a
unit's worth of work and re-adds code that will need deleting again, while
shipping past a real one breaks something for a named family. The query costs
seconds and separates them definitively.

The severity inversion here is the part worth remembering: the finding whose prose
was most alarming was the harmless one. Plausibility of the failure story is not
correlated with whether the failure can occur, and reviewers write the story, not
the usage data.

## When to Apply

- Any unit whose commit message contains "delete", "remove", "retire", or
  "archive" and touches a user-reachable surface.
- Triaging two or more review findings that all claim user impact and cannot be
  ranked from the diff.
- Deciding whether a compensating control must ship in the SAME change or can be
  a follow-up — usage count is exactly that decision's input.
- Before writing a compensating workaround (a reworded email, a staff-mediated
  process): confirm someone is actually affected, or the workaround is
  complexity added for nobody.

## Examples

The shape to prefer, and what each answer means:

```
finding: "deleting X strands families mid-flow"
  -> select count(*) from <the table X writes to> [where <still-live predicate>];
     0      -> finish the retirement (grep identifiers to zero); no rebuild
     n > 0  -> name the n. Escalate to the owner as a product decision.
                Do not let the fixer silently choose a workaround.
```

Related: [retire a feature by removing all its surfaces and grepping its
identifiers to zero](./retire-a-feature-by-removing-all-its-surfaces-and-grepping-its-identifiers-to-zero-2026-08-02.md)
(what to do when the count is zero), and
[a retired route that a machine calls back is not a bookmark](../logic-errors/a-retired-route-that-a-machine-calls-back-is-not-a-bookmark-a-redirect-stub-deletes-the-handshake-2026-08-05.md)
(the case where usage count is irrelevant, because the caller is a system whose
config still names the route).
