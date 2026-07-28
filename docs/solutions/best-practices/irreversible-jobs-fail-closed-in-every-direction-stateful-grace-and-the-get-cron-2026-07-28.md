---
module: funnel
date: "2026-07-28"
problem_type: best_practice
component: background_job
severity: high
applies_when:
  - "A scheduled job performs irreversible destruction (purge, de-identification, deletion)"
  - "An exemption list (paying customers, active users) guards the destructive set"
  - "A grace/notice period is promised before the irreversible act"
symptoms:
  - "The retention cron exported POST; Vercel cron sends GET — the automated schedule would 405 every Monday forever"
  - "A truncated deposits read would have stripped the paid-customer exemption — the asymmetrically destructive direction"
  - "The 14-day grace was a timestamp offset with no memory: the first enabled run would purge the whole backlog unannounced"
root_cause: logic_error
resolution_type: code_fix
tags:
  - retention
  - purge
  - cron
  - fail-closed
  - stateful-grace
  - inactivity
  - get-vs-post
---

# Irreversible jobs fail closed in every direction: stateful grace, defined inactivity, and the GET cron

## Context

U17's retention pass de-identifies children's free text after inactivity —
the one job in the funnel whose mistakes cannot be undone. The review pair
found it fail-open in five independent directions before it ever ran.

## Guidance

For any job that destroys data, walk each input and ask "which way does
this fail?":

1. **The trigger itself.** Vercel cron invokes GET; the route exported
   POST — a 405 every Monday, forever, silently. Every sibling cron in the
   repo exported GET; the test only grepped for the path. Pin the METHOD.
2. **The exemption sources fail toward destruction.** The paid-customer
   set came from an unguarded read that PostgREST silently caps at 1000
   rows — a truncated set doesn't miss a purge candidate, it purges a
   CUSTOMER. Every read feeding an irreversible pass pages with a refusing
   ceiling, especially the exemptions.
3. **Grace has memory.** A pure timestamp offset means the first enabled
   run (or a two-week outage) carries the whole backlog straight across
   the "window" with zero notice. Stamp candidates (`purge_noticed_at`)
   when they first surface; purge only stamps older than the window AND
   still inactive — a returning family clears themselves.
4. **"Inactivity" is a definition, not a column.** The first draft read
   only the project row's timestamp; a family actively working their
   dossier for a year was purge-eligible. Define activity as the max
   across the surfaces the user actually touches, and put the DEFINITION
   in the owner-facing claims register, not just the number.
5. **Bad data fails closed.** `Date.parse(...) || 0` made an unparsable
   timestamp "infinitely old" — instantly purgeable. NaN → skip and log.
6. **Order the writes so failure retries.** The goal wipe ran after the
   marker write and its error was swallowed — a transient failure became a
   permanent miss reported as success. Wipe first, mark last: the marker
   is the commit point.
7. **Downstream renders of the tombstone.** The purge left status
   'active', so the wizard prefill would have written the purge marker
   back into the child's dossier pitch as their "project". Purged rows
   flip to 'abandoned' and leave every active read.

## Why This Matters

Reversible jobs get to learn from production. This one doesn't: every
fail-open direction is a child's work gone or a compliance promise
silently unmet. The five failures were all invisible to a green suite
because each lived in a gap between components (cron config vs route,
read caps vs exemptions, schedule text vs runtime memory).

## When to Apply

Any purge/reaper/de-identification job, before its first enabled run — and
retro-actively to existing ones: check the method, the read bounds on
exemption sources, the grace statefulness, the activity definition, and
what renders where the destroyed data used to be.
