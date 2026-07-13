# Handoff: The 120 Admin CRM (`/crm`)

**Target codebase:** `qed/the120` (Next.js App Router, Supabase, Stripe, Resend, Vercel — live at the120.school)
**Reference pattern source:** `alphahub` repo (pipeline CRM being ported)
**Design authority:** `crm-design-brief.md` (bundled) — the approved product + visual spec. This README documents the prototype; the brief is the contract. Where they disagree, the brief wins.

## Overview

A staff-only CRM for two users (peter@ / ethan@the120.school) to run the 8-week GTM sprint and the September close: pipeline of families derived from real system events, dossier review queue (roadmap ticket S5), GTM sprint dashboard, and a content library with a CASL-gated send composer.

## About the Design Files

`120 CRM.dc.html` is a **design reference built in HTML** — a working interactive prototype showing intended look and behavior. It is NOT production code. The task is to **recreate this design inside the existing Next.js/Supabase app** using its established patterns (server components, server actions, RLS, the existing Supabase auth) and the alphahub reference implementation listed in the brief §15. Open the file in a browser to explore it; all screens, states, and interactions are clickable.

## Fidelity

**High-fidelity.** Colors, type, spacing, radii, and component treatments are final and match The 120 design system (`artifacts/The 120 Design Handoff/`, esp. `Admin.dc.html` / screenshot 17). Recreate pixel-perfectly. All data in the prototype is illustrative seed data (mid-sprint, "today" = Thu Aug 6, 2026, week 4); real data comes from Supabase per brief §5/§10.

## Screens (all in the one file, reachable via the tab row)

1. **Login** (`/crm/login`) — full-bleed `#0300ED`, centered bone card (`#F7F6F3`, radius 12, 380px), 120 logo lockup + blush STAFF ONLY pill, Georgia 28px "Staff sign-in", email + password only, red SIGN IN button, mono footnote "NO SIGN-UP · NO RESET LINK · ACCESS IS PROVISIONED BY SCRIPT". Generic error on failure. (Toggle via the `startLoggedIn` tweak or SIGN OUT.)
2. **Persistent chrome** — `#0300ED` top bar: red 120 chip, wordmark, hairline divider, mono breadcrumb (`ADMISSIONS · <SECTION>`), blush STAFF ONLY pill, live seat label right (`20 SEATS FILLED · 100 REMAIN` from `seats_claimed()`). Below: tab row on `#ECEAE5` with mono chips (active = `#0300ED` filled), signed-in email + SIGN OUT at far right.
3. **GTM Sprint Dashboard** (`/crm`, default) — top to bottom:
   - W1–W8 week strip (8 segments; past = ✓/✕ result tick, current = blue filled, click retargets the whole dashboard's targets to that week).
   - "This week" card: mono kicker (`PHASE 2 · SEED · W4 · AUG 3–9`), Georgia headline (primary push), checkable actions list (checked = strikethrough + `PETER · <date>` byline), distinct ASSET row (blue pill), non-funnel target chips (manual ones have −/+ steppers; met = green `#0E8A5F`), weekly-rhythm mono footer. All-checked → blush WEEK CLEARED pill.
   - KPI strip (4 bone cards, mono kicker / Georgia numeral / mono foot): Interested /200, Calls booked·held, Deposits /48, Seats remaining (pulsing red dot).
   - Deposit thermometer: `#D92632` fill on `#E0DDD7` track, goal marker at 48, track scaled to stretch 55.
   - Funnel-vs-plan table: 6 stages × actual/target/Δ; Δ green ≥0, amber under, red = 30%+ under (footnoted rule).
   - Today's Briefing: Follow-ups due / Cooling off / Warming up — each item opens that family's drawer.
   - Source & ambassador tally (leads + deposits per source, `↳ AMB-*` sub-rows) · Seats by group (bars /24, Scholars red + cap warning).
   - This-week stats chip row.
   - **Two layout options** (user-requested): `BRIEFING RAIL` (briefing/tallies in a right rail, KPIs 2×2) vs `STACKED` (full-width, KPIs 4-up, briefing 3-col). In-page toggle top-right + `dashboardLayout` prop. Ship one; rail is the default.
4. **Pipeline — table** — filters (stage chips / source chips / ⚠ NEEDS ATTENTION toggle), TABLE/KANBAN toggle (persisted in localStorage), red ADD FAMILY. Columns: Family (bone initials avatar, name 600, kids·area), Stage pill, Heat (5×8px squares, filled `#D92632`), Source (+ AMB code), Concerns (max 2 chips + `+N`), Consent (green `✓ CASL` / blush `NO CASL` pill), Last touch (green ≤7d / amber ≤14d / red >14d), Next action (from `deriveNextMove` — same function as the co-pilot). Row click opens drawer. Empty filter result → Georgia "The pipeline starts with one family." + ADD FAMILY.
5. **Pipeline — kanban** — 6 columns (INTERESTED · ACCOUNT · DOSSIER · CALL · DEPOSIT PAID · MEMBER), sub-badges (STARTED/SUBMITTED, BOOKED/HELD). Only CALL is droppable (dashed blue border + DROP OK): drop stamps call booked, second drop stamps held, with confirming toast; drops on derived columns are rejected with an explanatory toast.
6. **Contact drawer** (`?family={id}`) — 920px slide-over (full-width <920px), URL-driven (pushState; back button closes). Header: Georgia name, kids string, derived stage pill **with derivation caption** ("Via Stripe · Aug 3"), heat pips, last-touch chip; buttons LOG CALL BOOKED / LOG CALL HELD (become ✓-stamped), SEND FROM LIBRARY, MARK LOST, MARK WAITLIST (toggles). Body: **Co-pilot card first** (`#0300ED`, blush kicker with pulsing red dot, Georgia-italic summary, white next-move pill, up to 3 suggested library items scored `helpfulness*2 + sends`), then activity timeline (merged system/stage/send/note events, colored dots: blue system, red stage, green send, gray note; notes render Georgia italic) with LOG NOTE input. Aside (340px): About (+ LINKED ACCOUNT / MANUAL LEAD, consent line), Engagement signals (2-col toggle pills), Concerns (chip picker, active = red), Heat (clickable squares; dashed outline marks the auto-suggested value when overridden; "AUTO SAYS n" note), Private notes (Georgia italic).
7. **Add-family modal** — required first/last, optional email/phone/spouse/area/source/referral, 2 kid rows, CASL consent checkbox revealing consent source+date input, duplicate-email merge warning. Creates an INTERESTED manual lead.
8. **Dossier queue** — the Admin.dc.html two-pane layout, plus the S5 additions: **payment strip** (`$250 PAID · <date>` green / `REFUNDED` red / `NO DEPOSIT` gray + OPEN IN STRIPE), **GROUP chip row** (5 groups, nullable, feeds dashboard seat counts), completeness % + PRINTABLE DOSSIER link. MOVE CANDIDATE chips write review_status; MEMBER OF THE 120 flips the family's pipeline stage.
9. **Library + send composer** — type filter chips; cards: type pill (FAQ blue / TALKING red / DATA green / ASSET ink) + concern tag, title, blurb, `N SENDS · HELPFUL ×n`, HELPFUL + button, blue SEND. Composer modal: family + item selects, prefilled editable subject/body, **hard CASL block** (red-bordered card, SEND disabled) for non-consented families, MARK SENT ELSEWHERE (logs without emailing), mono footer `FROM ADMISSIONS@THE120.SCHOOL · BCC ADMISSIONS@`.
10. **Empty / edge states in the prototype:** filtered-empty pipeline; co-pilot insufficient-data state (open George Papadopoulos or Marcus Hill); CASL-blocked composer (pick Rob Petrov or Marcus Hill); refunded deposit → demoted stage (Priya Raman, waitlisted); WEEK CLEARED (check all W4 actions).

## Interactions & Behavior

- Stage is **derived, never dragged** — precedence in brief §5.2. The prototype's `stageOf()` implements it exactly; port as one shared SQL view/TS function.
- `deriveNextMove` rules 1–9 (+ a rule-0 "set concerns and signals" empty state) and `suggestHeat` (base per stage: member/deposit 5, call-held 4, call-booked/dossier/account 3, interested 2; +1 at ≥3 signals, +2 at ≥5; −1 >14d, −2 >21d) are implemented in the prototype logic — port them 1:1 with unit tests (brief §12).
- Every mutating action updates `last_touch_at`, logs a timeline event, and shows a confirming toast (dark ink pill, bottom-center, mono, ~2.8s).
- View toggle persists to localStorage (`the120.crm.viewMode`); drawer state is in the URL.
- Kanban drop validation mirrors alphahub's ALLOWED_TRANSITIONS pattern.
- Desktop-first; everything survives narrow widths (drawer → full sheet, grids wrap).

## State Management (production)

Per brief §5: `families` + `family_notes`, `family_stage_history`, `crm_audit_log`, `library_items`, `library_sends`, `gtm_weekly_targets`, `gtm_weeks`; `children.review_status/group/review_notes`. Auth per brief §3 (staff allowlist, JWT role, RLS). Sync contract per brief §10.

## Design Tokens

- **Colors:** app bg `#ECEAE5` · card `#F7F6F3` · elevated/selected `#FFFFFF` · primary `#0300ED` · action/heat/alert `#D92632` · blush `#EFC5B8` · ink `#131416` · muted `#55585E` · faint `#9FA2A7` · hairlines `#DDDAD4` / `#D8D5CF` · bone chip `#E0DDD7` · functional green `#0E8A5F` · functional amber `#B85C00`
- **Type:** Georgia 400 (page titles 28px, drawer names, card headlines 24–26px; italic for co-pilot summary, project pitch, private notes) · Space Grotesk 400/500/600 (body 11.5–15.5px; 600 names) · IBM Plex Mono 8.5–11px, letter-spacing 0.04–0.12em, uppercase, `·` separators (all labels/kickers/pills/buttons/numbers)
- **Radii:** 10px buttons/inputs · 12px cards/modals · 100px pills/chips · 4px checkboxes/heat squares
- **Shadows:** selected glow `0 2px 10px rgba(3,0,237,0.10)` · overlay `0 4px 18px rgba(19,20,22,0.14)` · scrim `rgba(19,20,22,0.35)`
- **Stage pills:** INTERESTED/ACCOUNT `#E0DDD7`/`#55585E` · DOSSIER/CALL `#0300ED`/white · DEPOSIT PAID/MEMBER `#D92632`/white · LOST `rgba(19,20,22,0.6)`/white · WAITLIST `#EFC5B8`/ink
- Heat pips are **squares** (8px, matching the square 120 logo chip), not dots. No gradients anywhere. Fonts loaded from Google Fonts (Space Grotesk, IBM Plex Mono); Georgia is system.

## Assets

None beyond fonts. The "120" logo chip is typography (red box, white 700 text). No images/icons — glyphs are text (✓ ✕ ⚠ ↗ ·).

## Screenshots

`screenshots/` — reference captures of each screen/state (the live prototype is still the authority):
01 dashboard (briefing-rail layout) · 02 dashboard (stacked layout) · 03 pipeline table · 04 kanban · 05 contact drawer (co-pilot + timeline + aside) · 06 add-family modal · 07 dossier queue · 08 library · 09 send composer with CASL block · 10 login.

## Files

- `120 CRM.dc.html` — the full interactive prototype (open directly in a browser; `support.js` must sit beside it). Template = markup; the `<script data-dc-script>` class holds all behavior incl. `stageOf`, `suggestHeat`, `nextMove`, seed data.
- `support.js` — prototype runtime only; not part of the handoff spec.
- `crm-design-brief.md` — the approved product/design brief. Implementation phasing in §13; auth in §3; data model in §5; sync contract in §10; open questions in §14.
- `screenshots/*.png` — reference captures (see above).
