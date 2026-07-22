-- ─────────────────────────────────────────────────────────────────────────────
-- The Path — poster signed-URL cache columns (T1 Unit 14).
--
-- Rollout phase: single pre-deploy DDL step; apply BEFORE deploying the Unit 14
-- surfaces (the evidence read loader writes these columns). Idempotent — safe
-- to re-run.
--
-- Why: Unit 10 stored the ONE cached signed-download URL for the main object
-- (mint once, reuse until near expiry — minting per render defeats the CDN and
-- triples egress cost) but a video's POSTER frame had no equivalent columns, so
-- its URL could only be minted per render. Unit 14's read loader gives the
-- poster the same treatment: mint at confirm, cache here, remint near expiry.
--
-- Redaction blast radius (Unit 10 rule, extended): these columns are NULLED in
-- the same tombstone update that nulls signed_url — signed URLs are irrevocable
-- by design, so a surviving cached poster URL would keep a redacted child's
-- video thumbnail readable.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.path_evidence_items
  add column if not exists poster_signed_url text,
  add column if not exists poster_signed_url_expires_at timestamptz;
