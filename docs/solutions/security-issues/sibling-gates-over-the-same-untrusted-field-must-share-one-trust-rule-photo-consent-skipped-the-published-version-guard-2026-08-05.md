---
module: fp-signup
tags: [consent, coppa, authorization, fail-closed, gate, policy-version, code-review]
problem_type: security_issue
component: authentication
severity: high
symptoms:
  - "A new gate function accepts an input its sibling in the same module refuses"
  - "An authorization check compares version ORDERING without checking the version was ever published"
  - "Tests all pass because every fixture uses a legitimately-published value"
root_cause: missing_validation
resolution_type: code_fix
---

# Sibling gates over the same untrusted field must share one trust rule — the new photo-consent gate skipped the published-version guard its neighbour enforces

## Problem

`app/api/fp/signup/consent-rules.ts` grew a second consent gate. The existing one,
`fpProvisioningConsentVerdict`, decides whether a recorded consent may mint a child.
The new one, `photoConsentVerdict`, decides whether a minor's photo may be uploaded and
sent to a third-party AI image service.

Both read the same untrusted field — a `policy_version` string off a
`fp_parental_consent` row — but they applied different trust rules to it:

```ts
// fpProvisioningConsentVerdict (existing): registry membership FIRST, then ordering.
if (!isPublishedConsentVersion(accepted)) {
  return { ok: false, reason: "consent_unknown",
    detail: `... refusing to infer consent from a version number alone` };
}
if (!policyVersionAtLeast(accepted, FP_CONSENT_MIN_VERSION)) { /* stale */ }

// photoConsentVerdict (new): ordering ONLY.
const qualifying = afterTombstone.find(
  (r) =>
    typeof r.policyVersion === "string" &&
    r.policyVersion.trim().length > 0 &&
    policyVersionAtLeast(r.policyVersion.trim(), FP_PHOTO_CONSENT_MIN_VERSION)
);
```

`policyVersionAtLeast` is a pure `YYYY-MM-DD.N` parse-and-compare. It knows nothing
about which versions were actually published. So any well-formed string that sorts past
the anchor satisfied the gate. Proven against the real module:

```
photoConsentVerdict({ rows: [{ policyVersion: "2099-01-01.1",
                               acceptedAt: "2026-08-07T08:00:00.000Z" }] })
-> { ok: true, policyVersion: "2099-01-01.1" }
```

`2099-01-01.1` was never published, never rendered, and no parent ever saw it — yet it
opened the gate protecting a child's photograph.

## Symptoms

- Two functions in one module consume the same untrusted field, and only one of them
  validates it against the registry/allowlist that defines legitimate values.
- An authorization decision rests on a comparison operator (`>=`, ordering, prefix)
  without a membership check establishing that the compared value is real.
- Every test passes, because every fixture uses a value the system legitimately
  produced. The gap is only reachable from a write path the tests do not model.
- The newer function is the permissive one — the older sibling has the guard, and its
  own comment explains why, one screen away in the same file.

## What Didn't Work

Nothing was "tried and failed" — the omission survived because each plausible check
looked satisfied in isolation:

- **Reading the function alone.** `photoConsentVerdict` is coherent, well-commented and
  fails closed on the cases it does handle (no rows, all revoked, pre-tombstone, empty
  version). Nothing about it looks unfinished.
- **The test suite.** All added tests used `FP_CONSENT_POLICY.version` or a genuinely
  published older version, so the missing branch was never exercised.
- **"It isn't reachable today."** True and irrelevant: the only current writer,
  `recordConsent`, stamps the server constant, so no live path can produce a bogus
  version. But the function is a general-purpose pure gate documented for later callers
  (dashboard re-consent capture, admin tooling, backfills), and reachability is a
  property of the *callers*, which is exactly what changes next.

## Solution

Give the new gate the same guard its sibling already had, and a distinct refusal reason
so the two failure shapes stay legible:

```ts
const qualifying = afterTombstone.find((r) => {
  const v = typeof r.policyVersion === "string" ? r.policyVersion.trim() : "";
  if (v.length === 0) return false;
  // Ordering alone is not proof of consent. Registry membership first, exactly as
  // fpProvisioningConsentVerdict does: never infer consent from a version number alone.
  return isPublishedConsentVersion(v) && policyVersionAtLeast(v, FP_PHOTO_CONSENT_MIN_VERSION);
});
```

The refusal reason is `unknown_version` (mirroring the sibling's `consent_unknown`),
and it fires precisely when a row *claims to reach the anchor on a version we never
published* — the actual attack shape. Rows that simply fall below the anchor keep
returning `stale`, so no pre-existing verdict changed.

Tests now pin the branch directly: an unpublished-but-newer version is refused with
`unknown_version` (asserted by exact reason, and asserted NOT to be `stale`), a
published current version still passes, and a published row beside an unpublished claim
still wins. Reverting the guard turns two of them red.

## Why This Works

An ordering comparison answers "is this version recent enough?" It cannot answer "is
this a version we ever published?" — and consent is a claim about a *specific rendered
artifact*, so the second question is the load-bearing one. Membership in
`FP_PARENTAL_CONSENT_VERSIONS` is what ties the string to text a parent actually saw;
without it the gate infers consent from a number's shape.

The deeper reason the fix is right is symmetry. Two functions reading the same untrusted
field with different trust levels is not a design, it is a bug waiting for a caller.
Whichever gate is more permissive defines the system's real security posture, so the
strictest sibling's rule has to be the module's rule.

## Prevention

- **When you add a gate beside an existing one, diff their input validation first.**
  If two functions read the same untrusted field, enumerate every check the older one
  performs and justify — in a comment — any you deliberately omit. An unexplained
  asymmetry is the finding.
- **Membership before comparison for any allowlisted value.** Ordering, prefix, and
  range comparisons presuppose the value is legitimate. Check the registry/enum first,
  then compare. This applies to policy versions, feature flags, plan tiers, role names,
  schema versions — anything where a string is both a value and a claim.
- **"Not reachable today" is a statement about callers, not about the function.** Pure
  gates outlive the write paths that constrain them. Validate at the gate, because the
  next caller (a backfill, an admin tool, an import) will not.
- **Test the fixture your writer cannot produce.** Coverage built only from
  legitimately-generated values cannot find a trust gap. For each gate, add one case
  using a value the current writer would never emit but a future or out-of-band writer
  might.
- **Verify a new negative test actually bites.** Re-apply the bug and confirm the test
  goes red. Here, reverting the predicate produced `2 failed | 36 passed` — proof the
  assertion tests the guard and not merely the happy path.
- Related: [an acceptance record must bind to what the client rendered](../security-issues/an-acceptance-record-must-bind-to-what-the-client-rendered-echo-the-version-and-refuse-stale-2026-07-28.md)
  (same module; establishes `policyVersionAtLeast` as the only sanctioned comparator and
  the fail-closed rule for malformed versions) and
  [a gate that reads a row is only as wired as the route that writes it](../logic-errors/a-gate-that-reads-a-row-is-only-as-wired-as-the-route-that-writes-it-an-unrouted-recordx-fails-the-gate-closed-forever-2026-08-01.md)
  (gate correctness is a property of callers, not of the module).
