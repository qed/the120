-- ─────────────────────────────────────────────────────────────────────────────
-- The Path — unique index on poster_object_path (T1 Unit 14 review fix).
--
-- Rollout phase: single pre-deploy DDL step; idempotent — safe to re-run.
--
-- Why: object_path has had a unique index since Unit 10 (one storage object,
-- one owning row), but poster_object_path shipped without one. The Unit 14
-- adversarial review showed a forged posterObjectPath aliasing ANOTHER
-- evidence row's object would let the pre-verification delete carve-out (or a
-- redaction) physically destroy a verified item's media through the alias.
-- The application now binds both paths to `{studentId}/{evidenceId}/` at
-- confirm time (the structural fix); this index is the DB-level backstop so
-- no two rows can ever claim the same poster object even if a future caller
-- forgets the check. Partial (non-null) — log/link rows carry no poster.
-- ─────────────────────────────────────────────────────────────────────────────

create unique index if not exists path_evidence_items_poster_object_path_idx
  on public.path_evidence_items (poster_object_path)
  where poster_object_path is not null;
