-- Dossier intake polish & approval gate (plan 2026-07-14-002, Unit 9a):
-- dedupe stamp for the admissions submission-notification email (R15).
--
-- children.submission_notified_at is SERVER-OWNED twice over:
--   1. The dashboard's childToRow never sends it (client convention).
--   2. The coerce trigger below resets any non-service-role write back to
--      the stored value — a parent REST call can neither clear the stamp
--      (to re-trigger admissions emails) nor pre-set it (to suppress the
--      notification). Mirrors children_status_guard: COERCE, never RAISE,
--      so a stale full-row echo can't blackhole legitimate sibling edits
--      (docs/solutions/database-issues/stale-status-echo-full-row-upsert-
--      vs-trigger-guard-coerce-not-raise-2026-07-14.md).
--
-- Applied PRE-DEPLOY (rollout step 1) — the notify route depends on it.
-- Apply via the Management API playbook (docs/solutions/integration-issues/
-- supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md).

alter table public.children
  add column if not exists submission_notified_at timestamptz;

create or replace function public.children_notified_guard()
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
    NEW.submission_notified_at := null;
    return NEW;
  end if;
  if NEW.submission_notified_at is distinct from OLD.submission_notified_at then
    NEW.submission_notified_at := OLD.submission_notified_at;
  end if;
  return NEW;
end;
$$;

drop trigger if exists children_notified_guard on public.children;
create trigger children_notified_guard
  before insert or update of submission_notified_at on public.children
  for each row execute function public.children_notified_guard();
