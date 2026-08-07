---
module: fp-signup
tags: [server-actions, feature-flag, launch-gate, fail-closed, nextjs, authorization]
problem_type: security_issue
component: authentication
severity: high
symptoms:
  - "A go-live flag is checked once, where the page decides what to render"
  - "A holding page comment claims the flow is unreachable while the flag is off"
  - "The Server Actions the flow calls have no flag check and no session requirement"
root_cause: missing_permission
resolution_type: code_fix
---

# A flag that gates the page does not gate its Server Actions — they are separately addressable endpoints

> **Status note (2026-08-06): `V3_START_LIVE` no longer exists.** The owner decided
> the v3 signup flow should be on the moment it deploys, so the lever was removed
> entirely — from the page, from all four actions, from the rules module, and with it
> the `HoldingPage`. `/start` is now unconditionally live and there is nothing to set
> in Vercel.
>
> **The defect below was real and the lesson is unchanged.** Nothing here is
> retracted: a gate on a mutating surface still belongs at every entry point, and a
> `"use server"` export is still a public POST endpoint. The code samples describe the
> repo as it was at the time of the fix and are kept verbatim as the record. What is
> stale is only the *example flag's* continued existence — the sibling lever
> `FP_HANDOFF_LANDING_LIVE` is still live, still fail-closed, and still checked inside
> `v3MintHandoffAction` rather than in the page, for exactly the reason this document
> gives.

## Problem

The v3 signup shipped behind `V3_START_LIVE`, described in the plan as a fail-closed
go-live lever, because the new `/start/v3` page is publicly routable the moment it
merges and is wired to real account provisioning. The implementation looked right:

```tsx
// app/start/v3/page.tsx — the ONLY reference to the flag in the whole unit
if (!user && !v3StartLive()) return <HoldingPage />;
```

and the holding page said so out loud:

> *"no form, no action import, no way to start a signup — the gate is the absence of
> the flow, not a disabled button over a live one."*

That sentence is false. A Server Action is not a function that only exists because a
component imported it; the compiler registers it as its **own POST endpoint with a
stable action id**, reachable by anyone who sends that id, regardless of which page
the server chose to render. `v3StartAction`, `v3VerifyCodeAction`, `v3ResendCodeAction`
and `v3EditEmailAction` had no flag check and no session requirement:

```ts
export async function v3StartAction(input: unknown): Promise<V3StartResult> {
  const { ip, ua } = await requestContext();
  // ...rate limit, then straight into real work
  const result = await v3StartSignup(buildDeps(), input, { ip, ua });
```

So with the feature "off", an unauthenticated caller could still POST directly and mint
parent accounts, receive and verify 6-digit codes, and drive the flow to real child
account creation — on a children's product, before the launch review the flag existed
to wait for. The gate protected the *rendering decision*, which is the one thing that
was never load-bearing.

## Symptoms

- A feature flag, kill switch, or launch gate is referenced exactly once, in a page or
  layout, deciding what to render.
- The comment or plan describes the flag as fail-closed, and the mutating code it is
  supposed to protect is in `"use server"` functions or route handlers.
- Grepping the flag name returns one hit. That single hit is the smell: a gate on a
  surface with several entry points cannot live at one of them.
- The protected actions have no independent authorization, on the reasoning that "you
  can only get here from the gated page."

## What Didn't Work

- **Reading the page.** The gate is correct *as a rendering decision*, and reads as a
  complete solution.
- **Trusting the holding page's own claim.** "No form, no action import" is true about
  the HTML and false about the endpoint. Not importing an action in the rendered tree
  does not unregister it; it was compiled and registered from the module that exports
  it.
- **Assuming client-side reachability equals reachability.** The entire class of bug is
  that Server Actions are addressed directly, not invoked through the page.

## Solution

Put the check at the boundary that does the work, as the **first statement**, before
rate-limit accounting and before any privileged client is constructed:

```ts
// app/lib/v3-signup/v3-signup-rules.ts  (pure, affirmative-only parsing)
export const isV3StartLive = (env) => AFFIRMATIVE.has(String(env.V3_START_LIVE ?? "").trim().toLowerCase());

// app/start/v3/actions.ts — every unauthenticated-reachable action
export async function v3StartAction(input: unknown): Promise<V3StartResult> {
  if (!(await v3EntryOpen())) return { kind: "failed" };   // flag OR live session
  // ...
}
```

`v3EntryOpen()` is flag-or-session so signed-in resume paths keep working (the flag is
only meant to gate *unauthenticated new-signup entry*), and it fails closed if the
session probe throws. The holding page's comment was corrected to say what is actually
true.

The test is the durable part, and it asserts more than the return value:

- each action returns the generic refusal with a well-formed body when the flag is
  unset and there is no session, **and**
- the core is never called, **and**
- the service-role client is never even constructed.

Reintroducing the four guard lines turns 6 of 8 assertions red.

## Why This Works

Authorization belongs where the side effect is, not where the affordance is. A page
decides what a browser is *offered*; it cannot decide what an endpoint *accepts*. Once
the check sits in the action, it holds no matter how the caller arrived — a curl, a
stale bundle from a previous deploy holding the old action id, a second UI added later,
or a page whose gate someone edits.

Placing it as the first statement matters too: before it, the code took a rate-limit
strike and built a service-role client for a request it was going to refuse, which both
burns a real caller's budget and does privileged work on behalf of an unauthorized one.

## Prevention

- **Count the entry points before choosing where a flag lives.** If the feature has a
  page and N actions, the gate belongs in N+1 places, or in something all of them call.
  One grep hit for a flag name protecting a mutating surface is a defect signal.
- **Treat every `"use server"` export as a public POST endpoint** and give it its own
  authorization, exactly as you would a route handler. "Reachable only from the gated
  page" is not an access-control property.
- **Put the guard before the rate-limit strike and before any privileged client.** A
  refusal should cost the caller nothing and the system nothing.
- **Assert the negative in the test, not just the return value.** `{kind:"failed"}` can
  be produced by a dozen paths. Assert the core was never called and the admin client
  was never constructed — that is what proves the guard fired instead of the work
  failing somewhere downstream.
- **When a comment asserts a security property, make it a test or delete it.** This unit
  and its predecessor both shipped a comment stating an invariant the code did not
  enforce; in both cases the comment was the clearest statement of the bug.
- Related: [deleting a `"use server"` export is a deploy-skew hazard — the old bundle still holds its action id](../best-practices/deleting-a-use-server-export-is-a-deploy-skew-hazard-the-old-bundle-still-holds-its-action-id-2026-07-27.md)
  (same underlying fact: action ids are addressable independently of the UI that used
  them) and
  [a resume path that returns the prior row's id turns that id into a bearer credential](./a-resume-path-that-returns-the-prior-rows-id-turns-that-id-into-a-bearer-credential-for-someone-elses-account-2026-08-05.md)
  (authorization must be a property of the caller, not of the route they came through).
