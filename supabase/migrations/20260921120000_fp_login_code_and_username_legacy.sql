-- fpv03 Unit U3c: parent-emailed 6-digit login codes + email-shaped username
-- migration support.
--
--   (1) public.fp_login_codes — a short-lived, parent-delivered 6-digit code a
--       kid can type instead of their password. Modeled on fp_handoff_codes
--       (hash at rest, single-statement CAS consume, service-role only), with
--       the 6-digit delta the repo's verify-code precedent prescribes: the
--       consume CAS is CHILD-SCOPED (child_id + code_hash), never a global hash
--       lookup, because a 6-digit code's unsalted hash collides across children
--       as an ordinary event. NOTE the deliberate DIVERGENCE from the v3 verify
--       code (fpv03 U3c review, FIX 1): there is NO durable guess counter here.
--       The v3 code guards an ATTEMPT the caller owns; a login code is reached
--       by a GUESSABLE, public username, so a per-code guess counter that locked
--       a valid code would let anyone lock a kid's only recovery door with six
--       wrong guesses. Instead the correct code always redeems and brute force
--       is bounded by the redeem rate limiter (login-code-rules).
--   (2) children.fp_username_legacy — the pre-migration username kept as a
--       login ALIAS while fp_username moves to the email-shaped
--       firstname.lastname@firstprofit.school convention (scripts/
--       migrate-fp-usernames.ts). Login resolves EITHER column.
--
-- ⚠ VERSION — AUTHORED, NOT YET APPLIED. Query the LIVE ledger immediately
--   before applying and RENAME this file to the true next-free slot:
--
--     select version, name from supabase_migrations.schema_migrations
--     order by version desc limit 5;
--
--   At authoring time the repo's top migration FILE was
--   20260920120000_fp_image_lab_cell_prompts.sql; the live ledger is the only
--   truth (supabase/MIGRATION-LOCK.md). Apply via the Management API playbook
--   (docs/solutions/integration-issues/supabase-cli-stale-db-password-
--   management-api-workaround-2026-07-13.md).
--
-- ⚠ DEPLOY ORDERING (deploy-first discipline): this migration lands BEFORE the
--   /api/fp/login-code routes and BEFORE scripts/migrate-fp-usernames.ts runs.
--   Inert until then: no code writes fp_login_codes or fp_username_legacy yet.
--
-- Idempotent throughout. Additive-only: one new table, one new column, one
-- guard-function replacement that widens coverage.

-- ───────────────────────────────────────────── (1) fp_login_codes ──────────

-- RLS POSTURE — SERVICE-ROLE ONLY: RLS enabled, ZERO policies, all grants
-- revoked from anon/authenticated (fp_handoff_codes' posture, same reason: a
-- row here is a bearer credential for a child's session).
--
-- FK POSTURE — child_id NOT NULL, ON DELETE CASCADE (fp_handoff_codes' posture,
-- same reasoning verbatim: 10-minute operational ephemera must never block an
-- erasure, and a code row for an erased child authorizes nobody).
create table if not exists public.fp_login_codes (
  id uuid primary key default gen_random_uuid(),

  child_id uuid not null references public.children (id) on delete cascade,

  -- sha256 hex of the 6-digit code. DELIBERATELY NOT UNIQUE, unlike
  -- fp_handoff_codes: at 10^6 entropy two live rows for two kids holding the
  -- same code (and therefore the same unsalted hash) is an ordinary event, so
  -- the consume CAS is CHILD-SCOPED (child_id + code_hash), never a global
  -- hash lookup — the verify-code precedent (verify-store.ts,
  -- redeemVerificationCode's docblock). The single-use claim is ONE
  -- conditional UPDATE, and it has NO guess-count arm (fpv03 U3c review, FIX 1):
  -- a correct, live, unconsumed code ALWAYS wins, so prior wrong guesses can
  -- never lock a valid code (brute force is bounded by the redeem rate limiter,
  -- not by locking codes):
  --
  --     update public.fp_login_codes
  --        set consumed_at = now(), consumed_ip = $3, consumed_ua = $4
  --      where child_id = $1
  --        and code_hash = $2
  --        and consumed_at is null
  --        and expires_at > now()
  --     returning id;
  code_hash text not null,

  created_at timestamptz not null default now(),
  -- ~10-minute TTL, stamped by the minting core (not a DB default — the TTL is
  -- a product decision that belongs next to the mint; fp_handoff_codes' rule).
  expires_at timestamptz not null,

  -- Null until consumed. The CAS flips it; it is never set twice.
  consumed_at timestamptz,

  -- Replay/abuse signal context, not access control (fp_handoff_codes' shape).
  consumed_ip text not null default '',
  consumed_ua text not null default ''
);

-- The consume CAS's key and the per-child outstanding-codes cap read.
create index if not exists fp_login_codes_child_idx
  on public.fp_login_codes (child_id);

-- The cleanup sweep's key (consumed/expired rows are kept briefly as the
-- replay-signal substrate — consumed_ip/consumed_ua — then swept by expires_at).
create index if not exists fp_login_codes_expires_at_idx
  on public.fp_login_codes (expires_at);

alter table public.fp_login_codes enable row level security;
revoke all on public.fp_login_codes from anon, authenticated;

-- ───────────────────────────── (2) children.fp_username_legacy ─────────────

alter table public.children
  add column if not exists fp_username_legacy text;

-- Same charset rules as fp_username (the login classifier normalizes ONE way
-- for both columns), same case-insensitive uniqueness, partial on NOT NULL.
-- Legacy values come only from previously-unique fp_username values (the
-- migration script moves, never copies), and post-migration fp_username values
-- all carry an '@' while legacy values never do — so the two namespaces cannot
-- collide with each other.
create unique index if not exists children_fp_username_legacy_uidx
  on public.children (lower(fp_username_legacy))
  where fp_username_legacy is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'children_fp_username_legacy_format') then
    alter table public.children
      add constraint children_fp_username_legacy_format
      check (
        fp_username_legacy is null
        or (
          fp_username_legacy ~ '^[a-z0-9]([a-z0-9._+@-]*[a-z0-9])?$'
          and char_length(fp_username_legacy) <= 80
        )
      );
  end if;
end $$;

-- Extend the server-managed guard to the legacy column: a login alias is
-- exactly as squattable as the primary handle, so the same
-- service-role-only write rule applies (20260831120000's reasoning).
-- `create or replace` swaps the function body in place; the trigger is
-- re-created to also fire on updates naming fp_username_legacy.
create or replace function public.children_fp_username_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return NEW;
  end if;
  if TG_OP = 'INSERT' then
    if NEW.fp_username is not null or NEW.fp_username_legacy is not null then
      raise exception 'fp_username is server-managed and may not be set by this client'
        using errcode = '42501';
    end if;
    return NEW;
  end if;
  if NEW.fp_username is distinct from OLD.fp_username
     or NEW.fp_username_legacy is distinct from OLD.fp_username_legacy then
    raise exception 'fp_username is server-managed and may not be changed by this client'
      using errcode = '42501';
  end if;
  return NEW;
end;
$$;

drop trigger if exists children_fp_username_guard on public.children;
create trigger children_fp_username_guard
  before insert or update of fp_username, fp_username_legacy on public.children
  for each row execute function public.children_fp_username_guard();
