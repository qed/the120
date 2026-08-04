# Beta cohort parent email — 2026-08-04

Send one per family. Credentials are in `scripts/.fp-cohort-credentials.local.md`
(gitignored, local only). Paste that family's block where marked.

**Two variants below** — most families get variant A. Families already holding
a The120 account get variant B (no parent password); they are the ones flagged
`existingAccount` in the roster.

---

## Variant A — new parent account (8 families)

**Subject:** First Profit is ready for {{KID_NAMES}}

Hi {{PARENT_FIRST_NAME}},

First Profit is ready for {{KID_NAMES}} to try. It's a game where kids start a
real small business: they learn how to sell, come up with an idea to build, test whether anyone actually wants it, and work toward their first $10,000 in profit over time.

They can start right now at **https://firstprofit.school**

{{PASTE THE CHILD LINES FROM THE CREDENTIALS FILE, e.g.:}}
> {{CHILD_NAME}}: `{{CHILD_USERNAME}}` / `{{CHILD_PASSWORD}}`
> {{CHILD_NAME}}: `{{CHILD_USERNAME}}` / `{{CHILD_PASSWORD}}`

Everything works on a phone. Fifteen minutes is a real session. They don't need to finish anything in one sitting, and their progress saves automatically.

**One ask:** There are blue buttons throughout the app to improve First Profit. Please share what was confusing, where they got bored, where they got stuck and also generally what things could make this more fun.

Two housekeeping notes:

- Each kid needs their own login. If siblings share one, their work overwrites
  each other.
- I also made you a parent account at https://the120.school —
{{PARENT_EMAIL}} / {{PARENT_PASSWORD}}. You don't need it to get the kids started; it's there if you want to change anything later. Please change the password when you get a moment ("Forgot password" on the sign-in page). Heads up: that site is our separate school-application product, so it will show {{KID_NAMES}} as an unfinished application. Ignore that. It's not part of the beta and nothing is pending.

Thank you for trying this early. Anything at all that's broken, send it my way.

Peter

---

## Variant B — existing The120 account (families flagged `existingAccount`)

**Subject:** First Profit is ready for {{KID_NAMES}}

Hi {{PARENT_FIRST_NAME}},

First Profit is ready for {{KID_NAMES}} to try. It's a game where kids start a
real small business: they learn how to sell, come up with an idea to build, test whether anyone actually wants it, and work toward their first $10,000 in profit over time.

They can start right now at **https://firstprofit.school**

{{PASTE THE CHILD LINES FROM THE CREDENTIALS FILE, e.g.:}}
> {{CHILD_NAME}}: `{{CHILD_USERNAME}}` / `{{CHILD_PASSWORD}}`

Everything works on a phone. Fifteen minutes is a real session. They don't need to finish anything in one sitting, and their progress saves automatically.

**One ask:** There are blue buttons throughout the app to improve First Profit. Please share what was confusing, where they got bored, where they got stuck and also generally what things could make this more fun.

One housekeeping note: each kid needs their own login. If siblings share one,
their work overwrites each other.

(Your existing The120 account is untouched — same password as before.)

Thank you for trying this early. Anything at all that's broken, send it my way.

Peter

---

## Per-family reference

Not reproduced here — this repository is public and the mapping is real family
data. `scripts/fp-cohort-emails.ts` derives each family's variant and child
lines from `scripts/.fp-cohort-roster.local.json` plus
`scripts/.fp-cohort-credentials.local.md` (both gitignored).
