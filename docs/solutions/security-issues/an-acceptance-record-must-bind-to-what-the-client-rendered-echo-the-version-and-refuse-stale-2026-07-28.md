---
module: funnel-checkout
tags: [consent, policy-acceptance, dispute-evidence, deploy-skew, versioning]
problem_type: security-issue
---

# An acceptance record must bind to what the client rendered — echo the version, refuse stale

## The problem

The checkout acceptance record (`deposit_attempts.policy_version` /
`policy_hash`) was stamped from the SERVER's current `REFUND_POLICY`
constant at POST time, while the client sent only
`{ policyAccepted: true }` — a bare boolean carrying no claim about which
text the browser actually displayed. Any tab opened before a policy
deploy and submitted after it recorded the family as accepting text they
never saw. Harmless-looking until 2026-07-28.2, when the acceptance
record also became the verifiable **parental-consent artifact** that U15
gates student-account minting on: a stale tab would have minted a child's
school account on a consent nobody gave.

## The fix

1. The client echoes the version its bundle rendered
   (`policyVersion: REFUND_POLICY.version` in the POST body).
2. The server refuses a mismatch with 409 `{ stalePolicy: true }` — which
   also covers pre-echo bundles (they send nothing, nothing ≠ current
   version, refused the same way). The UI maps the 409 to "refresh and
   review the current version."
3. A wiring-scan test pins both sides (`app/api/__tests__/checkout.test.ts`).

## The two version lessons that rode along

- **A consent-gate anchor is a historical constant, not a live pointer.**
  `CONSENT_MIN_POLICY_VERSION` is pinned to the literal `"2026-07-28.2"`,
  with a separate assertion that the live version is at-or-after it.
  Asserting `anchor === REFUND_POLICY.version` would force the anchor
  forward on every unrelated text bump — drifting the gate and orphaning
  valid consents.
- **`"YYYY-MM-DD.N"` versions are NOT lexicographically ordered**:
  `"2026-07-28.10" < "2026-07-28.2"` as strings. `policyVersionAtLeast`
  (deposit-rules) parses date + numeric N, fails closed on malformed
  input, and is the ONLY way policy versions may be compared. Pinned with
  a two-digit-N test.

## How to recognize it elsewhere

Any flow where the server records "the user agreed to X" by reading its
own current X: terms checkboxes, consent banners, pricing confirmations.
If the client doesn't prove which revision it rendered, a deploy turns
every open tab into a forged agreement to the new revision.
