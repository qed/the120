---
date: 2026-07-20
topic: week1-welcome-email-trigger-and-backfill
---

# Week-1 Welcome Email — Auto-Fire Trigger & One-Time Backfill

## Problem Frame

Every family that joins The 120 should receive Welcome Email #1 — the founder-signed
"here's your first step" email whose copy and branded assets are already finished
(`artifacts/gtm/welcome-email-1.html`, `artifacts/gtm/welcome-email-1.txt`, copy in
`artifacts/gtm/w2-welcome-email-1.md`). Today that only half-works:

- A welcome **already fires automatically on website signup** (`app/api/welcome/route.ts`) —
  but with *older, shorter* inline copy, not the finished asset. Two caveats the code review
  surfaced that this doc originally got wrong: its single-send guard is the **auth user's
  `user_metadata.welcome_sent_at`**, *not* `families.welcome_email_at` (that column is only a
  best-effort post-send stamp); and the route applies **no server-side consent check** today —
  it sends to any authenticated user with an email. So the web path is **not** "already correct
  except copy": R2 and R3 change its behavior, not just its wording.
- A family added by staff through the CRM **"Add family" modal never gets a welcome** —
  `addFamily` (`app/crm/lib/actions/families.ts`) creates the row and records consent but
  sends nothing and never stamps `welcome_email_at`.
- **No existing family has ever received the new copy**, and there is no path to reach them.

So the work is: upgrade the copy, close the CRM-add gap so *"whenever a new contact joins"* is
literally true, do a one-time backfill to **all consented existing families** (the welcome
doubles as a shareable asset families can forward to their network), and give staff a
**sent-status indicator + one-click resend** on each contact — all while respecting CASL and
protecting the shared sending domain's reputation.

Affected: every prospect family (they get a consistent, on-brand first touch), and Peter/
staff (the CRM add path finally behaves like the website).

## Recipient / Trigger Matrix

| Entry path | Consent on file? | Result |
|---|---|---|
| Website signup | Yes (CASL checkbox) | Welcome sent instantly, `welcome_email_at` stamped |
| Website signup | No | Account created, **no email** |
| CRM "Add family" | Yes (consent box) | Welcome sent instantly *(new behavior)*, `welcome_email_at` stamped |
| CRM "Add family" | No | Contact created, **no email**, "no consent — not sent" state shown |
| Existing family (backfill) | Consent on file (any stage; even if already welcomed) | New welcome sent once (deliberate re-welcome), `welcome_email_at` re-stamped |
| Existing family (backfill) | No / revoked / expired / no email / merged / test row | **Excluded** |

*Target states after this ships — two rows are **new** behavior, not current: the web "No consent → no email" row requires adding a server-side consent gate (R3), and single-send across a CRM-add-then-web-signup requires the unified `welcome_email_at` guard (R2).*

## Requirements

**Go-forward auto-send (new contacts)**

- R1. When a family becomes a **consented** lead — from either the website signup **or**
  a staff CRM "Add family" — the welcome email sends automatically, once, within seconds.
  Both paths converge on the same send logic and the same idempotency stamp, so a family
  can never be **automatically** welcomed twice regardless of which path (or both) created it.
  (The only re-sends are the *deliberate* ones — the one-time backfill R8 and the manual resend
  R13 — each explicitly guarded.)
- R2. The single-send guarantee is enforced by an **atomic claim** on
  `families.welcome_email_at`: send only when the claim `UPDATE ... WHERE welcome_email_at IS
  NULL` matches a row, and stamp it in that same write. **The atomic column claim is the only
  guard** — not a confirm dialog, an account-age/time-window check, or the auth-metadata flag
  the web route uses today. This **replaces** the web route's current
  `user_metadata.welcome_sent_at` guard so both paths share one authoritative gate: neither a
  web-then-CRM re-add **nor a CRM-then-web signup with the same email** re-welcomes a family
  (the CRM-then-web direction is where a naive design double-sends, because the new web auth
  user has no `welcome_sent_at`).
- R3. The **CASL send-gate** is applied before every send: `consent_given` true, not
  revoked, not merged, a valid email present, and (if set) not past `consent_expires_at`.
  A CRM-added contact with **no consent captured** is created normally but sends nothing,
  and the CRM surfaces a "no email consent on file — welcome not sent" state (consistent
  with the Add-Family modal's existing "private note, never emailed" semantics). The web
  route has **no server-side consent gate today**, so R3 is a *new* check added there, not an
  existing behavior — closing a live gap where a consent-less web signup could be sent a
  commercial welcome.
- R4. **Merge safety:** `{{parent_first}}` falls back to a neutral greeting ("Hi there,")
  when no first name is on file; a send is skipped (never sent broken/half-merged) when the
  email is missing or invalid.
- R4a. **Injection safety (required, not optional):** `{{parent_first}}` is passed through the
  existing `escapeHtml` helper (`app/crm/lib/library-rules.ts`) before HTML interpolation, and
  newline/CRLF-stripped before any header use, on **every** send path (web, CRM, backfill).
  `app/api/welcome/route.ts` is a documented, still-open instance of the 2026-07-14
  HTML-injection incident class (`docs/solutions/security-issues/admissions-notification-email-html-injection-via-unescaped-child-parent-names-2026-07-14.md`)
  via this exact field — this upgrade must not reship it. An R11 gate verifies a crafted
  `first_name` renders as literal text before any real send.

**Email content & CASL compliance**

- R5. The email is the finished GTM asset (`artifacts/gtm/welcome-email-1.html` +
  `welcome-email-1.txt`), **replacing** the older inline copy in the web welcome route, sent
  multipart (HTML + text). Subject: "Welcome to The 120 — here's your first step."
- R6. Every send carries a CASL-compliant footer: an **accurate identification line** and a
  working **one-click unsubscribe / preferences** link. The GTM asset's own footer line
  *"You're receiving this because you started an account with The 120"* (and the current code
  variants — the web route's *"an account was created with this address"* and nurture's
  *"…with consent to hear from us"*) all assume self-signup; replace with wording true for
  **every** recipient, since a staff-added or backfilled lead did not "start an account." The
  unsubscribe link uses the **existing HMAC-signed** `unsubscribeUrl(familyId)` /
  `verifyUnsubscribeToken` machinery (`app/lib/nurture/token.ts`, `app/unsubscribe/route.ts`)
  and inherits its GET-renders-confirm / POST-revokes guard so a mail scanner can't auto-revoke.
  Because the asset **already contains** an inline `{{unsubscribe_url}}` footer, sends inject
  the signed URL into the asset — they do **not** route through `sendNurtureEmail` (which would
  append a *second*, wrong-wording footer).
- R7. **From:** `peter@the120.school` (reply-to `admissions@the120.school`) for both the
  new-contact sends and the backfill. (`app/lib/email.ts` `sendEmail` currently hardcodes
  `From: hello@the120.school` with no override — a small `from`/`replyTo` parameter is
  required to satisfy this; see Dependencies.)

**One-time backfill**

- R8. The backfill sends the new welcome to **every consented family** (R3 gate; test/staff
  excluded per R9) **once**, regardless of funnel stage or whether they received the old copy —
  a deliberate one-time re-welcome, since the email doubles as a shareable asset. It **bypasses**
  the auto `welcome_email_at IS NULL` guard (already-welcomed families are in scope by design)
  and re-stamps `welcome_email_at` on send. Because that column is already set for prior
  recipients, run-level idempotency/resumability keys off a **run-scoped marker** (a
  backfill-send log, or a timestamp compared to the run start) — *not* `welcome_email_at IS
  NULL` — so a mid-run failure resumes without re-sending to families already sent in this run,
  and the run never collides with the go-forward auto-trigger.
- R9. **Internal / test / staff rows must be excluded** from the backfill (e.g. the Kuperman
  test families and internal addresses) so a real send never fires to test data. No such
  exclusion flag exists in the `families` schema today — a mechanism (an `is_test`/internal
  flag or an email/domain allowlist) must be **added and the existing rows tagged** as a hard
  precondition, confirmed against the R11 dry-run list before the internal-batch and full-send
  gates.
- R10. The backfill is **throttled** (a bounded send rate, not one burst) to protect the
  sending domain's reputation — shared with Stripe receipts, offer emails, and auth mail —
  and bounces / spam-complaints are watched in Resend during the run. The run **auto-pauses**
  (not merely alerts) when the bounce or spam-complaint rate crosses a defined threshold within
  a batch, resuming only after manual review — a human watching a dashboard reacts too slowly
  to protect transactional/auth mail on the shared domain.

**Verification before full send**

- R11. Before any real backfill, the flow is proven end-to-end in this order, each a
  **go/no-go gate**: (1) a **dry-run** that reports the exact recipient count and a rendered
  preview *without sending* — output to the operator's **local terminal only**, never a
  committed file, shared log, or third-party service (it is a full list of family names +
  emails); (2) a live send to **Peter's own inbox** (render check across Gmail / Apple Mail /
  Outlook; links and unsubscribe verified working); (3) the **full send to all consented
  families in one go**, with R10's auto-pause as the safety net (an optional small warm-up batch
  may precede it only if the dry-run count is large). Two safety checks gate the run: the R9 test-row
  exclusion is confirmed against the dry-run list, and a crafted `first_name` (e.g. containing
  HTML / `<a>` markup) is verified to render as **literal text** (R4a). The go-forward triggers
  are separately proven: a web signup with consent and a CRM add with consent each produce
  exactly one email, a consent-off CRM add produces none, and a **CRM-add-then-web-signup with
  the same email** produces exactly one email total.

**CRM contact controls**

- R12. The single-contact pipeline view shows the **Welcome-email status**: "Welcome sent ·
  [date]" when `welcome_email_at` is set, a "not sent — no consent" state when consent is
  absent, and "not sent yet" otherwise. It is a read-only reflection of the same stamp the send
  paths write.
- R13. A **manual "Resend welcome" button** on the contact lets staff re-send when a send
  didn't go out (failed, stranded, or never fired). It is an explicit, deliberate send: it
  **bypasses** the auto `welcome_email_at IS NULL` guard but is protected by a CAS-guarded claim
  on the last-sent timestamp the acting staff member saw (the offer-email resend pattern), so
  two concurrent resends can't both fire. It re-checks the CASL gate (R3), escapes the merge
  field (R4a), re-stamps `welcome_email_at`, requires `requireStaff`, and is the staff recovery
  path for the stranded-claim case R2's serverless send can otherwise leave behind.

## Success Criteria

- Every new family that joins **with consent** — web or CRM — receives the welcome once,
  automatically, within seconds; no family is ever double-welcomed.
- A staff-added contact **without** consent is created but not emailed, and staff can see
  why.
- Every **consented** existing family (any funnel stage) receives the new welcome once, at a
  rate that leaves domain reputation intact (transactional mail keeps landing).
- Staff can see on each contact whether the welcome went out, and resend it in one click if it
  didn't — no family is silently left un-welcomed by a failed send.
- **Outcome, not just delivery:** among welcomed families, a downstream signal the funnel
  already emits (dossier-start or call-booking rate) is observed, so the send is judged on
  whether it moves families — not only that it left the building.
- The email that goes out is the finished branded asset, with a CASL identification line
  that is accurate for every recipient and a working unsubscribe.

## Scope Boundaries

- **Not using the nurture-engine/cron** for this welcome — instant per-insert was chosen.
  The daily nurture sequences (`app/lib/nurture/*`) are untouched.
- **No new nurture steps or follow-up emails** (week-2+, reminders, drips). This is
  Welcome Email #1 only.
- **Re-welcoming is intended** for this one-time backfill (superseding the earlier
  never-welcomed-only scope): every consented family gets the new copy once, even if they got
  the old one, because it doubles as a shareable/forwardable asset. Ongoing *auto*-sends still
  fire once per genuinely-new contact.
- **No consent-capture UI redesign** — the Add-Family modal's consent checkbox stays as-is;
  only the "not sent — no consent" state is surfaced.
- **No change to the transactional offer email** or its identification-only footer.
- **"Everyone in the database" explicitly does NOT mean all rows** — unconsented, revoked,
  expired, merged, no-email, and test rows are excluded by design.

## Key Decisions

- **Backfill = ALL consented families, any stage, one deliberate re-welcome** (Peter,
  2026-07-20, superseding the earlier "never-welcomed only" call): every consented family (not
  revoked/expired, valid email, test/staff excluded) gets the new welcome — including old-copy
  recipients and already-progressing families — because it doubles as a shareable asset they can
  forward. **The CASL consent gate is held as a hard legal line** (non-consented contacts are
  excluded — law, not preference). Re-welcoming is the accepted tradeoff (old-copy recipients
  may receive two welcomes over time).
- **Sent-status + one-click resend on each contact** (Peter, 2026-07-20): staff can see whether
  the welcome went out and resend a failed one — which also supplies the recovery net the
  serverless claim-then-send otherwise lacks.
- **Instant per-insert on both paths + a separate throttled one-time backfill script**
  (over folding the welcome into the daily nurture cron): preserves today's instant web
  welcome and keeps the risky bulk send controllable and testable; the nurture route would
  delay new welcomes up to ~24h. (Peter, 2026-07-20)
- **From `peter@` everywhere** (over a split personal/bulk address): the copy is
  founder-signed and personal; consented-only + throttled keeps reputation risk low.
  (Peter, 2026-07-20)
- **Reuse existing infrastructure over new abstraction:** `families.welcome_email_at` as the
  single idempotency gate, the codified CASL send-gate, and the offer-email atomic
  claim-then-send pattern. Reuse is **not zero-change** — code review found it requires
  reworking the web route's guard onto `welcome_email_at` (R2), adding a `from`/`replyTo` param
  to `sendEmail` (R7), injecting the signed unsubscribe URL into the asset rather than via
  `sendNurtureEmail` (R6), and likely extracting the CASL gate into a shared predicate.

## Dependencies / Assumptions

- **Provider:** Resend. `RESEND_API_KEY` and `CRON_SECRET` live in Vercel env (Production +
  Preview), not `.env.local`. The `the120.school` sending domain must have SPF/DKIM verified
  before the backfill.
- **Verified existing facts (corrected by code review):** web welcome at
  `app/api/welcome/route.ts` guards on the auth user's `user_metadata.welcome_sent_at`, sends,
  then stamps `families.welcome_email_at` **best-effort** (keyed on `parent_id`; no-ops when
  the family row is absent) — and applies **no consent check**. CRM add at
  `app/crm/lib/actions/families.ts` → `addFamily` records consent but sends nothing today.
  `app/lib/email.ts` `sendEmail` **hardcodes** `From: hello@the120.school` (no override — R7
  needs a param). `app/lib/nurture/send.ts` `sendNurtureEmail` appends its **own** CASL footer
  + `unsubscribeUrl(familyId)` — usable only where a `familyId` exists and where the template
  has no footer of its own (the asset has one, so see R6). The CASL send-gate is codified as
  inline guards in `app/lib/nurture/rules.ts` (not a standalone predicate) — reuse across the
  trigger + backfill likely means extracting a shared function. `scripts/backfill-families.ts`
  exists (and repairs `welcome_email_at` from metadata) but its current select omits
  `consent_expires_at` — a send-backfill must select and honor it. One-click unsubscribe at
  `app/unsubscribe/route.ts` (GET confirms, POST revokes); claim-then-send pattern documented
  in `docs/solutions/best-practices/`.
- **Family-row timing:** the `families` row is created asynchronously/best-effort by the
  `parents_families_sync` trigger (it warns and never blocks signup), so at web-send time the
  `familyId` — needed for the signed unsubscribe URL and the `parent_first` merge — may not
  exist yet. Planning must define behavior when it is absent (resolve/create it in the claim
  step, or defer the send until it exists).
- **Assets are final:** `artifacts/gtm/welcome-email-1.html` + `.txt` (merge fields
  `{{parent_first}}`, `{{unsubscribe_url}}` only); copy source `artifacts/gtm/w2-welcome-email-1.md`.
- **Column-name mismatch to reconcile:** the GTM build spec names the gate
  `welcome_email_sent_at`, but the real column is **`families.welcome_email_at`**.

## Outstanding Questions

### Resolve Before Planning
- (none — all product decisions resolved)

### Deferred to Planning
- [Affects R1][Technical] Exact CRM-path trigger point — inside `addFamily` after insert
  (fire-and-forget vs awaited, mirroring the offer-email action) — and whether both paths
  should route through **one shared send helper** so copy, footer, and gate never diverge.
- [Affects R5][Technical] Whether the web route and the backfill read the **same template
  asset** (single source of truth) so the two send paths can't drift.
- [Affects R6][Content] The exact replacement identification-line wording that is
  CASL-accurate for all recipient types (web signup, staff-added, backfilled). (Escaping is now
  a hard requirement — R4a — not a deferred question.)
- [Affects R9][Technical] How internal/test/staff rows are identified for exclusion — a flag
  or domain allowlist. The GTM spec assumed a flag; **not verified to exist** — confirm or add.
- [Affects R10][Needs research] Concrete throttle rate against Resend's batch/rate limits,
  and how to watch bounce/complaint rates live; whether a brief warm-up is warranted given
  the domain also carries transactional mail.
- [Affects R8][Technical] Backfill script home + resumability — reuse the existing
  `scripts/backfill-families.ts` pattern — and how it authenticates to send (Vercel env vs
  local run).
- [Affects R2][Technical] Rework the web route's idempotency from `user_metadata.welcome_sent_at`
  to the `welcome_email_at` atomic claim, and reconcile the existing metadata population so an
  already-welcomed user's next dashboard sign-in neither double-sends nor re-welcomes.
- [Affects R2][Technical] Serverless delivery safety for the go-forward send — awaited,
  never-throw `sendEmail` + bounded timeout + CAS-guarded unclaim on failure (or Vercel
  `waitUntil`), plus a stamped-but-unsent detector/repair. The no-re-welcome scope removes the
  offer email's staff-resend recovery net, so a stranded claim would silently, permanently skip
  a family.
- [Affects R6/R4][Technical] Resolve `familyId` + `parent_first` at web-send time given the
  family row is created async/best-effort by the sync trigger; define absent-row behavior.
- [Affects R8][Security/Ops] Run the backfill from a Vercel-scoped credential, not a local
  `.env.local` service-role key (the reused `scripts/backfill-families.ts` pattern falls back
  to `.env.local`) — it can bulk-send founder mail and read every family's PII.
- [Affects R2][Security] `families.welcome_email_at` has no DB guard trigger (unlike
  `children.submission_notified_at`) — consider a coerce/guard so a direct authenticated REST
  write can't clear or pre-set the stamp.
- [Affects R1][Product] If a CRM contact is added without consent and *later* consents (e.g. via
  a consent update or a booking-inquiry), should the welcome fire at that point? Today R1 fires
  only at entry.
- [Affects R6][Security/Design] The welcome is meant to be forwarded, but its one-click
  unsubscribe is a *personal* HMAC link — a forwardee could unsubscribe the original recipient.
  Decide whether that's acceptable (the POST-confirm step already blocks passive scanners) or
  whether forwarded copies need different handling.
- [Affects R8/R13][Technical] Storage home for run-scoped backfill idempotency and the resend's
  CAS claim — likely the same last-sent timestamp the offer email uses (plus a backfill-run log
  or run-start timestamp for resumability); keep it staff-only (RLS), never client-writable.

## Next Steps
-> `/ce:plan` for structured implementation planning.
