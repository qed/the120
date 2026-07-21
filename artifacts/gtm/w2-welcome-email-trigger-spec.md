# Welcome Email #1 — Auto-Fire Trigger — Build Spec

**Version 1.0 — July 20, 2026**
**For:** Ethan (build owner) · **From:** GTM sprint (Week 2)
**Deliverable:** Automatically send Welcome Email #1 (via Resend) whenever a new family enters The 120 database — from the website onboarding flow *or* a manual CRM add.

**Assets this wires up:** `welcome-email-1.html` (branded HTML part) + `welcome-email-1.txt` (plain-text part). Copy is final (`w2-welcome-email-1.md`).

---

## 1. Goal

The moment a family becomes a lead, the machine sends the welcome email once — no manual step. This turns on the nurture engine (sprint §5). It must fire from both entry points and never double-send.

## 2. The two triggers

| # | Entry point | Fires when | Consent source |
|---|---|---|---|
| A | **Website onboarding** | A parent creates an account / starts the dossier flow (the "Join The 120" signup, the modal already live) | The CASL consent checkbox on the signup form (express opt-in) |
| B | **Manual CRM add** | Staff adds a family via the CRM "Add Family" modal | The consent field/flag set in the CRM at add time |

Both paths create/upsert a family row. The cleanest implementation is **one send path keyed off the family record**, not two separate email calls (see §3).

## 3. Recommended implementation

Fire on the **family row reaching "lead" state with consent = true**, regardless of which path created it:

1. On family INSERT (or first transition to stage `Interested`) where `email` is present **and** `consent_email = true` **and** `welcome_email_sent_at IS NULL`:
   - Send via Resend using the HTML + text parts, merging `{{parent_first}}`.
   - Stamp `welcome_email_sent_at = now()`.
   - Write an activity/last-touch entry on the family ("Welcome email sent").
2. Use a DB trigger → queue/webhook (or a Supabase `insert`/`update` subscription → server action). Keep the send idempotent on `welcome_email_sent_at`.

This makes A and B converge: website signups and CRM adds both land as a consented family row, and the same guard sends exactly once.

## 4. Guards (must-haves)

- **Send once.** `welcome_email_sent_at` gate prevents a family added on the web (welcomed) then edited in the CRM from being re-welcomed.
- **Consent required (CASL).** Never send without express opt-in. A CRM-added family with no captured consent must **not** trigger the email — surface a CRM warning instead ("no email consent on file — welcome email not sent").
- **Valid email present.** Skip + flag if missing/invalid.
- **Exclude test/staff rows.** A flag or domain allowlist so internal test adds don't fire real sends.
- **Merge safety.** If `parent_first` is blank, fall back to a neutral greeting ("Hi there,") rather than "Hi ,".

## 5. Resend setup

- From: `peter@the120.school` (reply-to `admissions@the120.school`) — matches the copy doc. Confirm domain is verified in Resend (SPF/DKIM) before first real send.
- Send both parts: `text/html` (the HTML file) + `text/plain` (the txt file).
- Subject: "Welcome to The 120 — here's your first step". Preheader is the hidden div already in the HTML.
- Unsubscribe: wire `{{unsubscribe_url}}` to Resend's unsubscribe/preferences link (required for CASL footer).
- Log the Resend message id back onto the family activity for deliverability tracing.

## 6. Test plan (before enabling)

1. Web signup with consent checked → email arrives once, `parent_first` merged, links work, unsubscribe works.
2. Web signup with consent **unchecked** → no email; family still created.
3. CRM manual add with consent → one email.
4. CRM add of a family that already signed up on the web → **no** second email (idempotency).
5. CRM add with no consent → no email + CRM warning.
6. Render check in Gmail, Apple Mail, and Outlook (the HTML is table-based and inline-styled; Space Grotesk falls back to Arial where the webfont doesn't load — verify it still looks right).

## 7. Open questions for Peter / Ethan

1. **"New family" definition:** fire on account-created, on first dossier step, or on stage = `Interested`? (Recommend account-created with consent, so the welcome lands immediately.)
2. **CRM adds default consent?** Is there always a consent capture in the Add Family flow, or do some staff-added families lack it? (Determines how often #5 fires.)
3. **Per-child vs per-family:** one welcome per family even with 2+ kids? (Recommend per family — the email is parent-facing.)
4. **Timing:** send instantly, or a 1–2 min delay to let the account settle? (Instant is fine.)
