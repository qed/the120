# The 120 GTM — Session Summary & Deliverables Index
*2026-07-20 · Week 1 evaluation + Week 2 build*

## Where everything lives
All files are in `…\120-The120\artifacts\gtm\` (root) unless noted.

**Tracking**
- `The120-GTM-Tracker.xlsx` — Week 1 scorecard · funnel (plan vs. actual) · 8-week tracker (fill the yellow cells each Friday; it auto-flags any week >30% under) · working-vs-not + actions.

**The plan**
- `gtm-8-week-sprint.md` — updated master plan. Start at **"0. Change Log"** (top) for what changed and why.
- `plan-changes.html` — color-coded diff (green added / red removed) of the plan edits.
- `Previous\gtm-plan-original.md` — pre-edit backup.

**One-pager (to circulate)**
- `One page explainer.pdf` — branded, exactly one page.
- `One page explainer content.md` — the copy source of truth.

**Welcome email**
- `welcome-email-1.html` — branded HTML, load into Resend (merge `{{parent_first}}`, `{{unsubscribe_url}}`).
- `welcome-email-1.txt` — plain-text part.
- `w2-welcome-email-1.md` — copy + setup/subject/preheader notes.
- `w2-welcome-email-trigger-spec.md` — dev spec (fire-on-signup) → Ethan.

**Ambassadors**
- `w2-ambassador-kit.md` — kid one-pager, referral-code card, parent consent note.
- `w2-ambassador-kickoff-agenda.md` — 45-min kickoff run-of-show for this week.

**For Ethan (dev)**
- `w2-gauntlet-sharecard-design-brief.md` — the Gauntlet share card.
- `w2-pipeline-stages-spec.md` — add Conversation → Call Booked → Call Held to the CRM pipeline.

## Week 1 verdict
Ahead on demand, behind on the machinery that scales it. The machine shipped (booking, live Stripe with a real $250 deposit, domain, signup source field). Warm network converts **~80% message→call** (26 messaged → 16 conversations → 8 calls held). **33 families, 2 dossiers, 1 deposit** — deposits weren't due until W4. Misses: ambassadors at 0 and the welcome email (now shipped). Free signal: 3 inbound strangers from your X posts.

## Week 2 plan (adjusted)
Primary push = **protect/expand the warm engine (+10 families)**; **personally seed 5 ambassadors** (stretch 12–15 if Ethan leads — decide Monday); ship the two dev specs to Ethan; welcome email live; one-pager circulating.

## Your next actions (this week)
Pulled from the plan's "Do This Monday (Jul 20)":
- Message the ~6 unsent warm contacts; rebuild the list past 25.
- Ask each of the 8 warm families for two introductions.
- Confirm Ethan on the head-ambassador role (by Tue).
- Seed the 5 ambassador families; schedule the 45-min kickoff for a weekday evening.
- Hand Ethan the share-card brief + pipeline spec.
- Load welcome email #1 into Resend, test, wire the trigger.
- Friday: update the tracker vs. targets.

## Open decisions to watch
- **Ethan** as head ambassador (gates the 12–15 push vs. slip to W3).
- **X inbound** — small but free; worth a deliberate test.
- **Two cohorts (8–13 / 14–17) + The Path** — now on the one-pager and in the welcome email; propagate to the site/other assets when you touch them.
