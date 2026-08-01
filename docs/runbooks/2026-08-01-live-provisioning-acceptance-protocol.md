---
title: "Live-provisioning acceptance protocol (Slice B Unit 11)"
type: runbook
status: ready-to-run (human/gated)
date: 2026-08-01
plan: docs/plans/2026-08-01-001-feat-slice-b-signup-provisioning-plan.md
---

# Live-provisioning acceptance protocol — the ONE scripted real-Workspace run

This is the **only** real Google Workspace `users.insert` exercise in Slice B.
Everything else (build + tests) runs with `GOOGLE_WORKSPACE_SA_KEY` **unset**, so
the mailbox leg parks `pending` and no mailbox is ever burned. This run flips that
credential on **once**, for a **fixed small count**, in a **segregated OU**, then
tears the mailbox down with the R28 erasure. Follow it top to bottom; do not
improvise. A real `users.insert` permanently **burns a never-reissue name** — the
local part enters the taken/released ledger forever — so the count is bounded to
this run.

> STOP CONDITIONS (abort the whole run if any is true): the T120 backend is not
> verified live first; the segregated OU is not confirmed empty/dedicated; the
> child family is not a guarded test family (`@test.the120.invalid` or the
> allowlist); more than the FIXED COUNT of mailboxes would be created; any 5xx
> storm or repeated 429 from Google; you cannot immediately run the R28 cleanup
> afterward. When in doubt, unset `GOOGLE_WORKSPACE_SA_KEY` and stop — parking
> `pending` is always safe.

## Fixed parameters for this run

- **COUNT:** exactly **2** children (one path-a, one path-b) under **one** test
  family. Only the path-b child mints a Workspace mailbox.
- **FAMILY:** a guarded test family — parent email under `@test.the120.invalid`
  (server-side `is_test`, CRM-excluded). Never a real family.
- **OU:** `GOOGLE_WORKSPACE_STUDENT_OU` set to a **dedicated, empty** student OU
  used only for this acceptance run.

## Phase 0 — Prerequisites (all must be checked before touching the credential)

- [ ] T120 backend deployed to production and **verified live** (Slice B routes
      answer; see the go-live checklist, deploy order T120-first).
- [ ] `VITE_ENABLE_SIGNUP` / Landing CTA cutover is **still OFF** (this run does
      not need the public CTA; it drives the guarded test family directly).
- [ ] `npm run test` green; `npx tsc --noEmit` clean; `npm run lint` clean.
- [ ] Confirm `GOOGLE_WORKSPACE_SA_KEY` is currently **unset** in production and
      that all existing FP claims are parked `pending`
      (`funnel_student_provisioning.state = 'pending'`,
      `pending_reason = 'workspace credential not configured'`).
- [ ] The Workspace service account has domain-wide delegation for
      `https://www.googleapis.com/auth/admin.directory.user` and can write to the
      dedicated student OU.
- [ ] `GOOGLE_WORKSPACE_STUDENT_OU` points at the dedicated, **empty** OU.
- [ ] A named operator is on the call and has the R28 cleanup (Phase 4) staged.

## Phase 1 — Create the guarded test family + both children (credential still OFF)

Do this with `GOOGLE_WORKSPACE_SA_KEY` **still unset**, so the path-b child parks
`pending` (no mailbox yet). This proves the whole signup sequence end-to-end
before any Google call.

- [ ] Start a signup for the test-family parent (`@test.the120.invalid`),
      verify the email, record consent, and create **two** children:
      - **path-a** child: `credentialChoice = existing_credential` + a child
        password. Expect `child_created`; the child can log in by first name.
      - **path-b** child: `credentialChoice = provision_workspace`. Expect the
        route to return `child_created`, and the claim to park
        `state = pending`, `pending_reason = workspace credential not configured`,
        with a `supabase_user_id` already set (identity minted, mailbox pending).
- [ ] Record the two `child_id`s and the parent `user_id` for Phase 4.

> Note the Unit 11 confirmation-audit FINDING: FP children are created
> **first-name-only**, but the student address deriver needs a last name. Before
> this run can advance a path-b child to `complete`, confirm the child carries a
> derivable name (the follow-up fix, or a manually-set `children.last_name` on
> the test child). If the drive parks `exception` with an "underivable name"
> reason, STOP and resolve the name before enabling the credential.

## Phase 2 — Enable the credential and drive the ONE mailbox

- [ ] Set `GOOGLE_WORKSPACE_SA_KEY` in production (dedicated SA JSON).
- [ ] Trigger the FP re-drive once for the path-b child (the hourly
      `sweepPendingFpProvisioningClaims` cron, or a one-shot drive of that
      `child_id`). Watch exactly one child advance.
- [ ] OBSERVE, in order, on the path-b claim:
      1. `local_part` claimed under the DB unique arbiter (address chosen);
      2. Supabase identity present (`supabase_user_id`, already set from Phase 1);
      3. `workspace_attempted_at`/`_email` stamped **before** the insert;
      4. `users.insert` → the mailbox created in the **dedicated OU** only;
      5. `state = complete`, `mailbox_ready_at` set (deliverability confirmed).
- [ ] HANDLE the expected edge responses:
      - **409 already-exists:** a racing/prior attempt of THIS claim — the core
        classifies OU membership and ADOPTS (`didCreateMailbox=false`); do not
        create a second. If classified foreign, it advances the local part — fine.
      - **429 rate limit:** back off; the adapter/cron re-drives. Do not hammer.
      - **poll not-ready:** `isMailboxReady` returns false within its budget →
        claim stays `identity_only`/`pending`; the next drive re-checks. Wait,
        do not force.
- [ ] CONFIRM: exactly **one** new mailbox exists in the dedicated OU, matching
      the derived address; no other OU touched; the never-reissue ledger grew by
      exactly the local parts this run claimed.

## Phase 3 — Immediately DISABLE the credential

- [ ] **Unset `GOOGLE_WORKSPACE_SA_KEY`** in production again the moment the one
      mailbox is confirmed. The build's steady state is credential-OFF; leaving it
      on would let the next signup burn a mailbox unbounded.
- [ ] Verify new/other FP claims are back to parking `pending`.

## Phase 4 — R28 cleanup (mandatory; leaves no minor PII, no live mailbox)

Run the implemented service-role R28 erasure for this test family
(`eraseFamily`, wired behind the admin/CRON_SECRET gate). It executes the FK-safe
deletion order and the Workspace suspend→delete.

- [ ] With `GOOGLE_WORKSPACE_SA_KEY` **temporarily re-enabled** only for the
      duration of the erasure (the suspend+delete legs are credential-gated),
      run the erasure for the parent `user_id` from Phase 1.
- [ ] CONFIRM the deletion order ran and the tables are empty for this family:
      `fp_ledger → fp_player_saves → fp_player_profiles → path_student_profiles →
      children → auth.users`, plus `fp_parental_consent` and
      `fp_signup_attempts` removed for the attempt.
- [ ] CONFIRM the Workspace mailbox was **suspended then deleted**
      (`workspace.suspended` and `workspace.deleted` counts each 1; or `missing`
      if a prior sweep already darkened it).
- [ ] CONFIRM PII is scrubbed on any deliberately-surviving never-reissue /
      released placeholder row (the released claim keeps its local part as a
      reservation but its `email`/`supabase_user_id`/child linkage are cleared —
      the Unit 6 scrub).
- [ ] **Unset `GOOGLE_WORKSPACE_SA_KEY`** again.

## Phase 5 — Record the run

- [ ] Log: date, operator, the burned local part(s) (now permanently reserved),
      the observed 409/429/poll events, and the erasure summary. File under this
      runbook's directory or the plan's PR. The burned names are bounded to this
      run — note them so a future audit knows they are intentionally reserved.
