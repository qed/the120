-- New User Flow v3 (Unit 1): the additive columns — the 6-digit email
-- verification CODE mode on fp_signup_attempts, the per-child photo-consent
-- revocation TOMBSTONE, and the carried cover fields on children. Plan:
-- docs/plans/2026-08-05-001-feat-new-user-flow-v3-plan.md ("6-digit code follows
-- verify-store's CAS discipline but NOT its entropy assumptions" and "Two
-- consent anchors, not one").
--
-- ⚠ VERSION — AUTHORED, NOT YET APPLIED, AND THE LIVE LEDGER WAS NOT READABLE
--   AT AUTHORING TIME. The canonical pre-authoring query
--
--     select version, name from supabase_migrations.schema_migrations
--     order by version desc limit 5;
--
--   COULD NOT BE RUN when this file was written (the SUPABASE_ACCESS_TOKEN in
--   .env.local returns 401 — a dead token), so this slot is PROVISIONAL and
--   derived only from the repo file listing (top: 20260911120000
--   fp_save_doc_guard_tombstones), which docs/LANES.md says is explicitly NOT
--   the truth. RUN THE QUERY IMMEDIATELY BEFORE APPLYING and RENAME this file —
--   keeping it ordered AFTER 20260912120000_fp_v3_onboarding_drafts and
--   20260913120000_fp_v3_handoff_codes — if the version is taken. Apply via the
--   Management API playbook (docs/solutions/integration-issues/
--   supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md).
--
-- AMENDMENT LOG (in-place amendments allowed ONLY while this file is
--   branch-only / never applied):
--   * (none yet — initial authoring.)
--
-- ⚠ DEPLOY ORDERING: lands BEFORE Unit 2's code-mode verify-store and Unit 4's
--   photo gate. Purely additive nullable columns (plus two DEFAULT 0 counters),
--   so applying it against the live schema changes NO existing behavior: today's
--   link-token signup path never reads or writes any of these.
--
-- RLS POSTURE UNCHANGED. fp_signup_attempts stays RLS-on / zero-policies /
--   revoked (20260829120000). public.children keeps its existing policies —
--   this migration adds NO policy and grants NOTHING; the new columns inherit
--   whatever the table's existing posture already permits, and every writer of
--   them is service-role code.
--
-- POPULATED-TABLE RULE (public.children). children HAS rows in production. The
--   repo rule — established by 20260830120000_fp_consent_hardening's header — is
--   that a CHECK added to a POPULATED table must be added `NOT VALID` in one
--   migration and `VALIDATE`d in a SEPARATE later one, because the whole file is
--   POSTed as ONE Management-API query (one implicit transaction) and a VALIDATE
--   in the same transaction would run under the ACCESS EXCLUSIVE lock the ADD
--   already took, buying no concurrency and only adding moving parts.
--   THIS MIGRATION ADDS NO CHECK TO children AT ALL, deliberately. The three new
--   children columns are nullable text / a defaulted counter; a NOT VALID
--   constraint we do not need would only create a follow-up VALIDATE migration
--   to remember. fp_cover_status is validated in the app (the same status
--   vocabulary as fp_onboarding_drafts.cover_status, 20260912120000) and written
--   only by service-role code. If a CHECK is ever wanted here, it must follow
--   the NOT VALID + separate VALIDATE split.
--   ADD COLUMN ... DEFAULT 0 NOT NULL is safe and instant on a populated table
--   in PG 11+ (non-volatile defaults are stored in the catalog, not rewritten
--   into every row).
--
-- Idempotent throughout (add column if not exists). Additive-only.

-- ==========================================================================
-- (a) fp_signup_attempts: the 6-digit CODE mode, in its OWN columns
-- ==========================================================================
-- ⚠ THESE ARE DEDICATED COLUMNS AND MUST NEVER BE MERGED WITH
--   verification_token_hash / verification_expires_at. The reason is not
--   tidiness, it is a live-traffic hazard:
--
--   There are TWO front doors minting email secrets against this SAME table.
--   The firstprofit.school HTTP signup path (app/api/fp/signup) stays LIVE and
--   keeps using LINK tokens in verification_token_hash /
--   verification_expires_at. The new v3 /start path uses a typed 6-digit CODE.
--   If the two modes shared columns, a family who started at one front door and
--   then started at the other with the SAME EMAIL would have the second start
--   OVERWRITE the first's pending secret — the emailed link in their inbox would
--   silently stop working, or the code they were typing would be clobbered
--   mid-flow, with no error anywhere. Separate columns make that impossible by
--   construction: each mode touches only its own, resume logic dispatches on
--   which mode's columns are set, and the link path is byte-for-byte untouched.
--
-- ⚠ THE REDEEM CAS FOR THE CODE MUST BE SCOPED TO THE CALLER'S ATTEMPT ID:
--
--     update public.fp_signup_attempts
--        set verified_at = now(), state = 'verified'
--      where id = :attemptId
--        and verification_code_hash = :codeHash
--        and code_expires_at > now()
--        and verified_at is null
--     returning id;
--
--   NOT the global-hash lookup the LINK token uses. The link token is 256 bits,
--   so its hash is globally unique in practice and `where
--   verification_token_hash = $1` is safe. A 6-digit code is 10^6 of entropy:
--   with even a few hundred concurrent pending attempts, two of them holding the
--   SAME code (and therefore the same hash — the hash is deterministic, not
--   salted) is an ordinary event, not a cryptographic curiosity. A global-hash
--   CAS would then verify ANOTHER FAMILY'S attempt with a code the caller
--   legitimately received. Scoping to `id = :attemptId` makes a collision
--   harmless.
--
-- ⚠ HASH-AT-REST IS NOT A MEANINGFUL CONTROL AT 10^6 ENTROPY. Anyone holding
--   this column can enumerate all one million preimages in milliseconds. It is
--   stored hashed for consistency with the link token and to avoid a plaintext
--   secret in a backup, and that is all it buys. THE ACTUAL CONTROLS ARE:
--     (1) the SHORT TTL in code_expires_at (10 minutes), and
--     (2) the DURABLE guess counter in code_guess_count — atomically
--         incremented on every wrong guess, locking out at the cap. It is
--         durable ON THE ROW precisely because the in-memory rate limiter
--         (app/fp/lib/rate-limit-store.ts) is per-instance and empty on cold
--         start, so it is a volumetric backstop only and cannot be the
--         load-bearing guess cap. A resend issues a FRESH code (voiding prior
--         codes) but deliberately does NOT reset this counter — otherwise
--         "resend" is an unlimited-guesses button.

alter table public.fp_signup_attempts
  add column if not exists verification_code_hash text;

alter table public.fp_signup_attempts
  add column if not exists code_expires_at timestamptz;

alter table public.fp_signup_attempts
  add column if not exists code_guess_count int not null default 0;

-- NO index on verification_code_hash, and NO unique constraint on it — both
-- would be wrong. The redeem CAS is keyed on the PRIMARY KEY (id), so there is
-- nothing to index; and UNIQUE would be actively harmful, since two independent
-- families legitimately holding the same 6-digit code is expected at this
-- entropy and must not make the second mint fail.

-- ==========================================================================
-- (b) children: the per-child PHOTO-CONSENT REVOCATION TOMBSTONE
-- ==========================================================================
-- The photo/cover gate is an EXISTS query over the child's ACTIVE consent rows
-- (per-child active consents are legitimately PLURAL: per-attempt uniqueness,
-- the add-another-kid loop, and attempt-less legacy capture rows that escape the
-- partial unique index). Revocation sweeps every active row for the child by
-- stamping revoked_at.
--
-- The sweep ALONE is not sufficient, and this column is why. Revocation and a
-- consent capture already in flight race: the sweep reads the set of active
-- rows, the in-flight capture INSERTS a new active row after that read, and the
-- sweep commits having missed it. The child now has an unrevoked consent row and
-- the photo gate is SILENTLY RE-OPENED against an explicit parental instruction
-- to close it — the worst possible failure direction for this feature.
--
-- The tombstone closes it: revocation stamps this timestamp on the CHILD, and
-- the gate counts a consent row ONLY if it was accepted STRICTLY AFTER the
-- latest tombstone. The in-flight row lands with accepted_at at or before the
-- stamp and is therefore ignored, no matter which of the two writes commits
-- first. Re-consenting later writes a NEW row after the tombstone and re-opens
-- the gate deliberately, which is exactly the intended behavior.
--
-- Null = never revoked. The gate helper is photoConsentVerdict() in
-- app/api/fp/signup/consent-rules.ts, which takes this value as `revokedAt`.
alter table public.children
  add column if not exists photo_consent_revoked_at timestamptz;

-- ==========================================================================
-- (c) children: the cover fields CARRIED from the draft at provisioning
-- ==========================================================================
-- Mirrors fp_onboarding_drafts' cover columns (20260912120000). At provisioning
-- these are carried from the draft, and the COVER BLOB IS COPIED to a
-- CHILD-NAMESPACED key rather than the child pointing at the draft's key — so
-- the draft can be reaped (blobs deleted) with no possibility of leaving a live
-- child referencing a deleted blob, and with no shared-key ambiguity about who
-- owns the object. See app/fp/lib/cover-store-rules.ts.
--
-- fp_cover_status carries the SAME vocabulary as the draft's cover_status
-- ('none' | 'generating' | 'final' | 'fallback_pending_regen' |
--  'fallback_permanent' | 'cap_exhausted' | 'reaped'); it is nullable here
-- because every child that predates v3 has no cover at all, and NULL says that
-- more honestly than a backfilled 'none'. Deliberately unconstrained in the DB
-- (see the POPULATED-TABLE RULE block at the top).
alter table public.children
  add column if not exists fp_cover_blob_key text;

alter table public.children
  add column if not exists fp_cover_status text;

-- The per-kid generation cap, carried from the draft so the cap survives
-- provisioning (a family cannot reset their vendor spend by finishing signup).
-- DEFAULT 0 NOT NULL is instant on this populated table in PG 11+.
alter table public.children
  add column if not exists fp_cover_generation_count int not null default 0;
