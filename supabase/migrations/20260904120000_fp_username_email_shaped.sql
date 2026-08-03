-- First Profit child usernames may now be EMAIL-SHAPED (opaque).
--
-- fp_username was constrained to `^[a-z0-9]+$`. This broadens it to also allow the
-- email-safe punctuation `@ . _ + -` in the INTERIOR, so a username can be a full
-- email address, e.g. `cedric@firstprofit.school`. Usernames are treated as OPAQUE
-- lowercase strings — NOT validated as deliverable email addresses (a `@` is just a
-- character; there is no email auth branch — see app/api/fp/login/route.ts). Must
-- START and END with an alphanumeric (no leading/trailing punctuation), bounded
-- `<= 80` to match the login request schema (identifier max 80 in login-rules.ts).
--
-- SUPERSET / SAFE: the new charset is a strict superset of `^[a-z0-9]+$`, so every
-- existing username still satisfies it — the constraint swap validates the current
-- table with no backfill and no failure. The auto-generator (fp-username-rules.ts
-- mintUsername) still emits `^[a-z0-9]+$` (now a SUBSET); this CHECK and the login
-- `USERNAME_FORMAT` regex are the broadened pair that must stay in lock-step (the
-- generator/CHECK/regex charset-agreement invariant — see the 2026-08-01 solution
-- doc). The case-insensitive unique index `children_fp_username_uidx` on
-- `lower(fp_username)` is unchanged and works for email-shaped handles.
--
-- ⚠ DEPLOY ORDERING: apply this + a PostgREST schema reload BEFORE any email-shaped
-- fp_username is WRITTEN, and deploy the login-rules change (which accepts an
-- email-shaped identifier) BEFORE a child is switched to an email-shaped username,
-- or that child cannot log in during the window. Reads are unaffected either way.
--
-- Apply via the Management API playbook (docs/solutions/integration-issues/
-- supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md); reconfirm
-- the live schema_migrations top and rename this file to the true next-free slot if
-- a migration landed between authoring and the gate. Do NOT write schema_migrations
-- by hand beyond recording this version.

do $$
begin
  alter table public.children drop constraint if exists children_fp_username_format;
  alter table public.children
    add constraint children_fp_username_format
    check (
      fp_username is null
      or (
        fp_username ~ '^[a-z0-9]([a-z0-9._+@-]*[a-z0-9])?$'
        and char_length(fp_username) <= 80
      )
    );
end $$;
