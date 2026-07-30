-- Stale-writer poison (unified application flow Phase B, 2026-07-30).
--
-- WHY: Unit 9 retired the dashboard's client-side children write path (the
-- debounced FULL-ROW upsert in app/dashboard/store.tsx childToRow). A
-- browser tab that loaded its bundle BEFORE the Phase B deploy still holds
-- that code and can silently revert the new flow's per-column saves with a
-- stale full-row snapshot for as long as the tab stays open — RLS cannot
-- distinguish it (same family, same authenticated role), and only
-- status/applicant_state are trigger-protected (adversarial review P0,
-- 2026-07-30).
--
-- THE POISON: every historical childToRow serialization names
-- `workshop_ids` unconditionally, and NO post-Phase-B code selects or
-- writes the column by that name (nurture/CRM selects dropped it in the
-- same deploy; the store reads via select("*") with `?? []` tolerance).
-- Renaming the column makes every stale-bundle upsert fail atomically
-- (PostgREST PGRST204 unknown column) — the whole write dies, no partial
-- clobber — while every deployed reader is unaffected.
--
-- APPLY ORDER: strictly AFTER the Phase B production deploy is live (the
-- split-phase migration playbook: post-deploy phase). Applying before the
-- deploy would break the then-current bundle's writes instead.
--
-- Data is preserved: legacy workshops picks stay queryable under the new
-- name (staff/archival only; the U12 completeness definition ignored them
-- since the Workshops removal).

alter table public.children
  rename column workshop_ids to workshop_ids_legacy;

comment on column public.children.workshop_ids_legacy is
  'Legacy workshops picks (pre-U12). Renamed from workshop_ids 2026-07-30 '
  'as the stale-writer poison: retired pre-Phase-B dashboard bundles '
  'serialize workshop_ids in their full-row upsert, and the rename makes '
  'those writes fail atomically instead of clobbering per-column saves.';
