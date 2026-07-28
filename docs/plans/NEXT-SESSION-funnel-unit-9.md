Continue the First Profit funnel build in C:\Users\pkupe\Aardvark\120-funnel.

Single-lane operation (Lane A finished; Lane B holds the migration lock —
`supabase/MIGRATION-LOCK.md`, re-read it immediately before authoring any migration).

## State
`main` at `ceb21d1` (funnel U8, PR #82). **Units 1–8 all merged** (PRs #66, #68, #70,
#72, #78–#82). **122 files / 3227 tests**, `tsc` / build / lint clean.

The funnel runs end-to-end for a cold visitor: CTA → `/start` (explainer, capture,
consent) → account+session (RLS authorizes everything) → `/start/children` (add, active
child) → `/start/child/[id]` (handoff seam, doors — group persists on confirm at
`applicant_state "added"` only). Steps past doors render a stub behind
`miniapp-rules.BUILT_STEPS` — **U9–U11 flip that one list as they land.**

## Decisions already taken with Peter (2026-07-28) — do not re-ask
- **U9 moderation = in-repo rules module** (profanity, PII redaction, length caps,
  delimiter rejection). No vendor.
- **U10 = provider-agnostic**: compose-rules pure with a stubbed model; the
  `provider/model` string from env; ZDR agreement is a launch precondition Peter owns.
- **U13's review-wait and waitlist screens: draft them, Peter revises.** Flag every
  factual claim (review turnaround, waitlist promise).

## Do this next: Unit 9 — templates, quiz, moderation (R37, R38, R41, R39a)
Plan section Unit 9. Files: `app/start/child/[childId]/` quiz components (client),
`app/lib/funnel/quiz-rules.ts`, `app/lib/funnel/moderation.ts` (+ a quiz/answers core if
writes are needed — quiz answers persist on `projects.quiz_answers`? NO: the projects
row is created at compose (U10). Decide where draft answers live — likely client state
carried into compose, since refresh-loss is bounded and R40's counter is server-side.
Say which you chose and why).

Key requirements: two templates per group + own-idea box (copy from the interactive
brief §8.2 — `artifacts/First Profit/the-120-interactive-application-design-brief.md`);
suggestions are grey placeholders NEVER pre-typed (a pre-typed answer is the child's
answer to every downstream system); four questions per group, band-phrased (Trail
parent-assist flagged, HQ not); moderation before storage AND before any model call
(emails, phones, addresses redacted; profanity; brand names; reserved delimiter
rejected; length caps). Plan's verification: no stored answer contains PII the pass is
specified to catch, against an adversarial corpus.

## The standing discipline (hard-won this build — keep it)
1. Rules pure in `app/lib/funnel/*-rules.ts`; cores `server-only` with op-level deps
   seams; thin `"use server"` wrappers. Scans only for absences; behaviour by execution.
2. RLS is the authorization: user-session clients, never `supabaseAdmin`, in funnel
   cores (asserted by scan in each test file).
3. URL is the single source for step state; `go()` merges the query (the `?g=` hint
   must survive).
4. Raw vs resolved: once a resolver exists, the raw value's only consumer is the
   resolver.
5. A shared component must not hold a value that varies by mount site.
6. `docs/solutions/` — read the six ROUNDs of the source-scanning doc before writing
   any scan.
7. Five steps per unit: build → full review (2+ agents, adversarial always) → compound
   → rebase/PR/squash-merge (standing authorization) → next handoff. Update the plan
   checkbox with counts.

## After U9
U10 (compose, provider-agnostic) → U11 (reveal; NESTED register swap — the only screen
mixing both registers) → U12 (wizard rewiring — **the highest-risk unit**: three
lockstep checklist mirrors change in one commit, characterization-first) → U13 (offer
bridge + the two drafted screens) → U14 (checkout/webhook — discharge the carried 23505
handler + partial-refund fix; test-first, money) → U16 (events; NOT gated on U15) →
U17 (nurture/retention). **U15 stays blocked on the mailbox vendor + address
convention.** Remaining Peter items: hero photography (slots ship blue), counsel on the
refund deadline, R64 owner.
