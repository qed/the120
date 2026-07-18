---
date: 2026-07-17
topic: 2026-27-program-page
---

# The 2026-27 Program Page (`/2026-27`)

## Problem Frame

The 120 needs a flagship recruitment page for its founding year (2026-27) that sells the program to **parents** while letting a **kid** flip into a voice written for them. Today there is no `/2026-27` route, and the founding-year story is scattered across the home page and the five thin group pages. This page is the adaptation of `founders.school/freshman-year` for The 120: ages 8-17, variable pace, five groups, one program. It must feel serious, scarce, and honest — observable milestones (a real sale, a real product, real numbers), never revenue guarantees.

The build target is the **high-fidelity prototype** in `artifacts/2026-27 Page Handoff/design_handoff_2026-27_program_page/` (`.dc.html` + `README.md` + `program-data.js`), which supersedes the older `artifacts/2026-27-page-design-brief.md` (v2 draft). The prototype adds two signature interactions the brief lacks (a Parents/Kids audience toggle and a hero group selector) and promotes Math to its own section. The handoff README + `program-data.js` are the **source of truth for exact copy, tokens, and section specs**; this document captures scope, decisions, and reconciliations so planning does not re-derive them.

## Requirements

**Page shell & navigation**

- R1. New public route `/2026-27` (server page, `await getSeatsRemaining()`, exports metadata: title "The 2026-27 Year · The 120", description from the hero subhead). Follows the home/tuition/faq shared-chrome pattern, not the scoped `/scholars` chrome.
- R2. Add `2026-27` as the **first** link in the shared nav array (`app/lib/site.ts`), so it appears in the global `<Nav>` on every page **and** the `<Footer>` link row. Its nav link renders active (red) on this page.
- R3. Build a **page-only sticky anchor sub-nav** beneath the global nav: a horizontally-scrolling row of mono 11px links joined by `·` (`THE YEAR · WHO THEY BECOME · COACHING · BOOKS · SCHEDULE · THE LOOP · SKILLS · THE PATH · MATH · END OF YEAR`), with a **scroll-spy** that highlights the current section red/600. Anchors: `#year #become #coaching #books #schedule #loop #skills #path #math #end`. Anchor jumps are **instant** (brand convention: no smooth-scroll); sections carry `scroll-margin-top` to clear the sticky header. This is a **net-new primitive** — nothing like it exists in the codebase.
- R4. Pinned to the right of the sub-nav: the **PARENTS | KIDS** segmented control (the audience toggle, see R11).

**Content sections (fixed DOM order, band rhythm per handoff)**

- R5. Thirteen bands in this exact order and background: Hero (photo/blue) → `01` Year at a Glance (bone) → `02` Who They Become (white) → `03` Coaching (bone) → `04` Read Widely (white) → `05` The Schedule (bone) → `06` The Core Loop (white) → `07` The Skill Track (bone) → `08` The Path (**blue** statement band) → `09` The Foundation / Math (bone) → `10` End of Year (white) → CTA (**red**) → Footer (**blue**). Never repeat an adjacent band color. Each section opens with a numbered mono kicker + a Georgia headline with one italic accent phrase. Exact copy, card counts, and layouts per the handoff README §Sections. (Sub-nav labels in R3 are abbreviated forms of these section names, sized for the horizontal scroll.)
- R6. **Math is its own section (`09 · THE FOUNDATION`)**, not folded into "Who They Become." Peter confirmed the prototype's structure supersedes the v2 brief's one-to-one section-order rule (standalone Math §09; the blue statement band sits on The Path, not Books).
- R7. The **Path (§08)** is the richest section: a 5-node stepper (Sell → Build → Validate → Grow → Scale), three pacing cards, and a single-open FAQ-style accordion (Phase 01 open by default) rendering the 25 pass criteria. Pacing is explicitly "by mastery, not calendar."
- R8. **Read Widely (§04)** uses a three-tab track toggle (Grades 3-5 / 6-8 / 9-12); each track renders five path-phase groups of four books. Default tab = Grades 3-5.
- R9. **Schedule (§05)** renders the workshop date strip grouped Fall/Winter/Spring, with pill states (normal, ★ Demo Day, kickoff, special/TBD) plus month/week cadence blocks. **Honesty fix:** the data is 19 dated + 1 TBD, so the "Year at a Glance" figure is phrased "19 scheduled workshops (one more to be added)," not "20 sessions"; and the "1st and 3rd Saturday of every month" line is softened to match the actual dates (September starts on the 19th; January shifts to the 9th/23rd for the winter break).
- R10. **CTA band (red):** headline "One year. One real business. *One of 120.*", audience-aware buttons (see R11), and the shared `<SeatsDot>` driven by `getSeatsRemaining()` (not the prototype's hardcoded 113). **No pricing and no revenue guarantees anywhere on the page.**
- R20. **Conversion is the page's job — wire it to the existing funnel.** Every "Join" CTA (nav + red band + any inline) opens the shared `JoinButton` account modal; every "Book a call" CTA links to `BOOKING_URL` (`app/lib/site.ts`) — same targets the rest of the site uses. A primary CTA is reachable near the top (nav) so a decided parent never has to scroll the full page to act. Instrumenting Join / Book-a-call clicks for conversion measurement is desirable (deferred to planning — confirm whether analytics exist).

**Interactive layers**

- R11. **Audience toggle (Parents ↔ Kids), default Parents.** Swaps every string **that has a Kids variant** from a `COPY` dictionary (both voices already authored in the prototype). Deliberately shared strings stay unchanged: book titles, the group business lines (R12), and fixed headlines. Also swaps the Path accordion's "what parents see" label (`WHAT PARENTS SEE` ↔ `WHAT YOU'LL PULL OFF`) + step subtitles/principles, and the in-page red-band CTA labels (`Join the 120`/`Book a call` ↔ `Get my seat`/`Show my parents`). Not persisted (resets on reload). **Decided:** the toggle relabels **only the in-page red-band CTAs**; the shared global `<Nav>` stays untouched and session-aware ("one nav site-wide by design"). This keeps page-local audience state out of shared chrome — no coupling into `<Nav>`.
- R12. **Hero group selector**, default `The 120`: pills `The 120 · Athletes · Founders · Givers · Makers · Scholars`. Selecting a group swaps **only** the hero subhead to that group's business line; nothing else on the page changes (the hero note explains this). Single-voice lines (do not change with the audience toggle).
- R13. **Kids-only Path criteria sub-toggle** (`KID VOICE | ORIGINAL`), visible only when audience = Kids; Parents always sees original criteria and the control is hidden.
- R14. **Path accordion** single-open (`+`/`−`, Phase 01 open on load); **book tabs** switch the visible 5×4 grid. All interactive widgets are `"use client"` islands dropped into the server page (follow `PaceSimulator` → `scholars/page.tsx` precedent); do not convert the whole page to a client component.

**Content & data model**

- R15. All edit-prone content lives in a **typed data + copy module**: `workshopDates` (+ notes, parent/kid), `pathSteps` (+ `pathStepsKid`, the 25 criteria in both voices), `bookTracks` (3 tracks × 5 phases × 4 books) — these mirror the prototype's `program-data.js` — plus the `COPY` parents/kids dictionary. **Note:** the full `COPY` dictionary is **not** in `program-data.js`; it lives inside the prototype's `.dc.html` logic class and must be transcribed into the module (an error-prone extraction to budget for, plus an ongoing two-voice sync cost). Peter edits data, not markup. Copy for both audiences renders synchronously (no blank flash).

**Site-wide blue unification**

- R16. Unify the brand blue to electric **`#0300ED`** (and `--color-blue-dark` to its dark pair) by changing the token(s) in `app/globals.css`, removing the current marketing indigo `#22219B`, per the design-system readme ("one blue everywhere"). This re-colors every blue band across the site (home, group pages, tuition, footers, and the signed-in app), so it requires a visual pass on those surfaces, not just `/2026-27`. Because this reverses a deliberate, side-by-side-tested choice (the pure blue "vibrated against the warm palette"), planning must: (a) **re-verify the vibration** on the warm bone/paper marketing bands before committing; (b) sweep **hardcoded indigo literals** the token can't reach (e.g. `DashboardApp.tsx:254` `rgba(34,33,155,0.7)`); (c) confirm white/blush-on-blue contrast holds. See Deferred to Planning for the token/execution details.

**Visual system & responsive**

- R17. Reuse the existing design system exactly — tokens, `.eyebrow`/`.display` classes, Georgia/Space Grotesk/IBM Plex Mono roles, 14px card radius, hairline borders, 1px hover lift, 1240px max width. New **assemblies** only (no new primitives beyond the scroll-spy sub-nav): the 5-node stepper, 3-tab book toggle, 20-pill date strip, Core Loop arrow row.
- R18. Desktop-first with 920px and 600px breakpoints collapsing grids (3→2→1, 5→3→2), stacking the Path stepper vertically, and horizontally scrolling the sub-nav. `prefers-reduced-motion` respected.
- R19. Image slots: hero photo (full-bleed, solid `#0300ED` until filled) + optional coaching photo, using the site's existing placeholder approach. Real photography deferred.

## Success Criteria

- A parent can read the entire program story top-to-bottom in Parents voice; flipping to **Kids** swaps every string that has a Kids variant (shared strings — book titles, group business lines, fixed headlines — stay unchanged) with no layout break, no flash of the wrong voice, and no disorienting scroll jump (the section under the reader's eye stays in view despite the change in document height).
- The hero group selector changes the hero subhead for all six selections and leaves the rest of the page unchanged.
- The page's two conversion actions work end-to-end: "Join" opens the account modal and "Book a call" reaches `BOOKING_URL`, from both the nav and the red band, in both audience voices.
- The Path accordion, book-track tabs, and Kids-only criteria sub-toggle all behave per the handoff; the sub-nav scroll-spy tracks the active section on scroll and on anchor jump.
- `2026-27` appears as the first nav link site-wide and in the footer; the page passes it as active.
- After the blue unification, every blue surface across the site renders `#0300ED` with no lingering `#22219B` and no broken contrast.
- No pricing, no revenue guarantee, and no unverified quantitative claims (coach ratios, guest-founder counts) appear on the page. Seats are live via `getSeatsRemaining()`.
- Visual parity with the handoff screenshots at desktop; mobile stacks cleanly at both breakpoints.

## Scope Boundaries

- **No pricing and no guarantee/refund analog** on the page — Tuition stays one nav click away; founders.school's "$1M or refund" has no honest equivalent here.
- **No peer-vote advancement gate** (founders.school's elimination mechanic is deliberately dropped as harsh for an 8-17 / parent audience); June is framed as "the path picks up where it left off."
- **No unpublished numbers** — no student:coach ratio, no guest-founder count, no revenue targets. Add only when real.
- **No new design primitives** beyond the scroll-spy sub-nav; everything else is assembled from existing tokens/components.
- Real hero/coaching **photography is out of scope** (placeholders ship first).
- Ports of the prototype runtime (`support.js`, `image-slot.js`, the `.dc.html` framework) are **not** used — recreate in the app's React/Tailwind idiom.

## Key Decisions

- **Build the newer prototype, not the v2 brief** (confirmed by Peter): the prototype supersedes the v2 brief's same-day one-to-one section-order rule — standalone Math §09, blue band on The Path.
- **Full interactivity in v1 (both toggles)**: Parents↔Kids audience toggle + hero group selector + Kids-only criteria sub-toggle. Rationale: both voices are already authored in the handoff, so the marginal cost is wiring + the scroll-spy sub-nav, not copywriting. *Caveat from review:* the `COPY` extraction from the `.dc.html` is real (not free) work.
- **Audience toggle relabels only the in-page red-band CTAs** (Peter's call); the shared global `<Nav>` stays untouched and session-aware — no page-local state leaks into shared chrome (R11).
- **Ages 8-17** (Peter's call): match the shipped site; correct the page copy and the prototype/`COPY` data from the artifacts' 9-16. No other site surfaces change.
- **Hero group selector is a conscious bet**: it swaps only the hero subhead, so ~4 of 5 groups read a Founders-flavored body. Kept per Peter's "one program, adapt to your business" framing (the hero note explains it); flagged by review as a possible bait-and-switch for non-Founders. Optional mitigation (deferred): light per-group flavor in one or two body sections.
- **Unify blue to `#0300ED` site-wide now** (R16, Peter's call): per the design-system readme's "one blue everywhere" direction. Because it reverses a deliberate tested decision, planning re-verifies the vibration on warm bands, sweeps hardcoded literals, and checks contrast before committing.
- **Reuse the shared global `<Nav>`/`<Footer>`** and add `2026-27` to the single `nav` array (R2), rather than recreating the prototype's bespoke two-card header; the page-specific chrome is limited to the new sub-nav strip (R3-R4).
- **Content in a typed data/copy module** (R15), mirroring the prototype's `program-data.js` separation so non-devs edit content without touching markup.

## Dependencies / Assumptions

- **Verified against the codebase** (via repo scan): no `/2026-27` route exists; nav+footer share one `nav` array in `app/lib/site.ts` (the shared `<Nav>` comments state "one nav for every page — links are identical site-wide by design", and it has **no** "Book a call" button and **no** active-link styling — both are net-new work); seats come from `getSeatsRemaining()` (`app/lib/seats.ts`) with a `SEATS_REMAINING` fallback (currently 113, same as the prototype's hardcoded value, so "live seats" is presently a no-op); tokens live in a single `@theme inline` block in `app/globals.css` where `--color-blue` is currently `#22219b` (a **deliberate, side-by-side-tested** deepening from `#0300ED` — the globals.css comment says the pure blue "vibrated against the warm palette") and `--color-crm-blue` is `#0300ed`; indigo also appears as **hardcoded literals** not reachable by a token change (e.g. `DashboardApp.tsx:254` `rgba(34,33,155,0.7)`); interactive marketing widgets are `"use client"` islands in server pages (`PaceSimulator`→`scholars/page.tsx`); no scroll-spy/sub-nav/tab-panel primitive exists.
- **Age reconciled to 8-17** (Peter's call): the artifacts' 9-16 is wrong; the build corrects the page copy and the prototype/`COPY` data to match the shipped site's 8-17. (Grade-band book tracks 3-5 / 6-8 / 9-12 are unaffected.)
- **Section order confirmed**: the prototype supersedes the v2 brief's one-to-one rule (standalone Math §09, blue band on The Path).
- Workshop dates, the ★ Demo Days, and the Jan 9 winter-break shift are already resolved inside `program-data.js` (19 dated + 1 special/TBD; the "20 sessions" copy is corrected per R9). Venue stated as "in Toronto," no address. Summer 2027 not addressed.
- AI is vendor-neutral on the page except the two named tools (Math Academy, The Gauntlet); the Grow/Scale criteria also name "Claude Cowork or an AI agent" per the prototype data.
- The Founders group page (`/groups/founders`) coexists with this page; a "SEE THE 2026-27 YEAR →" link back from it is a nice-to-have, not required for v1.
- **Carry-over to confirm (from the v2 brief, low-stakes):** whether each workshop "runs twice, 9am-12pm and 12pm-3pm, same session" and whether the hard **math gate** ("if math falls behind, business work pauses until it's back on track") should appear on the page. The prototype does not surface either; confirm during planning.

## Outstanding Questions

### Resolve Before Planning
- *(All five review-surfaced decisions resolved: unify blue site-wide now · ages 8-17 · audience toggle relabels the red band only · prototype section order (standalone Math §09) · "20 sessions" reworded to 19+1.)*

### Deferred to Planning
- [Affects R16][Technical] Whether to collapse `--color-blue` and `--color-crm-blue` into one token (a ~40-file CRM refactor) or leave duplicate tokens with the same value; enumerate every blue surface **and hardcoded indigo literal** (e.g. `DashboardApp.tsx:254`) for the visual pass; **re-verify the vibration** on the warm marketing bands; confirm the `--color-blue-dark` electric-pair value (`#0200BD`?); add a measurable contrast threshold (WCAG AA) for white/blush-on-blue.
- [Affects R2][Technical] Adding pathname-based active-link styling to the shared `<Nav>` without visually changing Tuition/FAQ/etc.
- [Affects R3, R4][Technical] Scroll-spy technique (IntersectionObserver vs scroll listener) and its coexistence with instant anchor jumps; the sticky sub-nav's `top`/`scroll-margin-top` offset under the *floating-card* nav (whose height changes when the mobile menu expands); deep-link entry (landing on `/2026-27#schedule` should spy-highlight on load); and whether the audience toggle is pinned outside the scrolling row on mobile.
- [Affects R11, R13, R14][Technical/Design] Keyboard + ARIA contract for the five widgets (tablist/tab/tabpanel, `aria-expanded`, `aria-current`, `aria-pressed`), focus management when the Kids-only sub-toggle unmounts, minimum tap targets for mono-11px links/pills, and whether accordion/tab/sub-toggle open-state persists or resets across an audience flip.
- [Affects R15][Technical] Where the data/copy module lives and its typed shape (e.g., `app/2026-27/data.ts` + a `COPY` map), and whether any of it belongs in shared `app/lib/site.ts`.

## Next Steps
Resolve Before Planning is empty → **`/ce:plan`** for structured implementation planning.
