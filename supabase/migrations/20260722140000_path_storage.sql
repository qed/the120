-- The Path T1 Unit 9 — media storage: private bucket + the storage.objects RLS
-- exception (Decision 1) + a family-scoped read helper.
--
-- Entirely greenfield: this repo had no Storage buckets before this migration.
-- Bytes NEVER traverse our origin (Decision 4) — the upload-slot Server Action
-- returns metadata only and the client uploads DIRECT to Supabase Storage. This
-- file creates the destination and the ONE place in Path where RLS carries real
-- policies instead of the RLS-on/zero-policies posture every other Path table
-- uses.
--
-- Apply via the Management API — `supabase db push` is dead here (no DB
-- password). See docs/solutions/integration-issues/supabase-cli-stale-db-
-- password-management-api-workaround-2026-07-13.md. After applying, verify with
--   select to_regprocedure('public.path_can_read_evidence(text)');       -- non-null
--   select to_regprocedure('public.path_student_storage_bytes(uuid)');   -- non-null
--   select id, public, file_size_limit from storage.buckets
--     where id = 'path-evidence';                                        -- one row, private, 50 MB
--   select count(*) from pg_policies
--     where schemaname='storage' and tablename='objects'
--       and policyname='path_evidence_family_read';                      -- = 1
-- THEN record this version in supabase_migrations.schema_migrations. A committed
-- migration is not an applied migration.
--
-- Depends on Unit 5 (path_student_profiles, path_role_grants). Verify
-- to_regclass('public.path_student_profiles') is non-null before applying — the
-- read helper joins it.
--
-- Rollout phase: SCHEMA + POLICY. Creates the bucket, the helper, and one policy;
-- stores no objects. Idempotent throughout (insert…on conflict / create or
-- replace / drop policy if exists) — re-applying is a no-op.
--
-- ── Prerequisite findings (run 2026-07-22, they SHAPED this file) ──────────────
--   * PLAN TIER / PER-FILE CEILING: the project's storage fileSizeLimit is
--     52428800 = exactly 50 MB (the Free-tier hard ceiling; org "Helix", pre-
--     launch). D21's provisional 500 MB per-item cap is therefore NOT storable
--     today — the native ceiling is 50 MB and larger items are link-overflow
--     (app/path/lib/upload-rules.ts MAX_STORABLE_BYTES, a single constant to flip
--     to 500 MB after a Pro upgrade raises this bucket's file_size_limit). The
--     bucket limit below is set to the ceiling so the server rejects oversize
--     uploads as defense-in-depth beyond the pure rule and the client cap.
--   * storage.allow_any_operation EXISTS but its signature is
--     (expected_operations text[]) — NOT the zero-arg form older Supabase docs
--     (and this plan) reference. The read policy uses the current form to gate
--     itself to the download operations, so it never applies to `object.list`
--     and a family member cannot enumerate the folder tree.
--   * Range requests over signed URLs return 206 (Content-Range honored) — video
--     seeking works; no player workaround needed (Units 10/14).
--
-- ── Unit 6 dormancy ───────────────────────────────────────────────────────────
-- This policy defends against an AUTHENTICATED student/parent JWT hitting the
-- storage REST API directly. Unit 6 (which mints those sessions) is NOT built
-- yet, so no caller can currently reach this policy — it is correct-but-dormant
-- by design (Decision 1). The real serving path is server-minted signed URLs,
-- which are validated against the project signing key and BYPASS RLS entirely;
-- this policy covers neither the signed-download nor the signed-upload leg. It
-- exists solely so that the day Unit 6 lands, a direct authenticated storage hit
-- is already contained.
--
-- ── Object-integrity notes for later units ────────────────────────────────────
--   * The sha256 in the object path ({student_id}/{evidence_id}/{sha256}.{ext})
--     is CLIENT-DECLARED and never verified server-side — do not assume it is an
--     integrity check.
--   * Verified evidence is made physically unoverwritable by UPSERT-DISABLED on
--     every upload leg (first completed upload wins), enforced in the action /
--     component, not here.
--   * Object DELETION must go through the Storage API, NEVER SQL — deleting a
--     storage.objects row orphans the underlying file permanently. Redaction
--     (Unit 10) and orphan reaping both obey this.

-- ─────────────────────────────────────────────────────────── the bucket ──
-- Private always. `public=false` means every read requires a signature or an
-- RLS-passing authenticated request; there is no anonymous path. file_size_limit
-- is the 50 MB tier ceiling (see prerequisite findings) — the server's last line
-- of defense against an oversize direct upload. allowed_mime_types stays NULL
-- (any) in T1: the evidence set is broad (image/pdf/audio/video) and the direct
-- TUS/plain legs declare content-type client-side; kind validation lives in the
-- pure rules, not a bucket allowlist that could silently reject a legit type.
insert into storage.buckets (id, name, public, file_size_limit)
values ('path-evidence', 'path-evidence', false, 52428800)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;

-- ─────────────────────────────────────────────── path_can_read_evidence ──
-- The FAMILY-relationship read predicate, as a SECURITY DEFINER function.
--
-- Two reasons it MUST be a security-definer function rather than an inline policy
-- subquery:
--   1. It reads public.path_student_profiles and public.path_role_grants, which
--      are RLS-enabled with ZERO policies (Decision 1). An inline subquery in the
--      storage.objects policy runs as the `authenticated` caller, for whom those
--      tables return no rows — so the predicate would deny EVERY family member.
--      This function is owned by `postgres` (BYPASSRLS), so it reads the identity
--      tables directly. `auth.uid()` still resolves to the calling user: security
--      definer changes the ROLE, not request.jwt.claims.
--   2. It centralizes the subject the plan demands stated precisely: a policy on
--      (storage.foldername(name))[1] ALONE keys on the student_id folder and would
--      grant the STUDENT and DENY the PARENT, who must read their child's
--      evidence. This mirrors resolvePathAccess({kind:'evidence'}): the student
--      themselves, EITHER parent, and a guide of the student's cohort resolve ok;
--      a SIBLING (student/family grant) does NOT — siblings see position, never
--      evidence (R5).
--
-- search_path is emptied and every object fully qualified (the hardened
-- security-definer form). object_name is text (the storage.objects.name column),
-- and sp.id is compared AS TEXT so a non-uuid first folder segment can never
-- raise a cast error inside the predicate (it simply fails to match → denied).
create or replace function public.path_can_read_evidence(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.path_student_profiles sp
    where sp.id::text = (storage.foldername(object_name))[1]
      and (
        -- the student themselves (student/student/<profile id>)
        exists (
          select 1 from public.path_role_grants g
          where g.user_id = auth.uid()
            and g.role = 'student' and g.scope_type = 'student'
            and g.scope_id = sp.id
        )
        -- either parent (parent/family/<family id>) — R4
        or exists (
          select 1 from public.path_role_grants g
          where g.user_id = auth.uid()
            and g.role = 'parent' and g.scope_type = 'family'
            and g.scope_id = sp.family_id
        )
        -- a guide of the student's cohort (guide/cohort/<cohort id>) — D25.
        -- A null cohort_id matches no guide, so an unplaced student is invisible
        -- to guides rather than visible to all of them.
        or (
          sp.cohort_id is not null and exists (
            select 1 from public.path_role_grants g
            where g.user_id = auth.uid()
              and g.role = 'guide' and g.scope_type = 'cohort'
              and g.scope_id = sp.cohort_id
          )
        )
      )
  );
$$;

-- Only the `authenticated` role ever evaluates the policy below, so only it needs
-- execute. anon (unauthenticated) and public are revoked; service_role bypasses
-- RLS and never reaches the policy.
revoke all on function public.path_can_read_evidence(text) from public;
grant execute on function public.path_can_read_evidence(text) to authenticated;

-- ─────────────────────────────────────────── path_student_storage_bytes ──
-- The quota source at slot issue (the Unit 9/10 boundary the plan asks to
-- resolve). Unit 10's EvidenceItem table does not exist yet, so per-student usage
-- is read straight off the stored objects: sum metadata.size for everything under
-- the student's {student_id}/ prefix in the bucket. No new accounting table — the
-- byte count is authoritative and naturally reconciles when the Unit 10 orphan
-- reaper deletes unconfirmed objects. A SOFT cap: an in-flight (not-yet-completed)
-- object has no size metadata and is not counted, and two concurrent slot issues
-- can each pass, so the 10 GB ceiling can be overshot slightly — acceptable for a
-- product quota (not a billing hard-stop). SECURITY DEFINER because storage.objects
-- is owned by supabase_storage_admin; service_role-only because only the slot
-- action (service role) calls it. storage.foldername indexes from 1.
create or replace function public.path_student_storage_bytes(p_student_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint
  from storage.objects o
  where o.bucket_id = 'path-evidence'
    and (storage.foldername(o.name))[1] = p_student_id::text;
$$;

revoke all on function public.path_student_storage_bytes(uuid) from public;
revoke all on function public.path_student_storage_bytes(uuid) from anon, authenticated;
grant execute on function public.path_student_storage_bytes(uuid) to service_role;

-- ─────────────────────────────────────────────── the storage.objects policy ──
-- The Decision 1 exception: storage.objects carries a REAL policy. SELECT only,
-- TO authenticated. Three ANDed clauses:
--   * bucket_id = 'path-evidence'  — scope to this bucket; other buckets unchanged.
--   * allow_any_operation([get])   — gate to the DOWNLOAD operations. Without this
--     the same policy would authorize `object.list`, letting a family member
--     enumerate every {evidence_id}/{sha256} filename under their student folder.
--     Gating to object.get_authenticated / _info means the policy authorizes
--     reading a KNOWN object but never listing.
--   * path_can_read_evidence(name) — the family predicate (runs only for the
--     download ops, and — for a single-object GET — for exactly one row).
-- No INSERT/UPDATE/DELETE policy exists, so an authenticated JWT cannot upload,
-- overwrite, or delete objects directly; those legs are server-minted (upload)
-- or service-role via the Storage API (delete).
drop policy if exists "path_evidence_family_read" on storage.objects;
create policy "path_evidence_family_read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'path-evidence'
  and storage.allow_any_operation(array['object.get_authenticated', 'object.get_authenticated_info'])
  and public.path_can_read_evidence(name)
);
