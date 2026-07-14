---
title: "refactor: Remove Alpha, GT, TimeBack, and 2 Hour Learning branding site-wide"
type: refactor
status: completed
date: 2026-07-14
origin: docs/brainstorms/2026-07-14-remove-alpha-gt-timeback-2hl-requirements.md
---

# refactor: Remove Alpha, GT, TimeBack, and 2 Hour Learning branding site-wide

## Overview

Voluntary rebrand: The 120 stands entirely on its own brand. Every mention of Alpha, GT, TimeBack, and 2 Hour Learning is removed from visitor-facing pages, the members' dashboard, and `app/` code comments. The `/gt` sub-site is deleted (permanent redirect to `/scholars`), `/scholars` is rebuilt as the full Scholars program page in sibling group-page chrome, borrowed network proof (stats, testimonials) is cut, and the simulator survives de-branded as an explicitly illustrative model. Approved visual reference: the "Proposed /scholars — rebuilt page preview" artifact (v2, decisions applied) from the 2026-07-14 brainstorm session.

## Problem Frame

The site leans on the Alpha/GT/TimeBack/2HL ecosystem for identity ("run as GT Toronto", "part of the 2 Hour Learning Network") and proof (network outcome stats, network student testimonials, Alpha-camp parent stories, GT advisor roster). Each content piece was decided individually in the origin brainstorm (see origin: docs/brainstorms/2026-07-14-remove-alpha-gt-timeback-2hl-requirements.md) — removed, de-branded, or trimmed. All product decisions are ratified; this plan is execution structure only.

## Requirements Trace

From the origin document (full text there; IDs preserved):

- R1 Footer legal line drops the network claim (site-wide)
- R2 CASL consent copy: "The 120 (GT Toronto)" → "The 120" (copy-only)
- R3 Home hero badge → "FOUNDING COHORT · FALL 2026 · TORONTO"
- R4 HowItWorks: trim "the Scholars' assessment is run by GT" clause
- R5 site.ts Scholars group data de-branded
- R6/R6b Parent-stories band footnote de-branded + founder tag on Peter's card; TuitionTeaser drops "with TimeBack"
- R7 /parents trimmed to platform stories with rewritten lead-ins (permission confirmed 2026-07-14)
- R8 /scholars rebuilt as full program page, sibling chrome, CTA row closes pillars, qualification line added
- R9 /gt deleted; permanent redirect /gt → /scholars; inbound CTAs retargeted; no archive route
- R10 Borrowed proof removed (proofStats band, "51+ campuses" lines, 2HL testimonials, hero stat line)
- R10b Simulator returns de-branded as an illustrative model
- R11 All six /tuition brand mentions go generic
- R12 Three /faq answers edited
- R13 Dashboard: advisor roster removed, "Advisor to be announced", GT scrubbed, member framing note
- R14 app/ code comments scrubbed; dead `SeatsRemaining.tsx` deleted

## Scope Boundaries

- `/gauntlet` is The 120's own game — untouched.
- Supabase migrations, CRM seed data, `artifacts/`, `docs/` — untouched (internal records).
- CRM code comments containing "alphahub" are an internal codename for a prior CRM codebase, not the Alpha brand — out of scope (never rendered; origin R14 file list doesn't include them).
- No new proof content is created; that's a follow-up once The 120 has its own results.
- `app/lib/nurture/copy.ts` verified brand-clean — no changes.
- Old Vercel deployments remain reachable at immutable URLs — accepted (voluntary rebrand).

## Context & Research

### Relevant Code and Patterns

- **Redirect pattern:** `next.config.ts` already has an async `redirects()` array with house style of a one-line comment per entry (e.g. the `/raiders` → `/gauntlet` entry). Next.js 16.2.10 config redirects accept either `permanent` (`true` → **308**) or `statusCode` (301 possible), not both (`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/redirects.md`, "Other Redirects"). Redirects are checked before the filesystem, so adding the redirect and deleting the route in one change is safe. Note: requests to the old `jointhe120.vercel.app/gt` alias take two 308 hops (host canonicalization, then `/gt` → `/scholars`) — harmless.
- **Sibling chrome pattern:** `app/groups/[slug]/page.tsx` — `min-h-screen flex-col bg-blue` wrapper, absolute gradient overlay, mono "← THE 120" top bar + `Wordmark tone="light"`, bottom-anchored content, thin bordered footer row. `app/scholars/page.tsx` is already a hand-copied clone of this chrome; the rebuild edits it in place. For a long page: keep wrapper/top bar/footer row, **scope the gradient to the hero section** (the old `/gt` hero at `app/gt/page.tsx:30-46` shows exactly that per-section variant), and replace the `flex-1` spacer/bottom-anchoring with stacked sections.
- **Component ownership (verified by grep):** `ProductPillars`, `TimeBackSimulator`, `Testimonials`, `GtTuition`, `KeyDates`, `Promises`, `Faq` are imported **only** by `app/gt/page.tsx`. Deleting `/gt` without rehoming them orphans all seven. `CtaBand`, `Nav`, `Footer` are shared.
- **Advisor rendering (verified, two consumers):** `ADVISORS` in `app/dashboard/data.ts` is imported nowhere. Advisor strings render in two places: `app/dashboard/wizard/StepWorkshops.tsx:121` (workshop card) and the CRM dossier-queue label at `app/crm/lib/queries.ts:795` (`"${w.title} — ${w.advisor}"`).
- **Only two `/gt` links in the repo:** `app/tuition/page.tsx:126` and `app/scholars/page.tsx:61`.
- **No metadata traps:** no `openGraph`/`twitter` metadata, no sitemap/robots files anywhere; `app/layout.tsx` metadata is brand-clean.
- Assets: `public/reference/hero-science.webp` is **shared** — the home hero (`app/components/Hero.tsx:13`) uses it too; reuse for the rebuilt /scholars hero, do not move or delete. `public/reference/partner-lockup.svg` is referenced nowhere and its vector text reads "The Gifted Academy of Alpha School" (verified by reading the SVG) — it is a brand asset; delete with the cleanup unit.

### Institutional Learnings

- `docs/solutions/logic-errors/retired-workshops-checklist-mirrors-gate-on-raw-array-not-live-selection-2026-07-14.md` — **LOCKSTEP MIRRORS rule**: `data.ts` catalog edits are multi-consumer changes (dashboard `checklist()`, `app/crm/lib/reviews-rules.ts`, `app/lib/nurture/rules.ts`). This plan deliberately does **not** change workshop ids, tracks, or the WORKSHOPS/RETIRED_WORKSHOPS split — advisor strings, descriptions, and comments only — so the mirrors are unaffected. Any test fixture must use the raw stored shape, never sanitizer output.
- `docs/solutions/security-issues/supabase-autoconfirm-forged-consent-email-confirmation-signup-retrofit-2026-07-13.md` — the AccountModal consent flow is a load-bearing security fix. R2 must be **copy-only**: do not touch metadata keys, the `!data.session` branch, or the `store.tsx` self-heal field list. Also check the `needsConfirm` SuccessView copy for brand mentions while in the file.
- `docs/solutions/security-issues/admissions-notification-email-html-injection-...-2026-07-14.md` — if any email template copy is touched, escape interpolations with `escapeHtml`. No email copy changes are planned. (**Out-of-plan pointer, not a task:** `app/api/welcome/route.ts` has a known unrelated `${greeting}` escaping residual — track separately.)
- `docs/solutions/workflow-issues/split-phase-migrations-...-2026-07-14.md` — stale-tab principle: pre-deploy tabs keep running old bundles with old `/gt` links; the config-level permanent redirect is exactly the right mechanism because it works after the route is deleted.

### External References

- None needed — vendored Next.js 16 docs (per AGENTS.md) covered the only framework question.

## Key Technical Decisions

- **Redirect via `next.config.ts`, `permanent: true` (308)**: 301 is available via `statusCode`, but `permanent: true` is chosen deliberately — modern permanent semantic, matches the existing host-canonicalization entry's style, and satisfies the origin's "301 or 308" criterion. Single `source: "/gt"` suffices (the route has no children); follow house comment style.
- **Rebuild `/scholars` in place** (it already clones the sibling chrome) rather than creating a new route: keeps the URL, git history, and the groups data `href` unchanged.
- **Rehome, rename, or delete the /gt-only components**: `KeyDates`, `Promises`, `Faq` move to `/scholars` unchanged; `ProductPillars` de-branded in place (stats block stripped, CTA row added by the page, not the component); `TimeBackSimulator` renamed (new file name + component name + visible strings; display name settled at implementation, e.g. "the pace simulator"); `GtTuition` renamed `ScholarsTuition` and de-branded; `Testimonials.tsx` deleted; `proofStats` export deleted from `site.ts` in the same commit as its only consumer.
- **`ADVISORS` roster deleted outright** (imported nowhere); workshop `advisor` fields become "Advisor to be announced"; the framing note renders once in `StepWorkshops.tsx`, not per-card.
- **Workshop ids/tracks/tombstones untouched** so the lockstep completeness mirrors and existing Vitest suites stay valid.
- **Atomic cutover:** the `/scholars` rebuild and the `/gt` deletion land as **one commit** (Unit 3). Splitting them cannot compile: renaming `TimeBackSimulator`/`GtTuition` and deleting `Testimonials` breaks `app/gt/page.tsx`'s imports while that page exists, and deleting the page first leaves "See the full program" pointing at a thin page. One commit keeps every build gate green and removes any content-quality window.
- **Non-sticky top bar accepted:** the ratified sibling chrome has a plain in-flow top bar (no sticky nav). On the long page, mid-scroll exits are the pillars CTA row, the tuition card, and the closing CTA band + footer row. Walk the mobile scroll experience at implementation; if it feels trapped, propose stickiness as a follow-up rather than deviating from the ratified chrome now.

## Open Questions

### Resolved During Planning

- Redirect mechanism: `next.config.ts` redirects, `permanent: true` → 308 (no 301 available in Next 16 config API).
- Component reuse vs rebuild: see Key Technical Decisions (rehome/rename/delete table above).
- Chrome extension to a long page: keep group-page wrapper/top bar/footer row; gradient scoped to hero; stacked sections replace bottom-anchoring.

### Deferred to Implementation

- Final visible name of the renamed simulator ("the pace simulator" is the working example) — pick when writing the section copy.
- Exact trimmed lead-in sentences for Ian's and Gordon's /parents stories — write during the edit; permission already covers the edited versions.
- Results of the off-repo brand checks (Stripe product names, Supabase auth email templates, booking destination) — verify during Unit 6; remediation, if any, is config work outside this repo.

## Implementation Units

- [x] **Unit 1: Global + home page de-brand**

**Goal:** All site-wide and home-page brand mentions removed or replaced (R1–R6b).

**Requirements:** R1, R2, R3, R4, R5, R6, R6b

**Dependencies:** None

**Files:**
- Modify: `app/components/Footer.tsx` (legal line)
- Modify: `app/components/account/AccountModal.tsx` (consent copy + §13.2 comment; copy-only — see learnings)
- Modify: `app/components/Hero.tsx` (badge → "FOUNDING COHORT · FALL 2026 · TORONTO")
- Modify: `app/components/HowItWorks.tsx` (trim GT clause)
- Modify: `app/lib/site.ts` (scholars group blurb/body per origin R5; comments at lines 35 and 116; `proofStats` stays until Unit 3)
- Modify: `app/components/ParentStoriesBand.tsx` (generic footnote; Peter's detail line gains "· founder of The 120")
- Modify: `app/components/TuitionTeaser.tsx` (drop "with TimeBack")

**Approach:** Exact replacement copy is specified in origin R1–R6b. While in AccountModal, check the `needsConfirm` SuccessView copy for brand mentions (learnings flag).

**Patterns to follow:** Keep each component's existing typography classes; copy changes only.

**Test scenarios:** Test expectation: none — pure copy edits, no behavioral change; repo test suites cover rule/data modules only.

**Verification:** Home page and footer render the new copy; grep of the seven files finds no brand tokens; join modal still submits with consent metadata unchanged.

- [x] **Unit 2: /tuition and /faq copy**

**Goal:** All six /tuition mentions and three /faq answers go generic (R11, R12).

**Requirements:** R11, R12

**Dependencies:** None

**Files:**
- Modify: `app/tuition/page.tsx` (metadata line 14, checklist lines 27/30, hero line 63, membership line 86, card lines 115–116 — exact replacements in origin R11; the `/gt` CTA at line 126 is retargeted in Unit 4, not here)
- Modify: `app/faq/page.tsx` (answers at lines 28, 32, 60 — exact replacements in origin R12)

**Test scenarios:** Test expectation: none — copy edits only.

**Verification:** Both pages render with zero brand tokens except the still-live `/gt` link (removed in Unit 4).

- [x] **Unit 3: Rebuild /scholars and cut over from /gt (atomic)**

**Goal:** `/scholars` becomes the full Scholars program page per the approved preview, and `/gt` ceases to exist in the same commit (R8, R9, R10, R10b). One commit by necessity: the component renames/deletions and the `/gt` page deletion cannot compile separately (see Key Technical Decisions, "Atomic cutover").

**Requirements:** R8, R9, R10, R10b

**Dependencies:** Unit 1 (site.ts group copy renders on this page via `groupBySlug`)

**Files:**
- Modify: `app/scholars/page.tsx` (rebuild; kicker "MASTERY WITH NO CEILING · FOUNDING COHORT FALL 2026"; qualification line "Admission by application and academic review."; page becomes async, calls `getSeatsRemaining()` from `app/lib/seats.ts` and passes it to `ScholarsTuition` — mirroring the old `app/gt/page.tsx:24/77`)
- Modify: `app/components/ProductPillars.tsx` (Subject card de-brand per origin R8 — platform names and "3x the pace" claim out; delete the network-outcomes block and its "51+ campuses" line)
- Modify: `app/lib/site.ts` (delete `proofStats` — same commit as its only consumer)
- Rename + modify: `app/components/TimeBackSimulator.tsx` → de-branded name (e.g. `PaceSimulator.tsx`)
- Rename + modify: `app/components/GtTuition.tsx` → `ScholarsTuition.tsx`; copy per origin ("Full Academic Core: 5 hours a week of AI-adaptive, mastery-based academics… $15,000 all-in"); checklist item 1 → "5 hours a week of adaptive academics, your academic core"
- Delete: `app/components/Testimonials.tsx`, `app/gt/page.tsx` (and the now-empty `app/gt/`)
- Modify: `next.config.ts` (add `{ source: "/gt", destination: "/scholars", permanent: true }` with house-style comment)
- Modify: `app/tuition/page.tsx` (line 126 CTA → `/scholars`)
- Modify: `app/groups/[slug]/page.tsx` (stale "Scholars route to /gt" comment, lines 9–10)

**Approach:**
- The approved artifact preview is the layout contract: hero → pillars → CTA row (Join + Book, rendered by the page after the pillars, in the old stats-box slot) → simulator → key dates → promises → tuition split → FAQ → CTA band → thin footer row. No site `Nav`/`Footer` on this page; `KeyDates`, `Promises`, `Faq`, `CtaBand` imports move here from the deleted /gt page.
- **Chrome/hero layering:** the "← THE 120" top bar renders inside the hero section, positioned over the image (the old /gt hero's `-mt-[92px]` negative margin existed only to tuck under the sticky Nav card — do not copy it). Gradient scoped to the hero section per `app/gt/page.tsx:30-46`; hero reuses `public/reference/hero-science.webp` (shared with the home hero — do not move it).
- **Simulator copy is a deliberate rewrite, not a find-and-replace:** the demo's five-phase narrative is branded throughout — eyebrow ("The Subject · TimeBack"), intro sentence, run button ("▶ Run TimeBack"), and the payoff phase label `done: "This is TimeBack."`. Each needs an unbranded equivalent; working example for the payoff: "This is mastery pace." Final copy (and the component's display name) settled at implementation. Disclaimer is fixed: "Illustrative simulation of mastery-based pacing — not a promised outcome."

**Execution note:** Before renaming, grep the repo for `TimeBackSimulator` / `timeback` outside the component to confirm no analytics or stored state references the name (see the retired-workshops learning: stored state diverging from renamed code is this repo's recurring failure class).

**Test scenarios:**
- Integration: requesting `/gt` returns a 308 with Location `/scholars` (verify on preview deploy; local `npm run build` + `next start` acceptable).
- Happy path: `/scholars` renders all sections in order; the live seat count renders in the tuition card.

**Verification:** `npm run build` passes (proves no dangling imports of renamed/deleted components); `/scholars` renders all sections with zero brand tokens; live seat count shows; no `href="/gt"` remains in `app/`; `/gt` redirects.

- [x] **Unit 4: Trim /parents to platform stories**

**Goal:** Parent stories keep only platform paragraphs, de-branded, with coherent lead-ins (R7).

**Requirements:** R7

**Dependencies:** None

**Files:**
- Modify: `app/parents/page.tsx` (metadata, hero subline, story detail lines, story paragraphs, closing disclosure, file comment)

**Approach:** Peter's story: TimeBack → "the learning platform" throughout. Ian: keep the adaptive-pacing/extra-work paragraphs with a new opening sentence; cut camp narrative (Orange County, medic track, snack challenge, drones, "Alpha coming to Toronto"). Gordon: keep the XPs paragraph with a new lead-in establishing the twins; cut "Alpha Summer Miami". Disclosure line → generic platform phrasing. Permission for the edited versions confirmed 2026-07-14 (origin, Dependencies).

**Test scenarios:** Test expectation: none — content edits.

**Verification:** /parents renders three coherent stories with zero brand tokens; each story reads self-contained.

- [x] **Unit 5: Dashboard advisor roster and workshop copy**

**Goal:** Members' dashboard carries no GT references; advisors show as "to be announced" with a framing note (R13).

**Requirements:** R13

**Dependencies:** None

**Files:**
- Modify: `app/dashboard/data.ts` (delete unused `ADVISORS` const + `Advisor` type; every `advisor:` value → "Advisor to be announced"; scrub GT from workshop `description` strings, the audition note at line 119, comments at lines 123–144 and 534, and the `community.gt.school` URL)
- Modify: `app/dashboard/wizard/StepWorkshops.tsx` (single framing line near the catalog header: "We're assembling The 120's own advisor roster — advisors will be announced as they're confirmed."; advisor line at 121 renders the placeholder naturally)
- Test: `app/dashboard/__tests__/wizard-rules.test.ts` (existing — must stay green)
- Aware, decide at implementation: `app/crm/lib/queries.ts:795` builds CRM dossier labels as `"Title — Advisor"`; after this unit every label reads "… — Advisor to be announced". Accepted (internal staff surface); dropping the suffix while the roster is unannounced is a fine one-line alternative at the implementer's discretion.

**Approach:** Do **not** change workshop `id`s, `track`s, or the WORKSHOPS/RETIRED_WORKSHOPS membership — the lockstep completeness mirrors (dashboard/CRM/nurture) gate on those (learnings §1). Achievement claims inside descriptions lose GT attribution but keep the achievement where it's the advisor-independent truth of the workshop; where a claim is only about GT ("Found GT's first robotics team"), generalize or drop the sentence.

**Test scenarios:**
- Happy path: existing `wizard-rules.test.ts` suite passes unchanged (ids/tracks/tombstones untouched).
- Edge case: a legacy dossier row referencing a retired workshop id still resolves via the tombstone array (covered by existing tests; re-run to confirm).

**Verification:** `npm test` green; dashboard workshops view shows placeholder advisors + framing note; grep of `app/dashboard/` finds no brand tokens.

- [x] **Unit 6: Comment scrub, dead code, and final sweep**

**Goal:** Remaining internal references removed; success criteria verified (R14 + origin Success Criteria).

**Requirements:** R14, Success Criteria

**Dependencies:** Units 1–5

**Files:**
- Modify: `app/globals.css` (header comment), `app/components/Nav.tsx` (comment), `app/components/Wordmark.tsx` (comment)
- Delete: `app/components/SeatsRemaining.tsx` (unused), `public/reference/partner-lockup.svg` (verified brand asset — its vector text reads "The Gifted Academy of Alpha School"; referenced nowhere)
- Verify only: full sweep

**Approach & sweep spec:** **case-insensitive** source grep over `app/`: `alpha|timeback|2 ?hour ?learning|\bgt\b`, with an explicit allowlist for known false positives ("alphahub" CRM codename, "GTM" go-to-market acronym — note `\bgt\b` already can't match inside "GTM", and "gtm" has no trailing boundary either; list them anyway so the sweep script documents its exclusions). Case-insensitivity is what catches lowercase residuals like `community.gt.school`. **Self-test the net first:** run the sweep against the pre-change tree and confirm it flags every hit Units 1–5 are about to fix — a sweep that was never dry-run proves nothing. Then the rendered-page pass (exact phrases + `\bGT\b` against rendered text) as the origin specifies. Off-repo checks: Stripe product/price display names, Supabase auth email templates, booking destination — record findings; remediate in the respective dashboards if hits are found.

**Test scenarios:** Test expectation: none — comments, dead code, verification.

**Verification:** Sweep (self-tested) returns zero non-allowlisted hits in `app/`; `npm run build` + `npm test` green; `/gt` 308s in the preview deploy; off-repo checklist recorded.

## System-Wide Impact

- **Interaction graph:** AccountModal is shared by every page (join flow) — copy-only rule protects the signup metadata contract. `site.ts` group data feeds home GroupsBand, /scholars, and /groups pages — one edit, three surfaces.
- **Error propagation:** none — no control-flow changes outside route deletion, which the config redirect covers pre-filesystem.
- **State lifecycle risks:** stale pre-deploy tabs keep old bundles with `/gt` links — covered by the permanent redirect (stale-tab learning). Dashboard stored dossier rows referencing workshops are unaffected because ids/tracks don't change.
- **API surface parity:** none — no API routes change.
- **Integration coverage:** the `/gt` 308 is the one cross-layer behavior to verify on a real deploy.
- **Unchanged invariants:** workshop ids/tracks/tombstones; signup metadata keys and store self-heal; CRM and nurture rule modules; `/gauntlet`; migrations and seed data.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Component renames/deletions and the /gt page deletion break the build if split across commits | Unit 3 is atomic: renames, deletions, the /gt page removal, and the redirect land in one commit; `npm run build` gates it |
| data.ts edits drift the lockstep completeness mirrors | Ids/tracks/tombstones frozen; only advisor strings, descriptions, comments change; `npm test` gates Unit 6 |
| Consent copy change disturbs the signup security retrofit | R2 is copy-only; metadata payload and store self-heal are named unchanged invariants |
| Search engines serve stale "GT Toronto" titles until recrawl | Accepted; 308 + updated metadata converge over time (voluntary rebrand, no deadline) |
| Off-repo surfaces (Stripe, Supabase emails, booking page) carry brand names | Explicit Unit 7 checklist; remediation is dashboard config, trackable outside this repo |
| Simulator rename breaks a hidden reference (analytics, saved state) | Execution note in Unit 3: grep for the old name across the repo before renaming |

## Documentation / Operational Notes

- `artifacts/roadmap.md` and memory already updated for positioning; no runbooks affected.
- Deploy is a single Vercel production deploy; no migration, no env-var changes. The unrelated `test_scores` purge re-run (due 2026-07-16) must not be conflated with this deploy's verification.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-07-14-remove-alpha-gt-timeback-2hl-requirements.md](../brainstorms/2026-07-14-remove-alpha-gt-timeback-2hl-requirements.md)
- Approved visual reference: "Proposed /scholars — rebuilt page preview" artifact (2026-07-14 session, v2 decisions-applied)
- Related solutions: `docs/solutions/logic-errors/retired-workshops-checklist-mirrors-gate-on-raw-array-not-live-selection-2026-07-14.md`, `docs/solutions/security-issues/supabase-autoconfirm-forged-consent-email-confirmation-signup-retrofit-2026-07-13.md`
- Framework docs: `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/redirects.md` (Next 16.2.10, vendored)
