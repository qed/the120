-- First Profit funnel — Unit 17 review follow-up (R55a): STATEFUL grace.
-- The first draft's 14-day window was a pure timestamp offset — on the
-- first enabled run every backlog row went straight to the irreversible
-- pass with zero notice, and a two-week cron outage carried rows across
-- the band unlogged (the adversarial review). Grace now has MEMORY: a
-- candidate is stamped when it first surfaces, and only stamps older than
-- the grace window purge.
--
-- Lane B holds the migration lock (re-read immediately before authoring).
-- Apply via the Management API playbook.

alter table public.projects
  add column if not exists purge_noticed_at timestamptz;
