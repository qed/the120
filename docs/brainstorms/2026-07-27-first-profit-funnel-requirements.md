---
date: 2026-07-27
topic: first-profit-funnel
---

# The First Profit Funnel

## Problem Frame

The 120's site asks a cold visitor to "Join The 120" on the strength of copy, and converts
poorly. Every red CTA on every marketing surface opens the same account modal
(`app/components/account/AccountModal.tsx`, reached through `app/components/JoinButton.tsx`
from `Nav.tsx` ×3, `CtaBand.tsx`, and `ScholarsTuition.tsx`). A visitor's only path from
interest to commitment is a signup form.

The bet of this build: **families convert when the kid has already started.** A parent who
has watched their child design a real business in ten minutes, and then seen a credible
picture of that same child months later having sold to strangers for real money, is no
longer evaluating a program. They are deciding whether to interrupt something that has
already begun.

The tail of that funnel already exists and works. `/dashboard` holds the parent dashboard
and the five-step dossier wizard (`app/dashboard/wizard/`: Basics, Academics, Group,
Project, Workshops, Review). Stripe deposit rails run through `app/api/checkout/route.ts`
and `app/api/stripe/webhook` against the `deposits` table. The CRM ingests leads through
`app/crm/lib/lead-ingest.ts` and nurtures them through `app/lib/nurture`. What is missing
is everything in front of it: there is no `/start`, no `/first-profit`, no landing template,
no mini-app, and `/groups/[slug]` still serves the retiring brochure treatment.

## Source Documents

- `artifacts/First Profit/the-120-unified-funnel-design-brief.md` — routing, surfaces,
  attribution, the CTA reroute table. Authoritative on marketing-surface routing.
- `artifacts/First Profit/the-120-interactive-application-design-brief.md` — vision, gate
  ladder, copy registers, template copy (§8.2). Authoritative on tone.
- `artifacts/First Profit/First Profit application process design handoff/design_handoff_first_profit/README.md`
  — the sixteen funnel screens. **Pixel-fidelity source of truth for every screen.**
- `app/lib/site.ts` and `app/lib/seats.ts` — single source of truth for groups, seats,
  tuition, dates. The prototype's hardcoded "113 of 120" is prototype scaffolding.

## Rulings Made In This Brainstorm

The two briefs conflict in four places. These are the resolutions, and they are settled.

| # | Conflict | Ruling |
|---|---|---|
| F1 | Interactive brief names the product **Foundry** at `/foundry` (A14, A15). Unified brief, written a day later, never mentions it and puts the spine at `/start`. The Path→First Profit rename shipped to `/fp` on 2026-07-24, after both. | **Foundry is dead.** The product is First Profit, the app is `/fp`, the funnel spine is `/start`. `/foundry` is never built. |
| F2 | Interactive brief (A4, A6) puts real parent-verified task work between the application and the deposit, with Gate 2 firing when task `1.2.1` is verified. The handoff prototype goes application → Next Steps → checkout with no task work between. | **Handoff wins. Ship the short funnel.** No pre-deposit task work, no Gate 2 at `1.2.1`, no pre-deposit verification mechanic. The data model must not preclude adding it later, but nothing in this build depends on it. |
| F3 | Interactive brief (A10, A13) makes the landing page inbound-marketing-only with nothing internal linking to it. Unified brief (D1) makes the five group landing pages the canonical `/groups/[slug]`, linked from the home page's five cards. | **Unified brief wins**, by its own supersession clause. The group landings are internal destinations; only `/first-profit` is ad-only. |
| F4 | Interactive brief (A8) puts the Apply button and FAQ accordion on the Reveal screen. Handoff closes the Reveal with "Continue Application →" into the dossier wizard, with the FAQ accordion below. | **Handoff wins.** It is the pixel source of truth. |

## The Shape

```mermaid
graph TB
  subgraph entries["Entries"]
    E1["Ads, broad<br/>/first-profit"]
    E2["Ads, group<br/>/groups/[slug]"]
    E3["Organic<br/>/ home"]
  end
  subgraph spine["The spine"]
    S1["/start<br/>3-page explainer"]
    S2["Capture<br/>C1 email"]
    S3["Add a Child"]
  end
  subgraph mini["Mini-app, per child"]
    M1["Handoff seam"]
    M2["Doors"]
    M3["Templates"]
    M4["Quiz"]
    M5["AI compose"]
    M6["First 3 tasks"]
    M7["The Reveal"]
  end
  subgraph close["The close"]
    C1["Dossier wizard<br/>C2 submitted"]
    C2["Next Steps<br/>goal"]
    C3["Checkout<br/>C3 deposit"]
    C4["Arrival"]
  end
  E1 --> S1
  E2 --> S1
  E3 --> E2
  E3 --> S1
  S1 --> S2 --> S3 --> M1
  M1 --> M2 --> M3 --> M4 --> M5 --> M6 --> M7 --> C1
  C1 --> C2 --> C3 --> C4
```

Three rules make it one system. Every red CTA for a logged-out visitor goes to `/start`.
The five home cards are the only links that do not — they go sideways to the group landing
pages, which warm the visitor before the same front door. The group a visitor entered
through follows them as a hint, never a lock.

## Requirements

### Foundations

- R1. A `projects` table holds one project per row, keyed to a child, carrying group tag,
  name, description, offer sketch, first-customer hypothesis, status
  (`active|paused|abandoned`), creation route (`template|own_idea|revival`), template id,
  quiz answers, and AI generation metadata including whether the family edited the output.
- R2. A child may hold up to five projects, exactly one `active` at a time. Switching is
  instant. Abandoned projects can be revived.
- R3. The funnel **extends** the existing `families` / `parents` / `children` tables rather
  than introducing a parallel application model. The brief's Application is a family and
  its Applicant is a child. The dossier wizard already reads these tables and must not
  need a bridge.
- R4. Each child carries an applicant state: `added → project_created → submitted →
  deposited → enrolled`. State lives server-side and is consulted, never recomputed from
  scattered UI conditionals.
- R5. `Group` in `app/lib/site.ts` gains the landing-page fields — headline line 1,
  subhead, hero asset, phase colour token — rather than a parallel content module.
  Scholars' `href` changes from `/scholars` to `/groups/scholars`.

### Resume and identity

- R6. Email capture at C1 creates no password. The family's way back is a magic link sent
  to the captured parent address.
- R7. The magic link is sent from a **Server Action**, never the browser, so that
  `assertNoAuthMailToFwStudent` (`app/fp/lib/fw-provision-rules.ts`) sits in the request
  path. The recipient is passed through that guard before sending.
  `app/fp/lib/__tests__/no-auth-mail-guard.test.ts` enforces this and will fail on any
  unguarded `signInWithOtp(` added anywhere under `app/`. Adding this call site to
  `REVIEWED_CALL_SITES` instead of guarding it is not acceptable: the two entries already
  there are client-side and unguardable, which is the only reason they are exempt.
- R8. A session cookie carries the family through the ten-minute run with no auth friction.
  The magic link is the way back after the cookie expires or on another device.
- R9. Existing families with passwords keep signing in exactly as they do today. The Join
  modal retires for logged-out visitors only; nothing about an enrolled family's access
  changes.

### Marketing rewire

- R10. Every red CTA for a logged-out visitor routes to `/start` with a `src=` marker.
  Signed-in visitors see Dashboard instead.
- R11. The `src=` marker pattern in `app/2026-27/cta-source.ts` is promoted to
  `app/lib/` and used by every entry surface. Markers: `home`, `lp-athletes`,
  `lp-founders`, `lp-makers`, `lp-scholars`, `lp-givers`, `fp-generic`, `2026-27`,
  `tuition`, `faq`, `parents`, `scholars-legacy`.
- R12. The home hero gains its own red "Start Here →" CTA routing to `/start?src=home`,
  in the bottom-anchored content block below the subhead row, left-aligned with the
  headline, `px-7 py-4 text-sm`.
- R13. Every CTA label into the funnel reads **"Start Here →"**. "Start Building" survives
  only as the internal name of the `/start` stage.
- R14. The five home cards' footer line changes from `ENROLLING NOW · BOOK OR JOIN →` to
  `EXPLORE YOUR GROUP →`, each in its group's phase colour, linking to
  `/groups/[slug]` — scholars included.
- R15. Door colours by position: Athletes `--tp-phase-sell` `hsl(14 78% 54%)`, Founders
  `--tp-phase-build` `hsl(217 74% 56%)`, Givers `--tp-phase-validate` `hsl(265 52% 58%)`,
  Makers `--tp-phase-grow` `hsl(150 52% 42%)`, Scholars `--tp-phase-scale`
  `hsl(41 88% 52%)`.
- R16. **Contrast is checked at build time, not assumed.** Gold at 52% lightness and coral
  on `#f7f6f3` paper are both expected to fail small-text contrast. Where a token fails,
  a darkened text-safe variant of the same hue carries the label and the raw token is kept
  for any chip or underline accent. The funnel's own doors screen is untouched — First
  Profit DS already handles this.
- R17. These five tokens are the only Path-register colours permitted on the marketing
  site. They appear on the card footer line and the pre-selected door, nowhere else.
- R18. No "Book a call" appears anywhere on the logged-out marketing site. `BOOKING_URL`
  and `attributedBookingUrl()` survive but stop appearing before C1: the call is offered
  afterwards as a quiet mono link on the parent dashboard and inside nurture emails.

### Landing pages

- R19. One landing template instantiated six times: five group pages at `/groups/[slug]`
  and one group-neutral page at `/first-profit`. Roughly 90% shared content; only the hero
  image, headline line 1, and subhead vary.
- R20. Shared skeleton in order: floating white nav card, full-bleed hero with gradient and
  text lightbox carrying the live seats line, proof strip, the "What is The 120" paragraph,
  red CTA band, real site footer on `#0300ed`.
- R21. The "What is The 120" paragraph is identical on all six. It is where the network is
  sold and must not become group-flavoured.
- R22. Headline line 2 is constant across all six: italic blush *"We'll show you how right
  now."*
- R23. The seats line renders from `app/lib/seats.ts`. The prototype's hardcoded "113 OF
  120 SEATS REMAIN" is scaffolding.
- R24. Landing CTAs route to `/start?g=[slug]&src=lp-[slug]`. `/first-profit` uses
  `src=fp-generic` and sets no `g`.
- R25. Nothing internal links to `/first-profit`. It is the broad-ads destination only.
- R26. The retiring brochure treatment loses Book a call, the Join modal, and the
  "← THE 120 / see the groups" chrome. One exit, forward.
- R27. `/scholars` stays live and reachable by URL but is unlinked from the home cards. Its
  CTAs reroute to `/start?src=scholars-legacy`. Repurposing its content is out of scope.

### The spine

- R28. `/start` accepts `?g=` and `?src=` and renders a 3-page explainer, then capture,
  then Add a Child.
- R29. The explainer is three swipes, one idea each, eyebrow always "HOW IT WORKS": your
  child designs a real business; you'll see exactly where it leads; this is the
  application.
- R30. Capture asks parent first name, last name, and email. This is **Conversion 1** and
  posts to `app/crm/lib/lead-ingest.ts` with `entry_source` written onto the lead.
- R31. Add a Child takes first name and grade per child, one or more, addable at any later
  point. Grade drives band and skin: 3–5 Trail, 6–12 HQ.
- R32. An application progress bar runs in the floating nav card from explainer through
  submission, at the percentages the handoff fixes (explainer 5/8/11/15, add-child 20,
  handoff 25, doors 30, templates 38, quiz 46, compose 55, tasks 62, reveal 70, wizard
  80/90/96, submitted 100).

### The mini-app

- R33. The handoff seam renders in the child's skin and names the child. The device passes
  to the kid here and back at the Reveal's close.
- R34. Five doors, "Five doors. Pick yours.", each with arch numeral chip in its phase
  colour and kicker `GROUP 0n · SPORT|ENTREPRENEURSHIP|SERVICE|CREATIVE|GIFTED & TALENTED`.
- R35. **Door pre-selection is a hint, never a lock.** A session carrying `?g=` renders that
  door pre-selected at full strength with one line of band-register copy under it. One tap
  confirms. Tapping any other door switches instantly, with no confirmation dialog and no
  friction copy — switching must feel like choosing, not correcting.
- R36. The hint is family-level and first-child-only. Siblings pick cold. A session with no
  `?g=` renders the doors cold.
- R37. Two curated starter templates per group plus a third "I've got my own idea" box with
  a textarea. Template copy ships from the interactive brief §8.2.
- R38. The quiz is four band-phrased questions per group. Suggestions appear as grey
  placeholder text and are **never pre-typed**. Trail shows a parent-assist banner naming
  the group: the founder decides, a grown-up types.
- R39. AI composition is a single server-side call returning validated JSON: name (≤5
  words), description (≤120 words, second person, band register), offer sketch, first
  customer hypothesis. Never called from the browser.
- R40. Regeneration is limited to two per quiz run. Every field is editable afterwards and
  the edit is recorded. Per-template canned fallbacks render on error — the funnel never
  dead-ends on an AI failure.
- R41. AI output obeys the copy rules: no em dashes, no promised outcomes, no dollar
  predictions, no invented facts about the child, no brand names, no emoji. Kid inputs are
  filtered for profanity and brand names, and no real names or addresses reach the
  description.
- R42. The first-3-tasks screen shows three bubbles only — pitch a product in 60 seconds,
  make your first real sale, hear "no" three times — each with one project-customised
  sentence. Step 2 is strictly first product plus collecting payment from one person.
- R43. The Reveal renders above the fold in the child's skin: the five-step climb as a bar
  chart, SELL and BUILD complete, VALIDATE partial, GROW and SCALE dashed. It is labelled
  a projection and is **never presented as achieved fact**. The stat strip may cite only
  numbers that are actual pass criteria.
- R44. The Reveal closes in the application register with a red "Continue Application →"
  CTA and an italic band-worded parent line, above a four-row FAQ accordion closed by
  default. Opening a row emits an event.
- R45. A share card renders the project name, crests, and stat strip. It is downloadable by
  the parent only, consistent with the app's nothing-is-public rule.

### The close

- R46. The dossier wizard receives the funnel's work pre-done: the Group step is answered
  by the chosen door, and the Project step is pre-filled with the actual project the child
  built. The Workshops step is removed.
- R47. Basics arrives pre-filled with name and grade, with birth year auto-calculated as
  `2026 − 11 + grade` and editable.
- R48. The application asks for the child's email with a "Don't have one" option.
- R49. Submission is **Conversion 2**. The dossier header flips to SUBMITTED FOR REVIEW.
- R50. Next Steps is three swipes in the explainer UX: progress made, set your goal (with
  an editable goal input), secure the seat.
- R51. The deposit is $250, fully refundable until September 30 2026, stated at the point
  of ask. This date is read from the existing `DEPOSIT_REFUND_DEADLINE_LABEL` constant in
  `app/lib/site.ts` — one source, never a second literal.
- R52. Payment is **Conversion 3** and rides the existing Stripe rails.
- R53. Deposit receipt provisions the student account. If the family chose "Don't have
  one", a unique `@the120.school` address is created, and the parent is emailed the login
  address and password.
- R54. The arrival screen is an acceptance-letter moment, not a settings screen. Login
  email, fallback password, forced reset on first login, parent-email preview, and the
  September 30 calendar note.
- R55. Never-deposited families are never reaped. Applications stay on file indefinitely
  for re-engagement, exactly as a competitive school keeps applicant files. The evidence
  reaper exempts application-context records.

### Instrumentation and CRM

- R56. Every stage boundary emits an event with a shared schema carrying family, child,
  source, band, and group: `lp_view`, `start_view`, `explainer_start`, `c1_captured`,
  `child_added`, `quiz_start`, `door_confirmed`, `project_created`, `reveal_viewed`,
  `faq_opened`, `application_started`, `c2_applied`, `c3_deposit`, `student_account_created`,
  `c4_tuition`, plus `project_regenerated`, `project_switched`, `share_card_created`.
- R57. `door_confirmed` carries `{group, preselected, switched_from}`. The switch rate per
  landing page is the ad-targeting health metric.
- R58. The four conversions are first-class named conversions. `entry_source` persists from
  first touch through tuition so C1→C2→C3 is segmentable per entry surface. **This is the
  yardstick the ads plan needs, and it is why the marketing rewire ships before the
  mini-app.**
- R59. CRM pipeline stages map onto the funnel's states with time-in-stage, so staff can
  see where a family stalled: `email_captured → child_added → quiz_started →
  project_created → reveal_viewed → application_started → application_submitted →
  deposit_paid → enrolled`.
- R60. Quiz and project answers stream into the child's CRM dossier in real time, so staff
  see what a kid built before any parent conversation.
- R61. Nurture sequences key to the abandonment point: captured-but-no-child,
  child-but-no-project, project-but-no-application, applied-but-no-deposit. Each email
  deep-links to the exact resume point and carries the child's project name in the subject.

### Copy and register

- R62. Two registers, deliberately alternating. Application register (paper `#f7f6f3`, ink
  `#131416`, red `#d92632`, blue `#0300ed`, blush `#efc5b8`; Georgia display, Space Grotesk
  body, IBM Plex Mono labels) for landing, explainer, capture, dashboard, wizard, Next
  Steps, checkout, arrival, and the Reveal's close. First Profit app register (Trail or HQ
  by band, `--tp-*` tokens) for handoff through the Reveal's body.
- R63. Copy rules apply everywhere including AI output: no em dashes, phases are
  "complete" never "sealed", "Not Yet" never "failed", task IDs in mono, no emoji outside
  First Profit DS iconography.
- R64. Mobile-first is mandatory. The whole flow works one-handed on a phone.

## Build Order

Thirteen units in four phases. Phase 0 precedes everything; Phase 1 ships before Phase 2
because C1 is a real conversion and `entry_source` starts producing the data the ads plan
needs (R58) weeks before the mini-app is ready.

| Phase | Unit | Scope | Migration |
|---|---|---|---|
| 0 | U1 | Data model, `projects`, applicant state, `Group` landing fields | yes |
| 0 | U2 | Magic-link resume through the guard, session carry, C1 → lead-ingest | maybe |
| 1 | U3 | `cta-source` promotion, sitewide reroute, home hero CTA, card colours | no |
| 1 | U4 | Landing template ×6, scholars route, brochure retirement | no |
| 1 | U5 | `/start` explainer, capture (**C1**), Add a Child | no |
| 2 | U6 | Handoff seam, doors with `?g=` pre-selection, templates | no |
| 2 | U7 | Quiz, server-side AI compose, project page | no |
| 2 | U8 | First 3 tasks, the Reveal, FAQ accordion, share card | no |
| 3 | U9 | Wizard rewiring, pre-done group and project, child email (**C2**) | maybe |
| 3 | U10 | Next Steps, goal input, Stripe checkout (**C3**) | no |
| 3 | U11 | Arrival, student provisioning, school mailbox, credentials email | maybe |
| 4 | U12 | Event stream, CRM funnel stages, live dossier streaming | yes |
| 4 | U13 | Nurture sequences keyed to abandonment point | no |

## Dependencies Outside The Build

Three things this build cannot produce for itself.

1. **Hero photography does not exist.** All six landing pages need art; the handoff states
   it is not bundled. U4 builds the image slot and can merge without it, but those pages
   must not take ad spend until art lands. Generation prompts are in the unified brief
   §3.2 and the interactive brief §4.
2. **`@the120.school` mailbox creation is unsolved.** Founders Weekend provisions
   `*.fw@the120.school` addresses, but `no-auth-mail-guard.test.ts` states plainly that
   namespace has no catch-all and mail bounces into nothing. R53 needs a real mail-provider
   integration that does not exist today. U11 is blocked on it; nothing earlier is.
3. **No AI dependency exists in the repo.** R39 needs a provider. Recommendation is the
   Vercel AI Gateway through the AI SDK with plain `"provider/model"` strings, server-side
   only. This is a new dependency and a recurring cost line.

## Non-Goals

- Pre-deposit task work, the `1.2.1` gate, and the pre-deposit verification mechanic (F2).
  The data model must not preclude them; nothing in this build depends on them.
- Repurposing `/scholars` content.
- The Foundry name, the `/foundry` route, and the wordmark letterform swap (F1).
- Tuition-page redesign, ad creative, the Gauntlet, CRM work beyond `entry_source` and the
  stages of R59.
- Public sharing of anything. The share card is parent-only.
- AI that verifies or grades. The app's hard rule holds everywhere.
- Discounting mechanics at any gate.

## Success Criteria

- A logged-out visitor cannot reach the Join modal from any marketing surface.
- Every entry surface stamps a distinct `src=`, and C1→C2→C3 is segmentable by it from the
  event stream alone, per channel, per band, per group.
- A family can complete landing → deposit on a phone, one-handed, without a password.
- A family that abandons at any point can resume at the exact point of abandonment from a
  link in their email.
- The switch rate from a pre-selected door is measurable per landing page.
- No magic link can ever be addressed to a `*.fw@the120.school` address.
