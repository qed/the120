---
title: "Beta cohort provisioning — 10 parents / 17 children"
type: requirements
status: approved
date: 2026-08-04
repos: [120-The120]
follow_ons:
  - "Spec B — Account Info screen (first-profit + 120-The120)"
  - "Spec C — grade model: one-time derivation, drop the Sep 1 boundary (both repos)"
  - "Spec D — Google SSO for parents"
---

# Beta cohort provisioning

## Problem

Fourteen-plus children from a warm beta list need to log in at
firstprofit.school and start playing. Their parents need accounts in The120.
Today this is a single-family, hardcoded script (`scripts/provision-fp-family.ts`)
that must be edited and re-run per family — and whose current defaults are wrong
for real beta testers: it resets an existing parent's password, stamps the family
`is_test: true`, and writes `casl_consent: false`.

## Goal

One reviewable batch run that provisions **10 parents / 17 children** end to end,
against production, with a mandatory dry-run first — plus the artifacts needed to
hand credentials to 10 real VIP contacts.

## Non-goals

Explicitly out of scope; each is captured as its own spec (§8):

- Any Account Info / profile-editing UI.
- Any change to the birth-year → grade derivation or the Sep 1 school-year rule.
- Google SSO.
- Enabling the public site (`VITE_ENABLE_PUBLIC_SITE`) for this cohort. It stays
  off; `src/components/rooms/YourSite.tsx` short-circuits on the flag, so the
  room is inert for these children and needs no allowlist entry.
- Any product code change in either repo. This spec is a data operation plus a
  batch runner.

## Roster

Grade is derived once, at provisioning, as `grade = age - 5`. Username is
`<firstname>@firstprofit.school`, lowercase. Every child shares one password,
supplied via `FP_COHORT_CHILD_PASSWORD` (never committed).

**The roster itself is not reproduced here.** It is real family data — parent
names and addresses, children's first names and ages — and this repository is
public. It lives in `scripts/.fp-cohort-roster.local.json` (gitignored), loaded
by `scripts/fp-cohort-roster.ts`; see that module for the shape.

Shape of what the roster drives, per child: parent name and email, parent state
(new vs. already holding a The120 account), child first name, age, derived
grade, and derived `<firstname>@firstprofit.school` username.

**Band distribution** (via `bandForGrade`, mirrored in first-profit
`src/lib/band.ts`): `g3_5` = 8 children, `g6_8` = 8, `g9_12` = 1.
Every child falls inside the program's 3–12 discipline; none is band-null.

**Last names.** Children inherit the parent's `last_name`, except Remi and Sanai,
whose surname differs from the parent's.

**"Likely existing"** is a hint drawn from `artifacts/parents-first.profit.csv`,
not a decision. R4 requires the runner to determine parent existence by live DB
lookup; the CSV is never consulted at runtime.

## Requirements

### R1 — Batch runner with a mandatory dry-run

A new `scripts/provision-fp-cohort.ts`, wired into `package.json` as
`fp:provision-cohort`, reads a committed roster module and processes every family.
`--dry-run` performs zero writes and is required on first invocation; a real run
must be an explicit, separate, deliberate flag.

### R2 — Reuse the proven single-family sequence

Per child, the step order of `scripts/provision-fp-family.ts` is preserved exactly:

1. parent auth user (`email_confirm: true`)
2. `parents` row → trips `on_parent_created` → CRM `families` row
3. path family linkage (`ensurePathFamilyForParent`)
4. `children` row
5. `fp_username` claim via the **service-role** client (the only principal
   `children_fp_username_guard` admits)
6. child auth user on the derived `.invalid` address, carrying the password
7. `path_student_profiles`
8. `ensurePlayerProfile` → `fp_player_profiles` + seeded save

Deviating from this order breaks a documented constraint at some step; the runner
composes the same primitives rather than reimplementing them.

### R3 — Idempotent, adopt-or-create

Re-running must be safe. Existing rows are adopted, never duplicated. An
`fp_username` already owned by a **different** parent's child aborts that family
with a clear message and the run continues to the next family.

### R4 — Existing parents are untouched

If a parent's email already resolves to an auth user, the runner makes **no**
change to that parent: no password write, no `parents` upsert, no `families`
mutation, no mail. It adds only that parent's missing children. This reverses
`provision-fp-family.ts`'s current behavior, which resets an existing parent's
password — unacceptable against a real signup.

### R5 — New parents get a temp password and no automatic mail

New parents are created with `email_confirm: true` and the shared temp
password from `FP_COHORT_CHILD_PASSWORD`. The runner sends nothing. Parents are told to change it via
"Forgot password" on the sign-in page, which routes through the existing
`resetPasswordForEmail` → `/reset` flow.

**Why no automatic mail.** `admin.generateLink` is banned in this repo — it sits
in `no-auth-mail-guard.test.ts`'s MAIL_CAPABLE set, and redeeming it server-side
stamps `email_confirmed_at`, manufacturing "verified" (see
`app/lib/funnel/account.ts`). The only sanctioned alternative,
`resetPasswordForEmail`, sends immediately and cannot be embedded in a
hand-written email — so a context-free reset mail would reach 7 warm contacts
before the product is introduced. Owner keeps first contact.

### R6 — Real leads, not test families

`families.is_test` is **not** stamped, so these families are visible in CRM
pipeline, dashboard tallies and reporting (`app/crm/lib/test-family-filter.ts`
gates 7 production reads on it).

Accepted consequence, decided by the owner with the risk stated: these families
become eligible for the automated nurture cron. In practice the cron additionally
gates on `families.consent_given`, which the trigger-derived row will not have
set — so no send is expected. The dry-run must report each family's actual
`consent_given` so this is confirmed rather than assumed.

### R7 — Write `grade`, leave `birth_year` unset

The runner writes `children.grade` and does **not** write `children.birth_year`.

This is load-bearing. `resolveChildGrade`
(`app/api/fp/grade/grade-rules.ts:98`) returns the birth-year derivation when
`birth_year` is set and falls through to the stored grade otherwise. Leaving
`birth_year` unset therefore means: the Sep 1 school-year boundary never runs for
these children, their grade is the stable value written here, and
`GradeAsk`/`POST /api/fp/grade` never fire (both trigger only on a null grade).

This delivers the owner's intended model — derive once, then let the value be
edited — for this cohort with **no product code change**. Generalizing it to all
children is Spec C.

### R8 — Never log a credential

No password, and no derived grade or birth year, appears in any log, report or
console line — matching the existing never-log-credentials convention in the
login and grade routes. The credentials sheet (R9) is a deliberate local artifact,
not a log.

### R9 — Artifacts

1. **Dry-run plan report** — per family: parent create-vs-adopt, per-child
   create-vs-adopt-vs-skip, username availability, `consent_given`, and any
   collision or refusal.
2. **Per-family credentials sheet** — each parent's email and temp password (or
   "existing account, unchanged"), and each child's username and password,
   grouped so one block can be pasted per parent.
3. **Parent beta email draft** — built from
   `artifacts/First Profit/parent-notice-2026-08-03-draft.md`, including the
   "Forgot password" instruction from R5.
4. **Post-run verification** — a re-query confirming all 17 children have an
   `fp_username`, an auth account, a `path_student_profiles` row, an
   `fp_player_profiles` row and a seeded save; plus one real end-to-end login at
   firstprofit.school.

## Execution protocol

Production is the only environment. Per `docs/LANES.md`: "Same live Supabase
project, no staging copy, no rehearsal window, no undo."

1. Dry-run all 10 families.
2. Owner reviews and approves the plan report.
3. Execute.
4. Run R9.4 verification.

## Success criteria

- All 17 children log in at firstprofit.school with their username and the
  shared password, and reach a playable floor.
- Each child renders content in the band implied by their grade in the roster;
  no child is band-null.
- The 3 pre-existing parents have byte-identical `parents` rows, unchanged
  passwords, and no new mail.
- The 7 new parents can sign in with the temp password and can change it via
  "Forgot password".
- No unintended email was sent to any of the 10 parents.
- Re-running the runner produces zero writes.

## Open items

- Whether the three families flagged "likely existing" in the roster in fact
  have auth users is resolved by the dry-run, not by this document.
- Whether migration `20260904120000_fp_username_email_shaped.sql` (which permits
  email-shaped `fp_username` values) is applied to the **live** database must be
  confirmed before execution. It is merged to `main` (`0377c76`), but merge is not
  apply. Without it, every one of the 17 username claims fails the
  `children_fp_username_format` CHECK.

## Follow-on specs

**Spec B — Account Info screen.** A new item in the account dropdown
(`AccountMenu`, first-profit `src/components/GlobalNav.tsx:243`), with the
"Account" title text removed. Shows full birthday (day, month, year) and grade
level, both editable via an edit icon in the top right. Requires: a new column for
a full date of birth (today `children.birth_year` is a bare year *by design* —
"no birthday is stored"), a new authenticated write endpoint (`/api/fp/grade` is
one-shot and fill-only), and an explicit decision to invert the rule that
`children.grade` is parent/staff-authoritative — a rule four consumers depend on
(`progress-core` band derivation, `AddFounder`, the CRM dossier, sibling-adoption
conflict logic). Storing a child's full date of birth is COPPA-relevant and
interacts with the open policy sign-off in
`[first-profit] docs/plans/2026-08-03-003-launch-checklist.md` §8.

**Spec C — Grade model.** Make birth-year → grade a one-time derivation and
remove the September 1 boundary entirely, on the grounds that the cohort spans
school systems with June 1, September 1 and January 1 boundaries. Touches
`resolveChildGrade`, `schoolYearStartYear`, `gradeFromBirthYear` and
`birthYearBounds` in **both** repos (`app/api/fp/grade/grade-rules.ts` and
`[first-profit] src/lib/band.ts`, which are documented byte-for-byte mirrors).
Changes behavior for children already in the system, including any who have
already answered `GradeAsk`.

**Spec D — Google SSO for parents.** Several of these parents use Gmail. Allow
Google SSO sign-in and link it to the same user as an existing email/password
account, so one person is never two accounts.
