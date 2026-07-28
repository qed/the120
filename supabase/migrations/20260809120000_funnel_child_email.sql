-- First Profit funnel — Unit 12 (plan 2026-07-27-002, R48): the application
-- asks for the child's email, with "Don't have one" recording the FLAG
-- without an address. Deliberately NOT a checklist/completeness column —
-- asked, never required, so the three lockstep mirrors are untouched.
--
-- Lane B holds the migration lock (supabase/MIGRATION-LOCK.md — re-read
-- immediately before authoring; see the lock file for the 20260808120000
-- version collision recorded alongside this migration). Apply via the
-- Management API playbook.

alter table public.children
  add column if not exists child_email text not null default '';

alter table public.children
  add column if not exists child_email_none boolean not null default false;
