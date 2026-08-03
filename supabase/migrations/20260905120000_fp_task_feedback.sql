-- First Profit game — fp_task_feedback: the per-task "Stuck? Tell us" cohort
-- feedback instrument (first-profit repo, plan
-- docs/plans/2026-08-03-001-feat-full-path-cohort-readiness-plan.md, Unit 1).
-- A child session INSERTs one row per stuck report directly via PostgREST
-- (client-minted uuid, same outbox/idempotency discipline as fp_ledger); the
-- OWNER reads rows via service credentials only. Children can never read,
-- update, or delete feedback — not even their own.
--
-- ⚠ VERSION — AUTHORED, NOT YET APPLIED. The placeholder slot below assumes the
--   top of supabase_migrations.schema_migrations is still 20260904120000
--   fp_username_email_shaped (the latest file in this tree at authoring time).
--   The TRUE next-free slot MUST be reconfirmed against the LIVE ledger
--   immediately before applying (a migration may have landed between authoring
--   and the gate). If the live top is not 20260904120000, RENAME this file to
--   the real next-free 12:00:00 slot before applying. Apply via the Management
--   API playbook (docs/solutions/integration-issues/
--   supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md).
--   Do NOT write schema_migrations by hand.
--
-- ⚠ DEPLOY ORDERING (silent-report-loss hazard): this table AND a PostgREST
--   schema-cache reload MUST be live in prod BEFORE the first-profit client
--   that writes to it deploys. If the client ships first — or a report lands
--   during the schema-cache reload window — the insert fails with PGRST205
--   ("could not find the table ... in the schema cache") or Postgres 42P01
--   (undefined_table). The FP client classifies those as RETRYABLE (parked in
--   the outbox, replayed once the table is live) — but only the client build
--   that KNOWS this table carries that classification, so the ordering still
--   holds: apply + schema-reload here → verify table visible → deploy FP.
--
-- ⚠ DELETE POSTURE — a DELIBERATE DIVERGENCE from fp_ledger AND
--   fp_player_saves (both `on delete restrict`): profile_id here is
--   ON DELETE CASCADE. Feedback is a cohort research instrument about a
--   child's experience, not game state or money — per requirement R14 it DIES
--   WITH THE PROFILE. The FP-aware deletion runbook (ledger → saves → profile
--   → child) therefore needs NO fp_task_feedback step: deleting the profile
--   sweeps its feedback automatically. Do not "fix" this to RESTRICT.
--
-- RETENTION (~12-month purge ritual, review decision): feedback rows expire
--   roughly 12 months after creation, INDEPENDENT of account deletion. No
--   pg_cron dependency — the owner runs the purge script periodically (service
--   role, e.g. quarterly, alongside the R25 ledger purge review):
--
--     npx tsx scripts/purge-fp-task-feedback.ts             # dry-run: count only
--     npx tsx scripts/purge-fp-task-feedback.ts --confirm   # batched delete
--
--   The script is DRY-RUN by default and deletes in id-selected batches (WAL
--   discipline). What it does, as SQL:
--
--     -- delete from public.fp_task_feedback
--     --  where created_at < now() - interval '12 months';
--
--   (The append-only trigger below exempts service_role AND JWT-less sessions,
--   so this DELETE runs.)
--
-- ACCEPTED RISK (R20-style, kid-data): the client-side UI hint ("no names or
--   addresses"), the 1000-char CHECK, and the daily cap are the ONLY
--   pre-storage PII mitigations for this owner-read cohort instrument. A child
--   may still type PII into `body`; the mitigation is owner-read-only access,
--   the retention purge above, and cascade deletion with the profile. Recorded
--   against the first-profit R20 exposure doc in that repo's Unit 9.
--
-- CLIENT CONTRACT NOTES:
--   * The client must insert with `Prefer: return=minimal` (supabase-js:
--     .insert() WITHOUT .select()). There is no SELECT grant or policy, so a
--     returning insert would fail with 42501 even though the row landed.
--   * A duplicate client-minted id fails 23505 — the client classifies that as
--     SUCCESS (outbox retry idempotency), same as fp_ledger. BECAUSE 23505 is
--     treated as success, the client MUST mint ids with crypto.randomUUID()
--     (collision-resistant); a weaker generator would silently swallow distinct
--     reports as "already sent".
--   * DAILY CAP → SQLSTATE 'FP429' (custom class, raised by the cap trigger
--     below). The client contract: FP429 = capped → show an honest "could not
--     send" (never "saved"), never park in the outbox, never silent-drop. It
--     must NOT fall into the default P0001 terminal-drop path: a capped report
--     can be legitimate (two devices; a local cap mirror desynced), so the
--     child must see the truth rather than a fake success or silence.
--   * 23503 (FK violation on profile_id) → RETRYABLE-park. A brand-new child's
--     first tap can race the service-role profile provisioning; that timing
--     gap is transient, so the client parks the report in the outbox and
--     replays it once the profile exists.
--   * task_id charset agreement (nesting invariant, see docs/solutions/
--     best-practices/broadening-a-shared-charset-...-2026-08-04.md): the
--     producer (the FP client's task-id synthesizer / generated content ids,
--     e.g. "1.2.5") must stay a SUBSET of the CHECK below; the client-side
--     mirror regex must EQUAL it. Do not narrow the CHECK without auditing the
--     producer first. TS mirror: app/fp/lib/fp-task-feedback-rules.ts (parity
--     test: app/fp/lib/__tests__/fp-task-feedback-migration-parity.test.ts).
--
-- Idempotent throughout (create ... if not exists / drop-and-create for
-- policies, triggers, functions) — re-applying is a no-op. Additive-only.

-- ---------------------------------------------------------- fp_task_feedback
create table if not exists public.fp_task_feedback (
  -- client-generated uuid so outbox retries are idempotent (a duplicate id is
  -- classified as success client-side, never a retry storm). NO default on
  -- purpose: the id is the client's idempotency key and must come from it.
  id uuid primary key,
  -- CASCADE, not restrict — see the DELETE POSTURE divergence note above.
  profile_id uuid not null references public.fp_player_profiles (id) on delete cascade,
  -- the brief's task number ("1.2.5"): three dot-separated integer components.
  -- Length-bounded (bounding discipline, like payer <= 80 on fp_ledger).
  task_id text not null
    check (task_id ~ '^[0-9]+(\.[0-9]+){2}$' and char_length(task_id) <= 16),
  -- the grade band the task text was rendered in when the child got stuck.
  -- 'unknown' = band was defaulted, not derived from a real grade (keeps the
  -- owner's band analysis unbiased).
  band text not null check (band in ('g3_5', 'g6_8', 'g9_12', 'unknown')),
  -- EMPTY STRING ALLOWED — a tap with no words is valid "I'm stuck here"
  -- signal (R11/R13). Only the upper bound is constrained.
  body text not null default '' check (char_length(body) <= 1000),
  -- server-managed: excluded from the insert grant below, so it can only take
  -- this default (the WITH-CHECK-pins-values-not-columns learning).
  created_at timestamptz not null default now()
);

-- Postgres does not auto-index FK columns; the daily-cap trigger's count, the
-- owner's per-child reads, and the retention purge all filter on
-- (profile_id, created_at).
create index if not exists fp_task_feedback_profile_id_created_at_idx
  on public.fp_task_feedback (profile_id, created_at);

-- ------------------------------------------------------- append-only trigger
-- Append-only is STRUCTURAL, not merely policy-absence (fp_ledger discipline).
-- service_role may still update/delete (the retention purge above, and any
-- future PII-scrub request).
--
-- THREAT MODEL / who this guard is for: it is belt-and-suspenders against
-- POSTGREST CLIENTS specifically (a child JWT reaching UPDATE/DELETE despite
-- RLS + the revoked grants). It must therefore ALSO allow any session that
-- carries NO PostgREST JWT at all — request.jwt.claims unset or empty. Such a
-- session is by definition not a PostgREST client: it is the Supabase
-- dashboard SQL editor, a maintenance script connected as postgres, or an
-- Admin-API-triggered cascade. Without this allowance, a CASCADEd DELETE from
-- an fp_player_profiles delete executed in one of those non-PostgREST
-- contexts (which carry no service-role JWT, so auth.role() is not
-- 'service_role') would fire this row-level guard and ABORT the whole profile
-- deletion. RLS + the revoked grants still block actual child clients; every
-- PostgREST request always carries request.jwt.claims, so this opens nothing
-- to them.
create or replace function public.fp_task_feedback_append_only_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role'
     or current_setting('request.jwt.claims', true) is null
     or current_setting('request.jwt.claims', true) = '' then
    if TG_OP = 'DELETE' then
      return OLD;
    end if;
    return NEW;
  end if;
  raise exception 'fp_task_feedback is append-only';
end;
$$;

drop trigger if exists fp_task_feedback_append_only_guard on public.fp_task_feedback;
create trigger fp_task_feedback_append_only_guard
  before update or delete on public.fp_task_feedback
  for each row execute function public.fp_task_feedback_append_only_guard();

-- --------------------------------------------------------- daily-cap trigger
-- Per-child abuse bound: max 50 feedback rows per profile per UTC day. This
-- lives in the DATABASE because the client writes via PostgREST directly —
-- the in-memory API rate limiter never sees these inserts.
--
-- LOCKING (the cross-table-trigger-guard learning, docs/solutions/
-- database-issues/a-cross-table-trigger-guard-must-lock-the-row-it-reads-for-
-- share-2026-07-29.md, refined): the value this guard trusts is a COUNT of
-- rows in the SAME table, so there is no single existing row whose lock can
-- order the read — two concurrent inserts at 49 rows would each count 49 and
-- both commit (51 total). We therefore take the lock on the one row every
-- insert for this profile shares — the fp_player_profiles row — and it must be
-- FOR UPDATE, not FOR SHARE: FOR SHARE locks are mutually compatible, so two
-- concurrent guards would both hold it and the count race would survive.
-- FOR UPDATE serializes count-then-insert per profile (per-profile write
-- volume is one child's taps; the contention is negligible). The learning's
-- FOR SHARE prescription targets trusting a cross-table VALUE against a
-- concurrent writer of that row; here the trusted value is the same-table
-- count, so the lock must be exclusive to impose the ordering.
--
-- Lock-order note (same learning, corrected in review): an INSERT locks no
-- fp_task_feedback row — the ONLY lock this guard takes is the
-- fp_player_profiles row (the per-profile mutex; the new tuple is not yet
-- visible to anyone and carries no lock another transaction can wait on). The
-- ordering obligation for the future is therefore: any multi-statement
-- transaction that will BOTH insert fp_task_feedback rows AND touch
-- fp_player_profiles rows must acquire the fp_player_profiles row FIRST (as
-- this guard does), so it cannot deadlock against a concurrent insert's guard.
--
-- The lock also makes the FK race moot: a profile mid-delete blocks here, then
-- the re-check finds it gone and refuses (or the FK does).
--
-- OWNERSHIP GATE (cross-tenant oracle, security review P1): this is a
-- BEFORE-ROW trigger, so it fires BEFORE the RLS WITH CHECK is evaluated.
-- Without a gate, a child inserting against a FOREIGN profile_id would reach
-- the lookup/count below and could distinguish outcomes for a profile they do
-- not own (FK error shape vs cap raise vs RLS denial) — an existence/cap-state
-- oracle across tenants. So: for any profile the caller does not own, return
-- NEW immediately and SILENTLY, doing no lookup and no count — the RLS WITH
-- CHECK then rejects the row and produces the ONE uniform denial shape for
-- every foreign profile, owned-elsewhere and nonexistent alike.
create or replace function public.fp_task_feedback_daily_cap_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_count integer;
begin
  if auth.role() = 'service_role' then
    return NEW;
  end if;
  if NEW.profile_id not in (
    select id from public.fp_player_profiles
    where user_id = (select auth.uid())
  ) then
    -- Not the caller's profile (or no such profile): stand aside silently and
    -- let the RLS WITH CHECK produce the uniform denial. See OWNERSHIP GATE.
    return NEW;
  end if;
  select id into v_profile
    from public.fp_player_profiles
   where id = NEW.profile_id
     for update;
  if v_profile is null then
    -- no such profile; let the FK produce the canonical error shape.
    return NEW;
  end if;
  -- Day window pinned to REAL UTC, independent of the session timezone: the
  -- truncation wraps only now() (the boundary constant), never the column, so
  -- the predicate stays sargable on created_at and the
  -- (profile_id, created_at) index still serves it (profile_id prefix + range
  -- scan on created_at).
  select count(*) into v_count
    from public.fp_task_feedback
   where profile_id = NEW.profile_id
     and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  if v_count >= 50 then
    -- Distinct SQLSTATE so the SPA outbox can tell "capped" apart from the
    -- default P0001 terminal-drop class — see CLIENT CONTRACT NOTES (FP429:
    -- honest "could not send", never parked, never silently dropped).
    raise exception 'fp_task_feedback: daily feedback cap reached'
      using errcode = 'FP429';
  end if;
  return NEW;
end;
$$;

drop trigger if exists fp_task_feedback_daily_cap_guard on public.fp_task_feedback;
create trigger fp_task_feedback_daily_cap_guard
  before insert on public.fp_task_feedback
  for each row execute function public.fp_task_feedback_daily_cap_guard();

-- ------------------------------------------------------------- RLS + grants
-- Default-deny, then the ONE narrow grant. Per-command policies only (never
-- FOR ALL — the funnel FOR-ALL precedent is a known hazard, see the
-- fp_player_tables header). Children get INSERT and nothing else: no SELECT
-- (the owner reads via service role), no UPDATE/DELETE (append-only). The
-- insert grant is COLUMN-SCOPED so created_at stays server-managed — an RLS
-- WITH CHECK pins values, not which columns a client may set (docs/solutions/
-- security-issues/rls-with-check-pins-values-not-columns-column-scope-the-
-- grant-to-protect-created-at-2026-07-31.md).
alter table public.fp_task_feedback enable row level security;

revoke all on public.fp_task_feedback from anon, authenticated;
grant insert (id, profile_id, task_id, band, body)
  on public.fp_task_feedback to authenticated;

-- The single policy: a child may insert rows only against their OWN profile.
-- Explicit WITH CHECK carrying the same ownership predicate as the other FP
-- child-scoped policies (fp_player_saves / fp_ledger).
drop policy if exists "fp feedback: insert own" on public.fp_task_feedback;
create policy "fp feedback: insert own" on public.fp_task_feedback
  for insert to authenticated
  with check (
    profile_id in (
      select id from public.fp_player_profiles
      where user_id = (select auth.uid())
    )
  );

-- NO select/update/delete policies for authenticated — deliberate, not an
-- omission (the rls-enabled-zero-policies learning requires this to be said
-- out loud): children write reports, only the owner reads them. The owner's
-- read is service-role (bypasses RLS) via the reader script:
--
--   npx tsx scripts/read-fp-task-feedback.ts [--days N]
--
-- which joins profile handle + child name/grade, newest first. What it does,
-- as SQL:
--
--   -- select f.task_id, f.band, f.body, f.created_at, p.handle,
--   --        c.first_name, c.grade
--   --   from public.fp_task_feedback f
--   --   join public.fp_player_profiles p on p.id = f.profile_id
--   --   left join public.children c on c.id = p.child_id
--   --  order by f.created_at desc;
