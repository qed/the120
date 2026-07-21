---
date: 2026-07-21
topic: the-path-app
---

# The Path — App Build Requirements

## Problem Frame

The Path is The 120's entrepreneurship curriculum: 5 phases, 25 pass criteria, 125 unit tasks, every one of them done in the real world and verified by a real adult. Today that curriculum exists only as prose — `artifacts/The Path/the-path-home-study-curriculum-brief.md` — and as a marketing section on the program page (`app/2026-27/sections/ThePath.tsx`). A family running it has no way to see where their child is, no place to file the evidence that proves a task happened, no verification trail, and no moment of celebration when a criterion falls. The record of a year's work lives in a binder or a Drive folder, or nowhere.

This document specifies the app that fixes that, at `/path`. It does **not** restate the product design — `artifacts/The Path/the-path-app-design-brief.md` is the source of truth for behavior and tone, and `artifacts/The Path/The Path design handoff/design_handoff_the_path_app/` is the visual contract. This document is the **delta layer**: the decisions made on 2026-07-21 that resolve the brief's open items, amend its platform posture, and draw the boundary of this build.

### Source-of-truth chain

| Layer | Authority | Location |
|---|---|---|
| Content — 125 tasks, Done-when lines, band variants | Curriculum brief | `artifacts/The Path/the-path-home-study-curriculum-brief.md` |
| Content — 25 pass criteria, both copy registers | Typed and unit-tested in-repo | `app/2026-27/data.ts`, `app/2026-27/path-criteria.ts` |
| Behavior — states, reviews, roles, AI rules | App design brief Part Two | `artifacts/The Path/the-path-app-design-brief.md` |
| Tone and register | App design brief Part One | same |
| Visual system, component contracts, tokens, copy | Design handoff | `artifacts/The Path/The Path design handoff/design_handoff_the_path_app/` |
| Platform, identity, scope | **This document** | here |

Where this document and the app design brief conflict, **this document wins** — it was written later and with the codebase in hand.

## Requirements

**Identity and accounts**

- R1. Every student has their own real authentication account. Parents provision them; students do not self-register.
- R2. Under-13 accounts are created by the parent with a system-generated address and a parent-set password. The child's sign-in surface shows a **name and a password — never an email address**. Students aged 13–17 use their own email address, with full parent visibility per the brief's privacy rules.
- R3. Student and parent must be able to hold independent, simultaneous sessions on separate devices. The core loop (student submits from wherever the work happened; parent is notified and verifies) depends on this and it is not satisfiable by a profile picker under a parent session.
- R4. A family account owns one or more parents and N students. Program context is **per student, not per family** — one sibling may be cohort-linked (Guide countersign required) while another is home-study.
- R5. Evidence is visible to the student, the family's parents, and **the Guide linked to that student's cohort, at any time** — a Guide cannot coach what they cannot see, and the brief's own scenario has a Guide watching a board-meeting video from the cohort dashboard. Home-study students have no Guide and therefore no third reader. Siblings see each other's position and awards, never each other's evidence. *(Widened on 2026-07-21 from countersign-only access — see D25. This is standing access to children's media across roughly 24 families per Guide and must be reflected in the retention and consent posture.)*
- R6. A student can never verify anything, including their own work. There must be no path through the system by which progress advances without an adult verification record.
- R31. A Path student profile **links to the existing `public.children` row**, which remains authoritative for name and grade. An enrolled family gets Path accounts without re-entering anything, and band is derived from the one grade value rather than kept in a second place where it can drift. Requires a linkage migration for families already enrolled for 2026-27.
- R32. **A parent resets their child's password from their own dashboard**, authenticated as themselves — no email round-trip and no support ticket. Under-13 accounts therefore never depend on auth mail, which is unfinished in this repo (no custom SMTP, roughly 2/hr).
- R29. The under-13 name-and-password sign-in enforces the same rate-limiting and lockout as every other account in this repo, plus a minimum strength floor on the parent-set password. A first name is a more guessable identifier than an email address, especially within a cohort.

**Platform and delivery**

- R7. The Path is a responsive web application served at `/path` from this repository, reusing the existing Supabase, auth, and Resend infrastructure.
- R8. Both the phone and the desktop app-shell layouts from the design handoff ship. **These are separately authored layouts, not one responsive tree** — the prototype uses a single container query and switches between hand-built phone (390×812) and desktop (236px sidebar + sticky top bar) scenes. Shipping both is close to double the student and parent UI surface and must be budgeted as such.
- R9. **Desktop is the target this build verifies, polishes, and demos.** The phone browser experience works honestly but is not the promise of this release.
- R10. The app is an installable PWA — manifest plus service worker — so desktop, Android, and home-screen-installed iOS can receive web push. iOS in a plain browser tab receives no push.
- R11. No native mobile application, no app-store submission, and no engineering effort spent chasing iOS-specific PWA behaviour in this build. Native mobile is a future sprint.
- R12. Notification transport is **stated per role**, because no single channel reaches everyone:

  | Role | Guaranteed channel | Enhancement |
  |---|---|---|
  | Parent | Email | Web push where installed |
  | Guide | Email digest | Web push where installed |
  | Student 13–17 | Email | Web push where installed |
  | Student under 13 | **In-app only** — no inbox exists by design (R2) | Web push where installed |

- R27. The app carries an **in-app notification surface**. Every student sees their verification result — Verified, or Not Yet with the reviewer's note — on next open, regardless of transport. For under-13 students this is the only guaranteed channel and therefore carries the loop's most important moment.

**Evidence and the Founder File**

- R13. Evidence types per the brief: photo, video, audio, document, link, free text, and **log table as a first-class structured type** with per-task templates shipped for the curriculum's trackers (25-attempt tracker, No Log, sales ledger, P&L).
- R14. Video uploads natively and plays in-app. **Review never requires leaving the app.** Links remain the sanctioned path for large files, with an auto-fetched thumbnail and a required one-line description.
- R15. Evidence becomes append-only on verification: later additions permitted, deletions and edits not.
- R16. One-click full export of a student's complete Founder File — organized folders plus a manifest — is a launch requirement, not a later feature. The family owns this record.
- R17. **Offline evidence capture is in scope.** Evidence captured without signal queues locally and syncs when the device reconnects. `capturedAt` records the moment the evidence was made, not the moment it uploaded — the two may diverge and the distinction is preserved in the record. Which surface this build polishes does not determine where a child is standing when they get their first yes.
- R28. Evidence storage is **private by default**. Media is served only through short-lived signed URLs, never public object URLs, and the storage region is selected against a stated PIPEDA data-residency posture for minors' media. A misconfigured public bucket is the standard breach vector for exactly this feature and is cheap to prevent before the layer is built.

**Skins and art**

- R18. Both skins ship in this build. Mechanics, bar, and stored data are identical across them; only pixels and words change.
- R19. Trail's world, landmarks, and avatar ship as the prototype's CSS/SVG schematic. Every art asset sits behind a swappable reference so commissioned illustration drops in later without touching engine or layout logic.
- R20. Crests ship as the single parametric heraldic template (phase colour plus criterion numeral). The 25 bespoke crest designs the brief calls for are a content swap at the same reference, on a parallel track.
- R21. The skin toggle is student-controlled, instant, logged, and has zero data consequence. Everything earned renders in both skins.

**Content ingestion**

- R22. The 125 tasks load as a **versioned content package**, not as code. The per-phase and per-criterion totals live in the package's own manifest, declared per `ProgramVersion`; ingestion asserts the parsed content matches the manifest it shipped with, and fails loudly on a mismatch. A separate explicit check asserts the 2026-27 package declares 25 / 26 / 24 / 25 / 25 tasks per phase, 125 total, 25 criteria, 5 phases. A curriculum revision then ships a new manifest, not a code change. **Tasks per criterion is variable** — criterion 2.3 has six, 3.4 has four, all others five — so every step-rendering surface (Trail landmark pips, TrailStep rows, HQ PhaseRow segments) must render N from the package and never a literal five. Criteria 2.3 and 3.4 are the required test fixtures.
- R23. Both copy registers — standard and kid — are mandatory for all 125 tasks. The kid register is the Trail voice; this resolves the curriculum brief's open item on a kid-voice edition.
- R24. The 25 pass criteria and their kid register are ingested into the versioned content package with explicit `N.N` criterion IDs, **seeded from `app/2026-27/data.ts`**. That file is typed and unit-tested but carries no version field, and its kid register is positionally coupled to the standard one (`pathStepsKid` has no `num`/`key`/`title`). A build-time assertion checks the package text still matches `data.ts`, so a marketing copy edit fails the build rather than silently changing app content.

**Roles beyond the family**

- R25. Guide surfaces ship as **the cohort board and the phase-review countersign only**. Multi-student review queues, stall detection, and cohort-level reporting are deferred until a Guide is demonstrably drowning — the brief's original position. Subtraction test: removing them changes no stated success criterion.

**Wisdom**

- R26. The wisdom deck requires 150–250 entries, none of which exist yet. **Full Phase 01 coverage is the floor to ship**; Phases 02–05 land as rolling content ahead of the first student reaching them.

**Instrumentation**

- R30. The system records `submitted → reviewer-opened → decided` as three separate timestamps, so a slow verification turnaround can be diagnosed rather than guessed at (see Success Criteria).

### Inherited unchanged from the app design brief

The following are in scope for this build exactly as specified, and are not restated here. Planning should read them directly.

| Area | Brief section |
|---|---|
| Task state machine, concurrency rules, verification integrity | §9.1, §9.2, §9.5 |
| Criterion Review and Phase Review ceremonies, countersign | §9.3, §9.4 |
| Data model | §10 |
| Celebration tiers 1–4, the Not Yet moment, copy registers | §5 |
| The AI layer — Readiness Check, Recap, Chronicle, Portfolio — and the rule that AI never verifies, grades, or gates | §12 |
| Notification routing matrix — **transport superseded by R12 and R27** | §13 |
| Roles and permissions, band changes | §14 |
| Field Guides, math gate, Demo Session cadence | §15 |
| Privacy and safety non-negotiables — **first bullet superseded by R1/R2/D15**: under-13 students hold their own parent-provisioned auth account rather than a profile under the parent's | §11 |

### Priority tiers

Every requirement and inherited area carries a tier. The test: *ship everything except this — does a real family still complete criterion 1.1 and keep using the app?* Tiers are the release valve. When the build runs long, cuts come off the bottom rather than off whatever is in front of whoever is coding that week.

| Tier | Meaning | Requirements | Inherited areas |
|---|---|---|---|
| **T1 — Core loop** | No product without it. A family cannot complete criterion 1.1. | R1–R6, R27, R29, R31, R32 · R7–R9, R12, R30 · R13–R15, R17, R28 · R18–R20 · R22–R24 | Task state machine and concurrency (§9.1, §9.2, §9.5) · Criterion Review (§9.3) · Data model (§10) · Tier 1 celebration and the Not Yet moment (§5) · Roles and permissions (§14) · Privacy non-negotiables (§11) |
| **T2 — The year** | Not needed for the first criterion, but a real student reaches it within weeks to months. | R10, R16, R21, R26 | Phase Review and countersign (§9.4) · Tier 2–3 celebrations (§5) · Criterion Recap and Readiness Check (§12) · Notification matrix (§13) |
| **T3 — Completeness** | Committed, but no near-term dependency. First student contact is months to a year out. | R25 | Tier 4 celebration (§5) · Phase Chronicle and Founder Portfolio (§12) · Field Guides, math gate, Demo Session cadence (§15) |

Both skins sit in T1 (R18–R20) because a Grade 4 student needs Trail on their first day, not later; the *toggle* between them (R21) is T2. R26 is T2 at the Phase 01 floor — wisdom is not load-bearing for a first criterion but is visible by the second.

## Success Criteria

- A real family completes criterion 1.1 end to end inside the app — five tasks captured, submitted, verified, the crest awarded, the Criterion Recap generated — without falling back to a spreadsheet, a Drive folder, or a text message.
- Verification turnaround is instrumented, not assumed (R30). `submitted → reviewer-opened` isolates whether the parent learned; `opened → decided` isolates whether they could decide from what they were given. A slow result diagnoses to transport, to the review surface, or to evidence quality, rather than being attributed to one of them in advance.
- No path exists by which a task, criterion, or phase advances without an adult verification record naming actor, role, and timestamp.
- A student toggles skin mid-phase and loses nothing — same progress, same awards, two renderings.
- The Founder File export produces a record a family would still find complete and legible if the app disappeared.
- Content ingestion reproduces the manifest's declared totals exactly, and a curriculum revision ships without a schema or validator code change.

## Scope Boundaries

Carried from the brief's non-goals, and still binding: no cross-student leaderboards or comparisons of any kind; no public profiles, feeds, or social layer; no payment processing; no student-to-student chat; no Gauntlet mechanics or shared currency; **no AI that verifies, grades, or gates**.

Added by this document:

- No native mobile app, no app-store presence, no iOS-specific PWA engineering (R11).
- No Guide bulk tooling — multi-student review queues, stall detection, cohort analytics (R25).
- No commissioned Trail illustration or 25 bespoke crests in this build — schematic and parametric stand-ins ship instead (R19, R20).
- No shared 120 dashboard tying The Path to The Gauntlet. The Path stands alone; the dashboard is a later, separate decision.

## Key Decisions

Continuing the app design brief's decision log, which ends at D14.

- **D15 — Every student gets a real auth account, parent-provisioned.** Chosen over a hybrid band-split model for one identity model and one permission surface. The under-13 inbox problem is solved by system-generated addresses and parent-set passwords (R2). The cost, stated honestly: a band-conditional sign-in surface and an unresolved reset path, so the "single code path" is single at the account layer and forked at the auth surface.
- **D16 — Desktop-first, responsive, installable PWA; no iOS-specific work this build.** Deliberate reversal of the brief's mobile-first posture (§8). Native mobile becomes a future sprint.
- **D17 — Transport is stated per role; email is guaranteed where an inbox exists, in-app where it does not.** The original rationale ("no iOS push") was wrong — iOS has supported Web Push for home-screen-installed PWAs since 16.4. The real gap is the install step and per-device opt-in, which is why email rather than push is the guaranteed channel for anyone who has an inbox, and why under-13 students need R27.
- **D18 — Offline capture is in scope.** Reversed on review. D16 governs which surface the team verifies and polishes; it does not relocate the child. A student who just made their first sale is still on a doorstep, and removing offline support removes the support, not the scenario. Keeping it also preserves `capturedAt` as the real moment rather than the upload time.
- **D19 — Both skins ship on placeholder art.** Art becomes a parallel, non-blocking track rather than a months-long gate on anything student-facing.
- **D20 — Guide tooling ships as countersign plus cohort board.** Reverted to the brief's original position. The earlier rationale — that bulk tools are desktop surfaces, "which is exactly what this build is good at" — argued they were easy, not that they were needed.
- **D21 — Native storage default with link overflow, with stated numbers.** Photos, documents, audio, and short video store natively; long video is a link with a required description. **Provisional limits: 10 GB per student per program year; native video capped at 3 minutes or 500 MB per item, above which the item must be a link.** Derived from an estimate of roughly 375 evidence items across 125 tasks at photo-dominant sizes plus ~20 video tasks. Revisit trigger, not tied to a pricing conversation that no roadmap contains: the median student passing 6 GB, or blended storage cost per student per year crossing $15.
- **D22 — No intermediate validation milestone; the full brief gets built.** Deliberate, taken with the consequence stated: the cohort starts 19 Sept 2026 with up to 120 enrolled students, so Phase 01 runs on paper or in a Drive folder this autumn, and the platform bets in D16–D18 stay untested until the app exists. A paper-to-app migration path is therefore a real deliverable, not an afterthought — see Outstanding Questions.

Resolved during planning on 2026-07-21, after flow analysis surfaced them as unspecified transitions:

- **D23 — A crest is never taken back.** When a phase review returns an already-cleared criterion, the crest stays on the trophy wall rendered as provisional / under re-review, and its Recap is retained and regenerated when the criterion re-clears. Follows the brief's rule that nothing is failed, only not done yet. `Award` stays immutable.
- **D24 — The same person may not both sign as parent and countersign as Guide on one phase review.** Where a Guide's own child is in their own cohort, the countersign routes to a co-Guide, or the phase seals as home-study with the reason recorded. Requires the data model to carry **role grants** (role + scope) rather than one role per user — a one-line change now, a multi-table migration later.
- **D25 — A Guide sees evidence for their cohort students at any time,** not only during a countersign. Widens R5.
- **D26 — Staff-mediated recovery.** Single-parent families are supported without a mandatory second adult; The 120 staff can reset a student's password and, where a parent is unreachable, intervene. Uses the existing `/crm` service-role boundary. Note this grants staff a power the brief never contemplated, so it needs an audit trail and a stated policy for when it may be used.
- **D27 — Every student is pinned to a program version at provisioning** *(added 2026-07-21 during the T1 deepening pass; this conclusion came out of the flow analysis but was never carried into a committed document)*. A content revision must never silently rewrite an active student's remaining tasks — the same invariant the band snapshot provides for grade changes. New students (including a sibling added mid-year) pin whatever version is current at their provisioning; a pinned version's content is immutable and its generated module is a permanent fixture.

## Dependencies / Assumptions

Verified against the repository on 2026-07-21:

- **No `/path` route exists.** "The Path" today is `app/2026-27/sections/ThePath.tsx`, a marketing section.
- **No student authentication exists anywhere.** `children` are rows owned by a parent `auth.users` id; the Gauntlet is anonymous. R1–R3 are greenfield as an *auth* concern — but `public.children` already holds a roster (name, grade, parent FK) for enrolled families, so student records are not greenfield as a *data* concern.
- **No file or media storage exists.** No Supabase Storage buckets, no Vercel Blob. The only prior art is a child photo stored as a data URL in a Postgres column, annotated as pending real uploads. R13–R16 and R28 are entirely greenfield.
- **Curriculum content is machine-parseable today.** 125 task IDs matching `N.N.N`, each with a regular `*Done when:*` line. **Band variants are present on roughly half the tasks** — 63 for grades 3–5, 57 for 6–8, 59 for 9–12 — and absent where the curriculum states the task is identical across bands. Ingestion must treat a missing band line as "identical across bands," and `HQTaskCard` / `ReviewPanel` must render the base Done-when rather than an empty band slot.
- **`app/2026-27/data.ts` holds `pathSteps` and `pathStepsKid`** as typed, tested structures — 5 phases × 5 criteria in both registers. It carries no version field and no criterion IDs (see R24).
- **Reusable infrastructure:** Supabase with RLS-by-`auth.uid()` conventions, `app/lib/email.ts` (Resend), `CRON_SECRET`-gated cron routes, and the established pattern of extracting pure rule modules for Vitest coverage.

Constraints and unverified assumptions:

- **Email today is best-effort, not guaranteed.** `app/lib/email.ts` never throws and has an 8s timeout; `app/api/notify-submission/route.ts` documents that a failed send is simply lost because "there is no retry channel anyway." There is no send-record table, no retry cron, and no bounce handling. R12 elevates this channel and that elevation is net-new durable-delivery work, not reuse.
- **Auth mail is a separate, unfinished path.** `supabase/config.toml` disables confirmations and notes there is no custom SMTP, with the default sender rate-limited to roughly 2/hr (tracked as roadmap S6). Parent and teen password resets depend on it; Resend does not serve auth flows.
- **Tailwind v4 `@theme` cannot be route-scoped.** `app/globals.css` has one top-level `@theme inline` block generating utilities globally, and `app/layout.tsx` is the only root layout. The cited `/gauntlet` "island" is a background override plus keyframes — it reuses the site's fonts and tokens and is *not* precedent for a second type system. Giving `/path` Fraunces/Inter/Spline Sans Mono without shipping the marketing fonts everywhere requires splitting `app/` into route groups with separate root layouts. The handoff also stores tokens as HSL channels, a different convention from the repo's hex `--color-*`.
- **Supabase Auth is assumed to accept parent-provisioned accounts on non-deliverable system addresses without confirmation.** Not yet tested, and load-bearing for the entire identity layer.
- **Lucide icons are not in `package.json`**; the handoff's `Icon` component depends on them. No manifest, service worker, or VAPID key management exists for R10.

## Outstanding Questions

### Resolve Before Planning

*(None. Both prior blockers were resolved on 2026-07-21 — see R31 and R32.)*

### Deferred to Planning

- [Affects R1, R2][Technical] **Verify Supabase Auth accepts parent-provisioned accounts on non-deliverable system addresses with confirmation disabled.** `supabase/config.toml` already disables confirmations, so this is expected to hold, but a single account-creation call settles it and the identity layer keys off the answer. R32 removes the reset-path dependency on auth mail, so this is now a verification step rather than a design fork.
- [Affects R31][Technical] The linkage migration for families already enrolled for 2026-27, and which write path owns a grade change at a birthday or re-assessment.

- [Affects R14, R28][Technical][Needs research] Storage backend — Supabase Storage versus Vercel Blob — and the video transcoding pipeline that makes in-app playback work.
- [Affects R5][Technical] The enforcement mechanism for the Guide's scoped, time-bounded evidence grant, and the cross-family read model a Guide needs to reach a cohort student's data at all. The repo's RLS convention is single-column ownership (`auth.uid() = parent_id`), which expresses none of R5's four access shapes. Planning must also choose whether RLS or a service-role gate (the CRM's `requireStaff()` pattern) is the enforcement boundary.
- [Affects R12][Technical] Whether the notification channel gets a durable send record with retry, or R12 relaxes to the repo's best-effort posture with R27's in-app surface as the reliable signal.
- [Affects R16][Technical] Where a full media export actually executes. `vercel.json` has two cron entries and there is no queue, worker, or job table; assembling a multi-gigabyte zip in a serverless invocation will exceed function limits. Needs a background job plus a signed download link.
- [Affects R14][Technical] What the evidence card renders when a link thumbnail cannot be fetched — the sanctioned large-file hosts (Drive, Dropbox, iCloud) return login interstitials to an unauthenticated server-side fetch, so the failure path is the common one. Also whether a link without a thumbnail is still submittable, and the outbound-fetch surface this introduces.
- [Affects R7, R8][Technical] Whether `/path` gets its own root layout via route groups (splitting `app/` into marketing and app trees) or accepts the marketing fonts loading on every Path page.
- [Affects R22][Technical] Whether the content package is parsed at build time from the curriculum markdown or seeded via migration.
- [Affects R23][Technical] The kid register exists for the 25 criteria but not for the 125 tasks. Determine what exists versus what must be authored. Note that AI-drafting the curriculum voice a child *reads* is a different risk class from the §12 AI layer, which only summarizes work already done.
- [Affects the AI layer][Technical][Needs research] Model selection for the Readiness Check, which must read photo and video evidence of children against a Done-when line — **including whether the vendor's retention and training policy permits processing minors' imagery under PIPEDA, and whether a data-processing agreement is required.**
- [Affects R5][Technical] Whether a Guide may view evidence before a countersign is requested. Brief §7.5 has a Guide watching a board-meeting video from the cohort dashboard; R5 as written would forbid that.
- [Affects R19, R20][Design] What the CSS/SVG schematic concretely renders for each celebration beat currently written in terms of illustrated art — the avatar stepping, the wax-stamp footprint, the full-screen crest reveal, the wax seal press. These are the emotional core for the exact age band Trail exists to serve, and shipping them unspecified leaves an implementer to invent them. Related: whether anything beyond phase colour and numeral distinguishes the 25 interim crests, and whether avatar customization ships on the placeholder shape or waits for commissioned art.

### Deferred beyond planning — needed before real families use it

- [User decision] Media retention policy on program completion and account closure, and how it interacts with R15's append-only rule when a family exercises a deletion request.
- [User decision] **Third-party PII.** The curriculum has students log real customers' and prospects' names and addresses, and photograph handoffs. R16 bundles all of it into a portable family-owned export. Whether that data needs its own retention, redaction, or consent treatment is unaddressed anywhere in the brief or this document.
- [User decision] Wisdom deck authorship and the vetting bar for real-quote accuracy and attribution (R26).
- [User decision] Whether Tier 4 completion ships a physical artifact from The 120.
- [User decision] Commissioning the Trail illustrated world, avatar, and the 25 bespoke crests (R19, R20).
- [Affects D22][User decision] **The paper-to-app migration path.** Families starting 19 Sept 2026 will accumulate months of real evidence outside the app. Who owns bringing that record in — bulk import, back-dated capture with an honest `capturedAt`, or a clean start that abandons the autumn's evidence — and is retroactive verification of already-completed tasks permitted, given R6 and R15?
- [Affects R2, R6][User decision] **The parent knows the child's password.** Under-13 accounts have no second factor and no device binding, so a parent could submit as the child and verify as themselves, satisfying the audit trail without an independent verification ever occurring. This may be an accepted trust boundary of home study — but it should be accepted deliberately rather than discovered, since R6 is the product's central integrity claim.

## Next Steps

No blocking questions remain. `-> /ce:plan` for structured implementation planning.

Suggested build sequence for planning to weigh: content package and progress engine → identity and family accounts → evidence pipeline → verification and review ceremonies with notification → celebration tiers → AI layer → wisdom → Guide surfaces → Field Guides and math gate.
