---
title: State-changing email links must mutate on POST, not GET (scanner prefetch false-confirms consent)
date: 2026-07-16
category: docs/solutions/security-issues
module: gauntlet / transactional email (double opt-in, unsubscribe)
problem_type: security_issue
component: email_processing
symptoms:
  - A double opt-in confirmation link stamps consent the moment it is fetched, before the parent clicks anything
  - CASL/PIPEDA consent can be recorded "confirmed" without deliberate human action
  - A one-click unsubscribe link can silently opt a recipient out when their mail provider scans the message
root_cause: wrong_api
resolution_type: code_fix
severity: medium
related_components:
  - authentication
tags:
  - double-opt-in
  - casl
  - email-security-scanner
  - get-vs-post
  - confirmation-link
  - prefetch
  - constant-time
---

# State-changing email links must mutate on POST, not GET

## Problem

A confirmation / unsubscribe link in a transactional email that performs its state change on **GET** will be triggered by automated systems that fetch the URL before any human clicks it — most importantly corporate/ISP email-security scanners (Microsoft Defender **Safe Links**, Proofpoint **URL Defense**, Barracuda, etc.), but also mail-client link previews and some spam filters. For a double opt-in flow this means a CASL/PIPEDA **consent record gets stamped "confirmed" without genuine parental action**, defeating the entire point of double opt-in. For an unsubscribe link it means a recipient can be silently opted out.

## Symptoms

- The gauntlet tournament confirm route (`app/api/gauntlet/tournament/confirm/route.ts`) was first written to `update … confirmed_at` inside its `GET` handler — so the confirmation link's side effect fires on prefetch, not on a click.
- The gauntlet tournament unsubscribe route had the same shape: a `GET` that set `consent_given = false`.
- Neither symptom is loud — nothing errors. It manifests as consent/opt-out state that flips without a corresponding human interaction, which only surfaces as a compliance problem or a "why is this parent already confirmed?" question later.

## What Didn't Work

- **Relying on token secrecy / entropy.** The confirm token was a 192-bit random value, which stops *guessing* — but the scanner already has the real link straight from the inbox, so entropy is irrelevant to the prefetch vector.
- **Assuming "it's just a link the parent clicks."** The mental model that a GET link is only followed by the intended human is wrong for anything that lands in an inbox behind an enterprise mail gateway.

## Solution

Move the state change to **POST**. `GET` renders a page with a Confirm/Unsubscribe **button**; the mutation happens only when that button is submitted. Also compare the token in **constant time**.

Before (mutates on GET — prefetch-unsafe):

```ts
// app/api/gauntlet/tournament/confirm/route.ts
export async function GET(req: Request) {
  const { handle, token } = parse(req);
  const row = await db.from("gauntlet_tournament_entries").select(...).ilike("handle", handle).maybeSingle();
  if (row?.confirm_token !== token) return page("Link expired", ...);   // plain !== compare
  if (!row.confirmed_at) {
    await db.from("gauntlet_tournament_entries").update({ confirmed_at: now() }).eq("id", row.id); // ← fires on prefetch
  }
  return page("Confirmed", ...);
}
```

After (GET renders a button; POST mutates; constant-time compare):

```ts
// GET renders a confirm button — must NOT change state.
export function GET(req: Request) {
  const { handle, token } = parse(req);
  if (!handle || !token) return expired();
  return shell(`Confirm ${handle}`, `
    <form method="POST">
      <input type="hidden" name="h" value="${handle}"/>
      <input type="hidden" name="t" value="${token}"/>
      <button type="submit">Confirm my child's entry</button>
    </form>`);
}

// POST performs the confirmation (a genuine click).
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const handle = normalizeHandle(String(form?.get("h") ?? ""));
  const token = String(form?.get("t") ?? "");
  const row = await db.from("gauntlet_tournament_entries").select("id, confirm_token, confirmed_at").ilike("handle", handle).maybeSingle();
  if (!row || !tokenMatches(row.confirm_token, token)) return expired();
  if (!row.confirmed_at) {
    await db.from("gauntlet_tournament_entries").update({ confirmed_at: now() }).eq("id", row.id);
  }
  return shell(`${handle} is on the board`, ...);
}

function tokenMatches(stored: string, presented: string): boolean {
  const a = Buffer.from(stored, "utf8"), b = Buffer.from(presented, "utf8");
  if (a.length !== b.length) return false;        // timingSafeEqual throws on length mismatch
  return timingSafeEqual(a, b);
}
```

The token still travels in the emailed `GET` URL — that's fine, because the `GET` only *renders* the button now; it changes nothing. The same rewrite was applied to `app/api/gauntlet/tournament/unsubscribe/route.ts` (GET renders "Stop the standings emails?" → POST revokes).

## Why This Works

Per HTTP semantics, `GET` is **safe** (no side effects) and automated fetchers rely on that contract when they prefetch links. A scanner will happily issue the `GET` (rendering an inert page) but will **not** synthesize the `POST` form submission, so the mutation requires a real click. This is the same reason password-reset and "verify email" flows industry-wide land on a page and confirm on POST rather than acting on the raw GET.

This repo **already had the correct pattern** in the nurture unsubscribe route (`app/unsubscribe/route.ts`: `GET` renders "Stop receiving emails?", `POST` sets `consent_revoked_at`). The tournament routes had diverged from it; the fix brings all three into line.

## Prevention

- **Rule of thumb:** any link that arrives in an inbox and changes state (confirm, unsubscribe, approve, one-click actions) must render on GET and mutate on POST. Never put the write in the GET handler.
- **Consistency check:** when adding a new email-link handler, mirror the established exemplar — `app/unsubscribe/route.ts` — rather than reinventing it. Grep for existing `GET`/`POST` pairs on `route.ts` handlers under email flows before writing a new one.
- **Constant-time tokens:** compare emailed tokens with `crypto.timingSafeEqual` (guard the length first — it throws on mismatch), not `!==`. The shared HMAC helper (`app/lib/hmacToken.ts`) already does this; opaque stored tokens (like the confirm token) need the guarded-`timingSafeEqual` helper shown above.
- **Watch for auto-submitting confirm pages:** don't add JS that auto-POSTs the form on load — advanced sandboxes that render and interact with pages would re-open the same prefetch hole the POST split closes.
- **Residual, lower-harm variant:** a GET that only *reveals* information (e.g., a status page) is fine; the rule is specifically about GET handlers that **write**.

## Related Issues

- `docs/solutions/security-issues/supabase-autoconfirm-forged-consent-email-confirmation-signup-retrofit-2026-07-13.md` — sibling consent-forgery vector via Supabase autoconfirm/RLS. Same harm class (a CASL consent record confirmed without deliberate owner action), different mechanism. Overlap: low.
- `docs/solutions/security-issues/admissions-notification-email-html-injection-via-unescaped-child-parent-names-2026-07-14.md` — companion transactional-email-security doc (output-encoding user text in the email body). Overlap: low.
- `docs/solutions/best-practices/atomic-claim-then-send-db-guarded-stamp-column-dedupes-best-effort-email-2026-07-14.md` — email-triggered state mutations done safely on POST/service-role; this GET-vs-POST rule is the link-handler complement. Overlap: low.
- Exemplar to copy for new email-link handlers: `app/unsubscribe/route.ts` (nurture unsubscribe, GET-page → POST-revoke).
