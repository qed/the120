---
title: "Admissions notification email interpolated unescaped parent-controlled names into a hand-built HTML template — stored HTML-injection/phishing vector into the trusted staff inbox"
date: 2026-07-14
category: security-issues
module: notify-submission-email
problem_type: security_issue
component: email_processing
symptoms:
  - "A parent naming a child `</strong><a href=\"https://evil.example\">Session expired — re-authenticate</a>` via the wizard's plain name TextFields would render as live, clickable markup in the admissions@the120.school inbox on submit — staff there hold full CRM access to every family's PII"
  - "Same vector via the parent's own signup user_metadata.first_name/last_name (unvalidated free text) reflected in the email's Parent line"
  - "The only sanitization — newline-strip + truncate — targeted SMTP header injection in the subject; it encodes none of < > & \" ' and did nothing for the HTML body"
  - "A tested escapeHtml already existed (app/crm/lib/library-rules.ts, used by other staff-facing emails) and was not reused when this route's template was hand-built"
root_cause: missing_validation
resolution_type: code_fix
severity: high
related_components:
  - email_processing
  - development_workflow
tags:
  - html-injection
  - stored-xss
  - email-security
  - escape-html
  - resend
  - phishing
  - transactional-email
  - code-review-catch
---

# Admissions notification email interpolated unescaped parent-controlled names into a hand-built HTML template — stored HTML-injection/phishing vector into the trusted staff inbox

## Problem

The new admissions-notification route (`app/api/notify-submission/route.ts`, introduced in `4c66199`) emails admissions@the120.school when a parent submits a dossier. It interpolated parent-controlled free text — the child's `first_name`/`last_name` (StepBasics TextFields: no maxLength; DB column plain `text` with no CHECK, unlike `group_slug`'s enum CHECK) and the parent's name from `user_metadata` — directly into a hand-built HTML template literal sent via Resend. A crafted name typed through the ordinary wizard UI renders as live markup in the staff inbox: a stored HTML-injection/phishing vector into a trusted internal channel, and a plausible pivot for credential-harvest attempts against staff who hold full CRM access to all families' PII. Caught pre-ship by the security reviewer in PR #5's 13-reviewer pass; fixed in `f6aadb2`.

## Symptoms

- Crafted child or parent names render as live HTML (links, images, injected styling) in the admissions inbox the moment a dossier is submitted.
- Exploitable through the ordinary parent-facing wizard — no auth bypass needed, just typing into a name field.
- Existing sanitization (`.replace(/[\r\n]+/g, " ")` + truncation) created a false sense of safety: it defends against SMTP header injection in the *subject*, a different context entirely.
- The attack surface was open at every layer: UI (no input constraint), API (no escaping), DB (no CHECK on name columns).

## What Didn't Work

- **Newline-stripping + truncation alone.** `rawName.replace(/[\r\n]+/g, " ").slice(0, 80)` prevents header injection/splitting via the subject line (a real, distinct threat) but passes `< > & " '` untouched. Two injection contexts — mail header vs. HTML document — need two different defenses; only one was applied, then mistakenly relied on for both.
- **Not reusing the existing, tested helper.** `escapeHtml` in `app/crm/lib/library-rules.ts` (unit-tested in `actions-library.test.ts`: `escapeHtml('<b>&"\'')` → `"&lt;b&gt;&amp;&quot;&#39;"`) already protected the CRM's staff-composer emails. The new route hand-built its own template and didn't import it — the eventual fix was essentially a two-line import.

## Solution

Wrap every interpolated user-controlled value in the `html` template with the existing `escapeHtml`; leave the plain-text part and the subject's header-injection defense untouched.

```ts
import { escapeHtml } from "@/app/crm/lib/library-rules";
```

Before (`4c66199`):

```ts
html: `...
  <p style="margin: 0 0 16px;"><strong>[${safeName}]</strong> · ${grade} · group: ${group}<br/>
  Parent: ${parentName.slice(0, 120)} · ${user.email ?? "—"}</p>
...`,
```

After (`f6aadb2`):

```ts
// Child and parent names are parent-controlled text: bracketed, truncated
// (guard-hardening precedent), newlines stripped from the subject — and
// HTML-escaped before interpolation into the html body, or a crafted name
// becomes live markup in the admissions inbox.
html: `...
  <p style="margin: 0 0 16px;"><strong>[${escapeHtml(safeName)}]</strong> · ${grade} · group: ${escapeHtml(group)}<br/>
  Parent: ${escapeHtml(safeParent)} · ${escapeHtml(parentEmail)}</p>
...`,
```

`grade` and `crmUrl` are deliberately not wrapped — both are server-derived (`Grade ${number}` and a server-built URL whose only variable segment is the RLS-fetched row's UUID). `group` *is* wrapped despite its DB CHECK constraint — defense in depth; escaping at the interpolation site is free and the CHECK is a separate layer that could drift.

## Why This Works

- `escapeHtml` neutralizes exactly the injection primitive in play: `& < > " '` become entities, so `</strong><a href=...>` displays as literal text instead of parsing as markup. Context-appropriate *output encoding* — the standard defense for "user string into an HTML body" — rather than over-restrictive input validation on a real person's name field.
- Escaping is applied in the `html` part only. The `text` MIME part is rendered literally by mail clients, so escaping it would wrongly show `&lt;` to human readers of the plaintext fallback.
- Reusing the tested helper inherits existing coverage and keeps one canonical escaping function in the codebase instead of two drifting implementations.
- The subject-line defense (newline-strip + truncate) stays: SMTP header injection and HTML injection are complementary threats needing both defenses.

## Prevention

- **Every hand-built HTML email must run every interpolated user-controlled value through `escapeHtml`** — "user-controlled" includes anything entered via app UI *or* captured into `user_metadata` at signup.
- **When adding an email route, grep for `${` inside the `html:` template literals** in `app/api/*/route.ts` and check each interpolation site for escaping before merge.
- **"Sanitized" must say sanitized *for what*.** Header-stripping ≠ HTML-escaping; a comment claiming a value is "safe" should name the context (subject header vs. HTML body vs. plaintext).
- **Known residual, deliberately not fixed in PR #5:** `app/api/welcome/route.ts` has the identical pattern — `${greeting}` (from unvalidated `user_metadata.first_name`) interpolated unescaped into its HTML template. Same fix shape applies; open as of 2026-07-14 (tracked in the review summary's residual list).
- **Consider a shared escaping-by-default email helper** (a tagged template that auto-escapes interpolations unless marked raw, JSX-style) so new routes can't reintroduce this class of bug by omission — both this bug and the welcome-route residual happened exactly that way.

## Related Issues

- `.context/compound-engineering/ce-review/2026-07-14-dossier-intake-approval-gate/summary.md` — review run: applied fix #2 and the welcome-route residual flag.
- `docs/solutions/best-practices/atomic-claim-then-send-db-guarded-stamp-column-dedupes-best-effort-email-2026-07-14.md` — same route, different lesson (dedupe/reliability of the send).
- `docs/solutions/security-issues/supabase-autoconfirm-forged-consent-email-confirmation-signup-retrofit-2026-07-13.md` — related by theme only (user-controlled input reaching a trusted channel unvalidated); mechanics unrelated. Overlap: Low.
- Implementation: `app/api/notify-submission/route.ts` (fixed), `app/crm/lib/library-rules.ts` (`escapeHtml`), `app/api/welcome/route.ts` (open residual). Commits: `4c66199` (introduced), `f6aadb2` (fixed).
- GitHub issues: none (repo has zero issues; searched 2026-07-14).
