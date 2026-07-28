---
module: auth-mail-guard
tags: [default-deny, enumeration, alerting, minors, allowlist]
problem_type: security-issue
---

# A default-deny guard cannot ask "does this account exist?" on a public path

## The setup

The no-auth-mail guard used to recognize students by shape
(`maya.chen.fw@the120.school`). Funnel students get **bare**
`first.last@the120.school`, which is indistinguishable from a staff
address, so the guard inverted to default-deny: every address on the
school domain is refused unless allowlisted.

Default-deny has a designed failure mode — a staff mailbox missing from
the allowlist gets its password reset silently refused. So the plan
required refusals to be *observable*. The obvious-looking discriminator,
to keep the alert channel high-signal against a public form that any bot
can spam: **alert only when the refused address has an auth account**
(a real person locked out) and log the rest (a bot guessing).

## Why that is wrong

Student accounts **are** real Supabase auth users. They are created by
`admin.createUser`, password-less and dormant — dormant is not absent.
So "has an account" is true for essentially every enrolled child, and the
discriminator inverts into an attack:

- guess a child's guessable address → ops receives an email **containing
  that child's address**, on every request, unthrottled;
- the alert confirms enrolment — a PII leak about a minor, to whoever can
  read the ops inbox, triggered by an unauthenticated stranger;
- the channel meant to surface a missing allowlist entry drowns in
  student noise, which is the alert fatigue the idea existed to prevent.

Two more defects rode along, each independently fatal: the extra awaited
work happened **only** on the refused-and-exists branch, making request
latency an enumeration oracle; and `listUsers()` was unpaginated, so it
inspected the first 50 of 270 users and would mostly have answered "no"
regardless.

## The rule

**On a public, unauthenticated path, a guard may only do work that is
identical for every outcome.** Log, and return. Any per-branch lookup is
simultaneously a timing oracle and an abuse lever.

Answer the operational question where it is cheap and exact instead: a
**scheduled reconciliation** over the full auth user list, naming domain
accounts that are neither allowlisted nor in a recognized student
namespace. No visitor can trigger it, it leaks nothing, and it answers
"is the allowlist complete?" precisely rather than by inference.

## Two smaller lessons from the same change

- **Send with the least-privileged key that works.** Moving
  `resetPasswordForEmail` server-side tempted a `supabaseAdmin()` client.
  Service-role steps around Supabase's own per-IP reset throttling — the
  protection the flow had for free in the browser. The anon key,
  server-side, keeps it.
- **A guard is only as wide as its scan.** Closing the reset door left
  `AccountModal`'s `signUp()` open, because `signUp` was not in the
  mail-capable regex — anyone could type a student's address into the
  public signup form. When a guard's polarity changes, re-derive the list
  of things it must cover; do not inherit the old one. And strip
  comment-only lines before scanning, or a doc comment naming a method
  reads as a call site.
