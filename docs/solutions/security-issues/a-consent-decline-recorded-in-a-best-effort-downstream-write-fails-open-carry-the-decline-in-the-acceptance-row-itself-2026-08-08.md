---
title: A consent decline recorded only via a best-effort downstream write fails open; carry the decline in the acceptance row itself
date: 2026-08-08
module: signup-consent
component: photoConsentVerdict / v3ProvisionKid (fpv03 U3)
tags: [consent, tombstone, fail-open, clock-skew, atomicity, coppa, verdict]
problem_type: security_issue
severity: P1 (caught in review before ship)
---

# Problem

fpv03 U3 added an optional photo-consent decline at signup. The decline's
durable form was a per-child tombstone (`children.photo_consent_revoked_at`)
stamped LATER, at provisioning, inside the same best-effort UPDATE as
decorative cover fields — a statement explicitly designed to "never fail
provisioning". The verdict (`photoConsentVerdict`) consulted ONLY the
tombstone.

Two independent reviews composed into the real failure:

1. **Fail-open cascade (adversarial):** if the evidence read OR the children
   UPDATE failed transiently, the child was still provisioned, the tombstone
   never landed, and the verdict — seeing no tombstone — read the SAME
   acceptance row that carried `photo_declined: true` in its evidence as
   full photo consent. Recovery depended on a human grepping for a log line.
2. **Cross-clock ordering (correctness):** `accepted_at` came from Postgres's
   `default now()`; the tombstone from the app's `Date.now()`. The
   "acceptance strictly newer than tombstone wins" rule was being guaranteed
   by two different clocks agreeing.

# Solution

Move the authoritative decline signal INTO the acceptance row: consent-core
already wrote `photo_declined: true` into the consent row's evidence blob
atomically at consent time. The verdict now picks the LATEST qualifying
acceptance and is covered only if THAT row carries no decline (new refusal
reason `"declined"`). Same-instant ties fail closed. A later clean
re-consent row reopens the gate by being newer.

The tombstone remains as defense-in-depth, and its stamp now copies the
consent row's own `accepted_at` (single clock; equal loses to the tombstone
under the strict rule), with `Date.now()` only as a logged fallback.

# Prevention

1. A consent/authorization DECISION must live in the record written
   atomically at decision time, not in a downstream best-effort write. If a
   verdict can only see the decline via a second write, every failure of
   that write is a fail-OPEN.
2. When two timestamps are compared by a strictly-before/after rule, they
   must come from ONE clock source. `default now()` (DB) vs `Date.now()`
   (app) is two clocks; copy the anchor timestamp instead of re-stamping.
3. Test the failure COMBINATION, not just each failure: "signal recorded +
   downstream write faulted + verdict still refuses" is the test that pins
   the whole property (added as the STRANDED-tombstone test).
4. Related: [sibling-gates-over-the-same-untrusted-field-must-share-one-trust-rule-photo-consent-skipped-the-published-version-guard-2026-08-05.md] — this
   module's gates keep composing; route every new photo/consent gate through
   the same qualifying-row selection.
