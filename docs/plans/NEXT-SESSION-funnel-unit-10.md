# NEXT SESSION — Funnel Unit 10: AI project composition

*Written 2026-07-28, after Unit 9 merged as PR #84 (main at `b5428af`). This is the
recovery point: if the continuous run breaks, start a fresh session from this file.*

## Where the build stands

Units 1–9 are merged (PRs #66, #68, #70, #72, #78 lock close-out, #79, #80, #81, #82, #84).
The funnel runs end-to-end for a cold visitor through the quiz: CTA → `/start` → account +
session → `/start/children` → `/start/child/[id]` with handoff → doors (persist-on-confirm)
→ templates (2/group + own idea) → quiz (4 questions, 3 band registers). `BUILT_STEPS` is
`["handoff","doors","templates","quiz"]`; compose/tasks/reveal render the coming-next stub.
Suite: 124 files / 3,263 tests; tsc, build, lint clean.

## Unit 10 scope (plan §Unit 10 — read it in full before starting)

**Goal:** the child's words become a company page, or something equally good when the model
fails. Requirements R39, R39a–R39c, R40, R40a, R40b.

- Create `app/lib/funnel/compose-rules.ts` (PURE: prompt assembly, response validation,
  the whole R40a failure taxonomy as a result→branch mapping) and
  `app/lib/funnel/actions/compose.ts` (thin `"use server"` shell).
- `generateText` + `Output.object` (Decision 6), `temperature: 0`, weak-signal fields
  nullable not required (R39b). Schema-validation failure does NOT retry in the SDK — the
  re-ask loop is explicit: ONE re-ask with the validation error appended, then the canned
  fallback. Test-first on compose-rules; assert re-ask as a CALL COUNT.
- Read `stop_reason` BEFORE `content` (safety refusal is a *successful* response).
  Truncation → fallback, never repair. Timeout/429 → back off, then fallback.
- **No child PII in the payload** (R39a): no child name, parent name, email, school, or
  internal id — asserted on the assembled payload itself. The name is substituted AFTER
  the call.
- Regeneration counted SERVER-side, max ×2 (R40); the third attempt refused server-side;
  Back does not reset the counter. This likely creates the `projects` row — check the
  schema; migrations apply to production on authoring (Management API playbook, re-read
  `supabase/MIGRATION-LOCK.md` immediately before authoring).

## Decisions already taken with Peter (do not re-ask)

- **Provider-agnostic** (2026-07-28): compose-rules stays pure with a stubbed model seam;
  provider/model comes from an env string. ZDR agreement is a Peter-owned LAUNCH
  precondition, not a build blocker.
- **Moderation is in-repo** (U9, merged): `moderateAnswers` in `app/lib/funnel/moderation.ts`
  is the named storage seam. **U10's compose action MUST pass the whole answer set through
  `moderateAnswers` before any insert, and each field through `moderateForModel` before the
  call** — U9's verification ("no stored quiz answer contains PII") is discharged only when
  this wiring exists. The reserved delimiter `RESERVED_DELIMITER` (⟦⟧) is exported there;
  the compose prompt must fence child input with it.
- Draft answers arrive from the client (MiniAppShell state) — they are UNTRUSTED input to
  the action: re-validate length/emptiness server-side (a crafted POST skips the textarea
  caps).
- Note: `moderateForModel`'s `clean` can exceed maxChars slightly after brand replacement
  ("nike" → "a big brand") — size prompt fields accordingly.

## The five steps, every unit (protect all of them)

1. Build via /ce:work discipline (pure rules first, test-first on compose-rules).
2. FULL review: 2+ parallel subagents (adversarial ALWAYS + correctness), JSON findings,
   verify-by-execution; apply safe fixes, route gated findings with documentation.
3. Full /ce:compound (docs/solutions/, schema-validated frontmatter).
4. One commit → push → PR → squash-merge (continuous-run mode: merge own PR after review
   passes); update the plan checkbox with re-measured suite counts.
5. Write `NEXT-SESSION-funnel-unit-11.md` naming Unit 11 (reveal — the only NESTED
   register swap) explicitly.

## Standing discipline (distilled across U1–U9)

1. Pure rules in `app/lib/funnel/*-rules.ts`; `server-only` cores with OPERATION-level
   deps seams; thin `"use server"` wrappers (deps never reach the wire).
2. Funnel cores NEVER import `supabaseAdmin` (asserted by scan); RLS is the authorization
   layer.
3. Raw-vs-resolved: once a resolver exists, the raw value's only consumer is the resolver.
   NEW sibling (U9): client state scoped by a server fact resets when the fact changes AND
   is re-validated at every use site.
4. Scans only for absences; behaviour by execution. Whole-set content sweeps, no named
   fixtures.
5. Tailwind v4: complete literal class strings; register swap by class name at subtree root.
6. Constant responses constant in TIMING and SHAPE.
7. Moderation false positives: harvest the honest-answer corpus from the product's own
   shipped copy (U9's top lesson — `docs/solutions/logic-errors/redaction-false-positives-*`).

## After Unit 10

U11 (reveal) → U12 (wizard rewiring — HIGHEST RISK: characterization-first, three lockstep
mirrors in one commit, Scholars must reach 100%) → U13 (offer bridge; I draft review-wait +
waitlist screens, Peter revises, factual claims flagged) → U14 (checkout/webhook, test-first;
discharge the carried 23505 catch + partial-refund `refunded_at` fix) → U16 (events; NOT
gated on U15) → U17 (nurture). U15 stays BLOCKED on the mailbox vendor (Peter).

Peter-owned open items: hero photography; ZDR agreement (U10 launch precondition); Ontario
counsel on the refund deadline; R64 mobile-first owner. Carried: bot resistance before ad
traffic; alerting on "[funnel/capture] lead ingest THREW".
