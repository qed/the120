---
module: fp-v3-onboarding
tags: [retirement, redirect, stripe, webhook-race, callback-url, third-party-contract]
problem_type: logic_error
component: service_object
severity: high
symptoms:
  - "A route retired to a redirect stub is still named by a third party's configuration"
  - "A page that existed to absorb a race is replaced by an instant redirect"
  - "The retirement's own test pins the redirect shape, so the suite stays green"
root_cause: missing_workflow_step
resolution_type: code_fix
---

# A retired route that a MACHINE calls back is not a bookmark — a redirect stub deletes the handshake

## Problem

Archiving the v2 signup flow replaced seven `/start/*` deep routes with bare
redirect stubs, so no bookmark or already-sent email would 404:

```tsx
export default async function RetiredV2Route() {
  redirect(V2_DEEP_ROUTE_TARGET);   // always "/dashboard"
}
```

Six of the seven were exactly that: URLs a *human* might still hold. The seventh
was not. `/start/arrival` is **Stripe's `success_url`**:

```ts
// app/lib/funnel/deposit-core.ts - untouched by the retirement
success_url: `${input.origin}/start/arrival?child=${encodeURIComponent(input.childId)}`,
```

and checkout was still reachable from two live dashboard buttons. The archived
page's own docblock said why it existed: a family lands there *seconds* after
paying, **usually before the Stripe webhook has committed**, so it polled the
arrival API until a claim was confirmed twice in a row, treating a missing claim
as "the webhook is racing us", not as an error.

Replacing it with an instant redirect meant a family paid $250, got bounced to a
dashboard that could not yet see their payment, and was shown no confirmation, no
pending state, and no explanation — the exact race the page was built to absorb.
Nothing 404'd, so the retirement looked complete.

The retirement's own test made it *worse*: it pinned each stub's shape
(`redirect(V2_DEEP_ROUTE_TARGET)`, no try, no session read) and separately pinned
that `deposit-core.ts` still contained the string `/start/arrival` — both facts
sat in one file, both green, and their contradiction was never asserted.

## Symptoms

- A retirement enumerates "bookmarks and sent emails" as the things that must not
  break, and stops there.
- A route's only remaining caller is a config value in another system: a payment
  provider's `success_url`/`cancel_url`, an OAuth `redirect_uri`, a webhook
  target, an SSO ACS URL, a QR code, a DNS/CDN rule.
- The retired page's docblock describes *waiting* for something (polling,
  confirming, debouncing) rather than rendering.
- Tests pin the new stub and the old caller independently, so both pass.

## Solution

**Separate "a human might have this URL" from "a machine will POST/redirect to
this URL". Only the first is satisfiable by a redirect.**

A human holding a stale bookmark wants to end up somewhere sensible. A machine's
callback URL is a **contract term** in a handshake that is still running — the
redirect discards the half of the exchange the page was there to perform. Here
the fix was to keep `/start/arrival` a real page, re-deriving the poll (a missing
claim means keep waiting; a terminal answer commits only after two consecutive
identical reads; a bounded timeout says "still setting up", never "failed", and
explicitly says *do not pay again*).

Then assert the pairing, rather than each side alone:

```ts
// The pairing is the guarantee. deposit-core still builds the URL and checkout
// is still reachable, so the page it names must be a PAGE, not a stub.
expect(read("app/lib/funnel/deposit-core.ts")).toContain("/start/arrival");
expect(read("app/dashboard/DashboardApp.tsx")).toContain("/api/checkout");
expect(RETIRED_V2_ROUTE_FILES).not.toContain("start/arrival/page.tsx");
```

Note also where the deleted logic had been living: `app/start/**` is outside this
repo's vitest include allowlist. The race bridge was therefore **untested, and
that is why it was deletable**. Moving the loop to `app/lib/funnel/arrival-poll.ts`
put it inside the allowlist and made the behavior pinnable at all.

## Why This Works

A redirect answers "where should this person go now?". A callback URL is not
asking that question — the third party is mid-transaction and is handing control
back at a specific point, expecting the application to do the next step. The
route is an API endpoint that happens to render, so retiring it is a breaking API
change, not a link-hygiene chore.

The untested-code observation generalizes: coverage boundaries decide what a
refactor can quietly remove. Logic that lives outside the test allowlist has no
defender in the suite, so it is exactly the logic that vanishes in a large move
with everything green.

## Prevention

- **When retiring a route, grep for it in CONFIG and in outbound URL builders,
  not just in `href`s and mail templates.** Ask, for each hit: is the caller a
  person or a system? A system's URL cannot be retired unilaterally.
- **List the third-party contracts a route participates in before touching it.**
  Payment `success_url`/`cancel_url`, OAuth `redirect_uri`, webhook receivers,
  SSO ACS URLs, unsubscribe endpoints, and app-store/deep-link targets are all
  URLs someone else stored.
- **A page that polls, debounces, or confirms is absorbing a race. Find out whose
  race before deleting it** — the answer is usually an async system whose timing
  the redirect does not change, only hides.
- **Assert the PAIRING, not the parts.** Two independently-true pins ("the stub
  redirects", "the caller still names this URL") are a contradiction no test
  sees. One assertion that names both is the only thing that fails.
- **Treat "outside the test allowlist" as a retirement risk flag.** Before a big
  move, check whether the code being displaced was ever covered; if not, port it
  into a covered module first, then move.
- Related: [a clean-cutover precondition collapses a planned transition](../best-practices/a-clean-cutover-precondition-collapses-a-planned-transition-retirement-unit-verify-the-end-state-anyway-2026-08-01.md)
  and [a single source of truth is not done until every producer is enumerated](../best-practices/a-single-source-of-truth-is-not-done-until-every-producer-is-enumerated-and-pinned-2026-08-05.md)
  — the enumeration that doc demands must include non-human producers, which is
  precisely what was missed here.
