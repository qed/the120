# Design Brief — The 120 Admin CRM (`/crm`)

**Date:** 2026-07-13 · **Author:** Peter (with Claude) · **Audience:** Claude Design (visual design pass) → Claude Code (implementation in `qed/the120`)
**Status:** Approved direction. Full scope described here; implementation will be phased by the operator.

---

## 1. What this is

A staff-only CRM at **`the120.school/crm`** for exactly two people — **peter@the120.school** and **ethan@the120.school** — to run the 8-week GTM sprint (`artifacts/gtm-8-week-sprint.md`) and the September close: 200 CASL-consented interested families, 48–55 paid $250 deposits by Sept 1, all 120 seats committed by Sept 30.

It is the **alphahub Pipeline CRM, re-skinned and re-plumbed**:

- **Bones (layout, components, interaction patterns)** come from `alphahub` (`C:\Users\pkupe\Aardvark\alphahub`): pipeline table + kanban, 920px contact drawer with URL state, deterministic Conversation Co-pilot, heat/concerns/engagement-signals model, KPI dashboard with deposit thermometer and Today's Briefing, content library with send tracking.
- **Skin (every color, font, radius, and voice)** comes from The 120 design system (`artifacts/The 120 Design Handoff/`), matching the existing staff screen `Admin.dc.html` / `screenshots/17-admin.png`.
- **Data** comes from The 120's live Supabase (parents / children / deposits / attribution) — the pipeline is **derived from real system events wherever the system knows the truth**, hand-edited only where it doesn't.

Key difference from alphahub: alphahub was a multi-geography, multi-champion tool where every prospect was hand-entered and hand-dragged. The 120 is **one city, two staff users, and a live funnel that already writes to the database** (signups, dossiers, Stripe deposits, referral codes). The CRM's job is to make that truth visible and tell the operator the next move — not to be a data-entry chore.

This CRM also **absorbs roadmap ticket S5** (admin review queue with payment visibility) and delivers the GTM plan's "weekly-metrics dashboard" (§5, W8 checklist).

---

## 2. Current state (facts the design must respect)

**The 120 app** (repo `qed/the120`, Next.js, Vercel, live at the120.school):
- **Auth:** Supabase email+password (auto-confirm; custom SMTP via Resend in progress — roadmap S6b). Parents sign up via a join modal. **There is already a user system** — this project adds a *staff role*, not a new auth stack. Do **not** port Clerk from alphahub.
- **Data:** Supabase project `the120` with `parents` (incl. CASL consent, `heard_about`, `referral_code`), `children` (dossier: subjects, workshops, project pitch, completeness %, status: Draft → Submitted → …), `deposits` (Stripe Checkout, webhook-driven, `paid`/`refunded`), `seats_claimed()` (live count = 120 − 7 founding − paid deposits).
- **Payments:** Stripe on the Hatch Coding CDN account, descriptor "THE120", test mode until S10 completes. Webhook already flips deposit state in seconds (E6-verified).
- **Email:** Resend live, domain verified, welcome email #1 shipping from `hello@the120.school`, reply-to `admissions@`.
- **Booking:** cal.com/peter.k/the120 (no webhook integration yet — call booked/held is invisible to the DB today).
- **Known gap:** children have **no group field** yet (Athletes/Founders/Makers/Scholars/Givers picker is roadmap S8). The CRM schema should include it (nullable) because per-group seat caps are GTM Open Question 2.

**alphahub** (reference implementation — read `docs/brainstorms/pipeline-crm-requirements.md` and `docs/plans/2026-05-02-001-feat-pipeline-crm-plan.md` for the full pattern language):
- Pipeline stages with `ALLOWED_TRANSITIONS`, heat 1–5 with `suggestHeat()`, constrained `concerns[]` and `engagement_signals[]`, `last_touch_at` maintained in server actions (not triggers), `deriveNextMove()` pure-function co-pilot, `library_items`/`library_sends`, notes + status_history merged into one timeline, audit_log on every write, kanban with drag validation, drawer driven by `?prospect={id}`.

**Mailbox caveat:** only `peter@the120.school` exists as a Workspace user today (`admissions@` is an alias on it). `ethan@the120.school` receives no mail until the mailbox is created — so Ethan's staff account must be **seeded with a password by script**, and password-reset for him is unreliable until his mailbox exists. Flag this in implementation notes.

---

## 3. Auth & access control

**Decision: reuse Supabase auth. Staff = allowlisted admin flag. No public staff signup.**

- New table `staff` (`id` FK → `auth.users`, `email`, `role text check (role in ('admin'))`, `is_active`, timestamps). Two rows ever, for now.
- Hard allowlist: a seeding script (`scripts/seed-staff.ts`, modeled on alphahub's `scripts/set-admin.ts`) creates/links auth users for **peter@the120.school** and **ethan@the120.school** only, sets `app_metadata.role = 'admin'` (server-set metadata → lands in the JWT, spoof-proof), and inserts the `staff` rows. Rotate initial passwords on first login.
- **`/crm/login`**: email + password only. No sign-up link, no OAuth, no magic link (Ethan's mailbox caveat). Generic error on failure. If a signed-in *parent* hits `/crm`, they get a 404-style "staff only" screen — never a hint that the route matters.
- **Guards, in depth:** middleware on `/crm/*` (JWT role check) → `requireStaff()` server helper on every page/action (alphahub's `requireAuth`/`requireAdmin` pattern) → RLS: all new CRM tables readable/writable **only** where `auth.jwt()->>'role' = 'admin'`; parents-facing tables gain no new parent-visible surface. CRM fields (heat, concerns, notes) must **never** appear in any parent-accessible response.
- Existing parent RLS is untouched; CRM reads of `parents`/`children`/`deposits` happen via server-side service-role queries inside staff-guarded server actions/pages (alphahub does exactly this).
- Audit: every CRM write logs to `crm_audit_log` (actor, action, family_id, metadata) — same action-enum pattern as alphahub's `audit_log`.

---

## 4. Information architecture

```
/crm                → GTM Sprint Dashboard (default landing)
/crm/pipeline       → Family pipeline: table view + kanban toggle
/crm/pipeline?family={id} → 920px contact drawer (deep-linkable, back closes)
/crm/dossiers       → Dossier review queue (per child) — absorbs roadmap S5
/crm/dossiers?child={id}  → dossier detail pane (the Admin.dc.html layout)
/crm/library        → Content library + send composer
/crm/login          → staff sign-in
```

Persistent chrome: the **Admin.dc.html top bar** — `#0300ED` band, 120 logo chip, mono breadcrumb (`ADMISSIONS · PIPELINE`), blush `STAFF ONLY` pill, live seat label right-aligned (`7 SEATS FILLED · 113 REMAIN`, from `seats_claimed()`). Below it, a slim tab row: **Dashboard · Pipeline · Dossiers · Library** (IBM Plex Mono, 11px, letterspaced; active = `#0300ED` filled chip). Signed-in user + sign-out at far right. Desktop-first (two users on laptops); everything must merely *survive* on mobile (drawer → full-screen sheet, grids stack), same breakpoint behavior as alphahub.

---

## 5. Data model (new tables + derivation)

### 5.1 `families` — the CRM spine

One row per family (household). Two origins:
- **Auto-synced:** every `parents` row gets a `families` row (created by backfill + on-signup trigger/action), `parent_id` set.
- **Manual leads:** quick-added by staff (coffees, info-session RSVPs, FB DMs) with `parent_id` NULL. **Auto-merge:** when someone later signs up with a matching email, link the lead row to the new `parents` row (keep CRM history, prefer account data for identity fields).

Columns (CRM-owned unless noted):

| Column | Notes |
|---|---|
| `parent_id` (nullable FK) | link to live account; NULL = manual lead |
| `parent_name`, `email` (citext, unique where not null), `phone`, `spouse_name` | for leads; account rows read identity from `parents` |
| `source` | constrained: `warm-network`, `ambassador`, `gauntlet`, `facebook-group`, `abc-ontario`, `math-contest`, `sports-arts`, `info-session`, `coffee-intro`, `website`, `other` — mirrors GTM channels; auto-set from `parents.heard_about` when synced |
| `referral_code` | `AMB-FIRSTNAME`; synced from `parents.referral_code` or entered manually |
| `consent_given`, `consent_at`, `consent_source` | **CASL is a first-class field.** Account signups = express consent from join flow. Manual leads default `false` until staff confirms (RSVP, opt-in form). Non-consented rows are visually flagged and excluded from the "interested families" KPI and from the send composer. |
| `heat_score` smallint 1–5 default 3 | auto-suggested, manually overridable (alphahub R1 + `suggestHeat`) |
| `concerns text[]` | constrained set, §7 |
| `engagement_signals text[]` | constrained set, §7 |
| `last_touch_at` | updated in every server action that touches the family (alphahub R4 pattern) |
| `call_booked_at`, `call_held_at` (nullable timestamptz) | **manual** one-tap stamps — the only funnel facts the system can't see (Cal.com webhook is a later enhancement) |
| `stage_override` (nullable: `lost`, `waitlist`) | manual exits from the derived pipeline |
| `deposit_asked_referral` boolean | powers co-pilot rule 2 |
| `area` (nullable text) | Toronto neighbourhood, replaces alphahub's `neighborhood` — free-ish text with typeahead (Leaside, Beaches, North York…) |

Supporting tables, all copied structurally from alphahub: `family_notes`, `family_stage_history` (logs derived-stage transitions + overrides), `crm_audit_log`, `library_items`, `library_sends` (see §9), plus two seeded GTM tables (§8): `gtm_weekly_targets` (numeric cumulative targets per week) and `gtm_weeks` (the qualitative week plan: phase, primary push, actions checklist, asset, non-funnel targets, checklist state).

### 5.2 Pipeline stage — derived, not dragged

`stage` is a **computed property** (SQL view or shared TS function — one source of truth used by table, kanban, KPIs):

```
if stage_override                     → LOST or WAITLIST
else if any child review = member     → MEMBER            (from dossier queue, §6)
else if any deposit paid              → DEPOSIT PAID      (deposits table, webhook truth)
else if call_held_at                  → CALL HELD         (manual stamp)
else if call_booked_at                → CALL BOOKED       (manual stamp)
else if any child status ≠ Draft      → DOSSIER SUBMITTED (children table)
else if any child row exists          → DOSSIER STARTED   (children table)
else if parent_id                     → ACCOUNT CREATED   (parents table)
else                                  → INTERESTED        (manual lead)
```

Precedence = GTM funnel order (§1 of the sprint doc). Consequences:
- **No drag-and-drop into system-derived stages.** Kanban cards *can* be dragged only onto `CALL BOOKED`, `CALL HELD`, `LOST`, `WAITLIST` (which set the underlying stamp/override, with a toast confirming what was recorded); drops onto derived columns are rejected with a toast explaining "this stage comes from the account/dossier/Stripe" — the `ALLOWED_TRANSITIONS` validation pattern from alphahub, repurposed.
- Deposit refunds (webhook) automatically demote the family out of DEPOSIT PAID; stage history logs it.

### 5.3 Dossier review status — per child (§6)

`children` gains `review_status` (`submitted`, `in-review`, `invited-to-assessment`, `offered-a-seat`, `member-of-the-120` — exactly the handoff's stages), `review_notes`, `group` (nullable enum of the five groups), reviewer + timestamps. Staff-only writes.

---

## 6. Screen: Dossier review queue (`/crm/dossiers`)

**Build `Admin.dc.html` for real** — the design already exists (screenshot 17). Two-pane layout on `#ECEAE5`:

- **Left — queue:** Georgia 28px "Dossier queue", mono count (`6 OF 6 DOSSIERS`), mono filter chips (ALL + five review stages; active = `#0300ED` filled), rows: child name (600, 15.5px), `Grade 4 · Cottingham Jr PS` meta, date, status pill (early = `#E0DDD7`/ink, mid = `#0300ED`/white, MEMBER = `#D92632`/white). Selected row: white bg, 1px `#0300ED` border, blue glow shadow.
- **Right — detail:** red mono kicker `CANDIDATE DOSSIER`, Georgia name, meta; two bone info cards (SUBJECTS, PARENT); the blue `PROJECT PITCH` card (Georgia italic, `#F7F6F3` text, blush kicker); INTERESTS & EVIDENCE; **MOVE CANDIDATE** stage chips; TEAM NOTES textarea.
- **Additions beyond the prototype (this is the S5 ticket):**
  - **Payment strip:** deposit state chip (`$250 PAID · Jul 20` green / `REFUNDED` red / `NO DEPOSIT` gray) + "Open in Stripe" link to the customer/payment.
  - **Group assignment** chip row (five groups, nullable) — feeds per-group seat counts on the dashboard.
  - Dossier completeness % and a link to the printable dossier.
  - Review actions write `review_status`, log to stage history/audit; "MEMBER OF THE 120" is what flips the family's pipeline stage to MEMBER.

---

## 7. Screen: Pipeline (`/crm/pipeline`) + contact drawer

### Table view (default) — alphahub's `pipeline-table` restyled

Columns: **Family** (initials avatar in bone circle, parent name, `2 kids` count) · **Stage** (mono pill, colors §11) · **Heat** (5 pips, filled = `#D92632`) · **Source** (mono chip; ambassador rows show `AMB-NAME`) · **Concerns** (max 2 chips + `+N`) · **Consent** (small ✓ / `NO CASL` warning chip) · **Last touch** (green ≤7d `#0E8A5F`, amber 8–14d, red >14d) · **Next action** (from `deriveNextMove` — same function as the co-pilot).

Filters above (mono chips, cross-filtered counts): stage pills · source pills · "Needs attention" toggle (red last-touch or unaddressed concern). Right side: view toggle (TABLE / KANBAN, persisted in localStorage) + **ADD FAMILY** button (red `#D92632`).

**Add-family modal** (alphahub R12): required parent first/last; optional email, phone, spouse, area, source, referral code, kids (name + grade rows); **CASL consent checkbox with date + source** ("RSVP'd to info session Jul 22"). Duplicate-email check against families + parents.

### Kanban view

Columns = the nine derived stages minus LOST/WAITLIST (those live behind a table filter, per alphahub R14) — suggest collapsing to six visible columns: INTERESTED · ACCOUNT · DOSSIER (started+submitted, sub-badged) · CALL (booked/held sub-badged) · DEPOSIT PAID · MEMBER. Cards: name, `2 kids · Leaside`, heat pip, last-touch dot. Drag rules per §5.2.

### Contact drawer (`?family={id}`) — alphahub's crown jewel, kept whole

920px slide-over, URL-driven, back-button closes, full-screen sheet <768px.

- **Header:** name (Georgia 28px), kids string, area, derived-stage pill **with derivation tooltip** ("Deposit paid · via Stripe Jul 20"), heat pips (clickable override), last-touch chip, buttons: `LOG CALL BOOKED` / `LOG CALL HELD` (stamp + toast), `SEND FROM LIBRARY`, `MARK LOST/WAITLIST`.
- **Body — Co-pilot card first** (see below), then **activity timeline**: merged notes + stage history + system events (account created, dossier submitted, welcome email sent, deposit paid/refunded, library sends), colored dots by type — alphahub R17 with more event types because The 120 has real events.
- **Aside (360px):** About (contact info, edit inline; account rows show "linked account" + email-verified state) · Engagement signals (2-col toggle pills) · Concerns (chip picker) · Heat (auto-suggested value shown ghosted, override pips) · Private notes (Georgia italic).

### The 120 concern set (replaces alphahub's)

`price-value` ("$3,000 for what exactly?") · `full-core-cost` ($15,000 tier) · `refund-terms` · `time-commitment` (3–5 hrs/wk on top of school) · `screen-time` (Tin Can is the *answer* — screen-free phone) · `socialization` · `curriculum-fit` (Ontario/homeschool alignment, TimeBack/Math Academy) · `selectivity-anxiety` (assessment, "is my kid good enough") · `spouse-buy-in` · `logistics` (getting to intensives, virtual cohorts).

### The 120 engagement-signal set

`explainer-sent` (one-page PDF) · `gauntlet-played` · `info-session` (RSVP/attended) · `group-sheet-sent` (the five one-pagers) · `parents-story-sent` (/parents) · `deposit-link-shared` · `ambassador-connected` (family knows an ambassador kid) · `dossier-nudged`.

### Co-pilot (deterministic, no LLM — alphahub R19–R23)

Card styled as the **PROJECT PITCH card**: `#0300ED` bg, radius 12, blush mono kicker `CONVERSATION CO-PILOT` with pulsing red dot, summary in **Georgia italic `#F7F6F3`**, next-move pill (white bg, ink mono text), 3 suggested library items matched by concern (alphahub's scoring: `helpfulness*2 + send_count`, backfill by global send_count).

`deriveNextMove` rules, first match wins — **rewritten for the GTM sprint**:

1. `stage_override = lost` → "Lost. No action."
2. `stage = member || deposit-paid` and `!deposit_asked_referral` → "Founding 120 welcome — ask for one introduction." *(GTM §5 nurture)*
3. `call_held && no deposit && days ≥ 1` → "Send the T+1 recap + deposit link. Refundable until Sept 30." *(GTM nurture table)*
4. `dossier submitted && !call_booked && days ≥ 2` → "Call them personally — submitted dossier, no call." *(W7 play)*
5. unaddressed concern (no matching library send) → "Send an answer to their ‘{concern}' concern." + matched items
6. `account && no child rows && days ≥ 2` → "Dossier nudge — ‘the dossier is the application.'"
7. `days > 21 && heat ≤ 2` → "Cold. One last info-session invite, then mark lost."
8. `stage ∈ {interested, account} && heat ≥ 4 && days > 5` → "Hot and cooling — offer the 20-min call or a coffee."
9. fallback → "Check in with a personal note."

`suggestHeat`: port alphahub's (`HEAT_BASE` by stage, +signals, −staleness) with base values per The 120 stages (member/deposit=5, call-held=4, dossier=3, account=3, interested=2).

---

## 8. Screen: GTM Sprint Dashboard (`/crm`) — the Friday-review machine

Purpose: replace the "weekly-metrics dashboard (even a spreadsheet)" from GTM W8 with the real thing. Everything computes from CRM truth; targets come from two seeded, in-place-editable tables so the plan can be re-forecast: `gtm_weekly_targets` (numeric cumulative targets per week, from sprint §1/§2) and `gtm_weeks` (one row per week W1–W8: phase, dates, primary push, actions[], asset, non-funnel targets[], checklist state).

Layout top → bottom:

0. **"This week" card + W1–W8 strip** — the sprint's §2 table, live. Top: a horizontal 8-segment week strip (`W1 ARM · W2 ARM · W3 SEED … W8 LAND`, mono labels; past weeks show a done/missed tick from their funnel Δ, current week `#0300ED` filled, future weeks bone) — clicking a segment retargets the whole dashboard to that week (same selector the funnel table uses). Below: the current week's card — mono kicker `PHASE 1 · ARM · W2 · JUL 20–26`, the **primary push as a Georgia headline** ("Recruit the ambassadors"), a **checkable actions list** (each week's concrete actions + "asset the week needs" as a distinct `ASSET` row; check state persists in `gtm_weeks`, checked-by + timestamp shown), and that week's **non-funnel targets** as small stat chips with manual counters where the DB can't count them (e.g. `AMBASSADORS 8/12`, `WARM CONVOS 19/25`; funnel-derived ones like "20 calls booked" compute automatically). The card ends with the sprint's constant weekly rhythm as a one-line mono footer (`MON PUSH+EMAIL · TUE–THU CALLS · FRI METRICS`). Empty/complete states: all actions checked → blush "WEEK CLEARED" pill.

1. **KPI strip** (4 stat cards, alphahub `kpi-strip` restyled: bone cards, mono kickers, Georgia numerals): **Interested families** (consented count, `/200`) · **Calls** (booked cum. / held cum., `/90` & `/72`) · **Deposits paid** (`/48` with Δ this week) · **Seats remaining** (live `seats_claimed()`, red dot indicator).
2. **Deposit thermometer** — horizontal bar to 48 (stretch marker at 55), `#D92632` fill on bone track; mono caption "48 BY SEP 1 · REFUNDABLE UNTIL SEP 30".
3. **Funnel vs. plan table** — rows = the §1 funnel stages (interested → account → dossier submitted → call booked → call held → deposit); columns = actual · this week's cumulative target · Δ; Δ cell green/amber/red (red = 30% under → **that stage is next week's push**, the sprint's own rule, stated in a mono footnote). Week context comes from the unit-0 week strip (defaults to current; window Jul 13–Sep 4).
4. **Today's Briefing** (alphahub unit, restyled): three lists — *Follow-ups due* (next-action families sorted by staleness), *Cooling off* (heat ≥3, no touch >7d), *Warming up* (signals toggled last 7d).
5. **Two-column footer:** **Source & ambassador tally** (leads + deposits by source; ambassador sub-table by `AMB-*` code — the "weekly tally in the Friday review" from GTM §3) · **Seats by group** (five groups × committed/assigned counts; shows "unassigned" bucket until S8's group picker ships; Scholars-cap warning per GTM Open Q2).
6. **This-week stats** strip: notes added, signals toggled, calls logged, sends, dossiers reviewed.

---

## 9. Screen: Library (`/crm/library`) + send composer

Port alphahub's `library_items` / `library_sends` + send-composer flow, with The 120 content and Resend as transport.

- **Item types:** `faq`, `talking`, `data`, `asset` (link to PDF/page: explainer one-pager, five group sheets, /parents, /tuition, Gauntlet).
- **Seed set:** ≥1 item per concern in §7, written from existing site copy (tuition math + HST-exempt line, refund terms, Tin Can screen-free story, TimeBack results from /parents, assessment explanation, time-commitment breakdown, spouse-buy-in talking points). Seeds ship in the migration like alphahub's 007.
- **Send composer** (drawer or from library): pick family → **hard consent gate** (non-consented = blocked, full stop) → prefilled subject/body from item (editable) → sends via Resend from `admissions@the120.school`, BCC `admissions@` for the paper trail → logs `library_sends` row (feeds co-pilot rule 5) + timeline event + `last_touch_at`. Manual "mark as sent elsewhere" option for texts/WhatsApp (logs without emailing).
- Helpfulness thumbs on items (feeds suggestion ranking).

---

## 10. What syncs automatically (implementation contract)

| Event | Source of truth | CRM effect |
|---|---|---|
| Parent signs up | `parents` insert | family row created/merged; stage → ACCOUNT; source/referral from attribution fields; timeline event |
| Child dossier created / % / submitted | `children` | stage → DOSSIER STARTED/SUBMITTED; timeline events |
| Deposit paid / refunded | Stripe webhook → `deposits` | stage → DEPOSIT PAID (or demote); thermometer, seat label, timeline |
| Welcome email sent | `welcome_sent_at` metadata | timeline event |
| Call booked / held | **manual stamp** (Cal.com webhook = future enhancement, note in brief) | stage → CALL BOOKED/HELD |
| Review status / group / member | `children.review_status` (dossier queue) | stage → MEMBER; group seat counts |
| Library send | `library_sends` | co-pilot input, timeline, last-touch |

Backfill migration creates families for all existing parents on day one.

---

## 11. Visual design spec (for Claude Design)

**North star: `/crm` looks like `Admin.dc.html` grew into a product.** It should feel like the staff wing of the120.school — same identity, quieter and denser than the marketing site. Nothing of alphahub's palette survives.

### Token mapping (alphahub → The 120)

| Role | alphahub | The 120 CRM |
|---|---|---|
| App background | paper `#FFFFFF`/`#FAFAF7` | `#ECEAE5` (admin bg); cards `#F7F6F3`; white for selected/elevated |
| Primary accent / co-pilot | alpha-blue `#0000FF` gradient | `#0300ED` flat (no gradients in the system) |
| Action / heat / alerts | coral `#FF7A59` | `#D92632` |
| Soft accent on dark | sky tints | blush `#EFC5B8` |
| Ink / muted / faint | ink scale | `#131416` / `#55585E` / `#9FA2A7` |
| Hairlines | `#E4E4EA` | `#DDDAD4`, `#D8D5CF` |
| Functional green/amber (last-touch, paid) | success/warning | keep functional: `#0E8A5F` / `#B85C00` (used sparingly; not brand colors) |
| Display font | Archivo | **Georgia 400** (page titles 28px, drawer names; italic accents) |
| Body/UI font | Inter | **Space Grotesk** (body 13.5–15.5px; 600 for names/emphasis) |
| Editorial italic | Instrument Serif | **Georgia italic** (co-pilot summary, project pitch, private notes) |
| Labels/kickers/pills/buttons | Inter caps | **IBM Plex Mono** 9.5–11px, letter-spacing 0.06–0.12em, uppercase, `·` separators |
| Radii | 4–40px scale | 10px buttons · 12px cards/inputs · 100px pills/chips (handoff scale) |
| Shadows | shadow-md/blue | selected-card glow `0 2px 10px rgba(3,0,237,0.10)`; nav `0 4px 18px rgba(19,20,22,0.14)` |

### Component rules

- **Stage pills** (mono, 9px, pill radius): INTERESTED/ACCOUNT `#E0DDD7`/`#55585E` · DOSSIER + CALL stages `#0300ED`/white · DEPOSIT PAID & MEMBER `#D92632`/white · LOST `#131416`/white at 60% · WAITLIST blush/ink. (Extends the Admin.dc.html pill logic.)
- **Filter chips:** active `#0300ED` filled white text, inactive bone with `#D8D5CF` border — exactly the prototype's `chip()`.
- **Heat pips:** five 8px squares (not dots — matches the square 120 logo chip), filled `#D92632`, empty `#E0DDD7`; ghost outline shows the auto-suggested value when overridden.
- **Co-pilot & pitch cards:** `#0300ED`, blush kicker, Georgia italic `#F7F6F3` body — the one "loud" element per screen.
- **Buttons:** primary red / secondary white with `#D8D5CF` border, mono uppercase labels, 10px radius (site CTA grammar).
- **Tables:** generous 13–16px row padding, hairline dividers only, no zebra; numbers in mono.
- **Empty states** (alphahub R30–R34, rewritten in brand voice): e.g. pipeline-empty = Georgia headline "The pipeline starts with one family." + red ADD FAMILY; co-pilot-insufficient = "New family — set concerns and signals to get a next move."
- Login: centered bone card on `#0300ED` full-bleed, logo lockup, mono `STAFF ONLY` pill.

### Screens for Claude Design to produce

1. `/crm/login` · 2. `/crm` dashboard (full, incl. the This-week card + W1–W8 strip in mid-sprint and "week cleared" states) · 3. `/crm/pipeline` table + filters · 4. kanban variant · 5. contact drawer open (co-pilot + timeline + aside) · 6. add-family modal · 7. `/crm/dossiers` two-pane with payment strip + group chips · 8. `/crm/library` grid + send composer (consent-blocked state too) · 9. key empty states · 10. mobile drawer sheet.

---

## 12. Non-functional requirements

- **CASL:** consent is stored, displayed, and enforced at the send layer. Manual leads are private notes until consented — never emailed (mirrors alphahub's "prospects are never notified" contract + GTM §3 rules).
- **PII:** minors' data (dossiers) — staff-only RLS, audit log on reads of dossier detail (`drill-down` action, as alphahub does), no CRM data in client bundles beyond the signed-in staff session, no third-party analytics on `/crm`.
- **Determinism:** co-pilot is pure rules (testable like alphahub's `copilot-engine.test.ts`). No LLM in v1.
- **Truthfulness:** seat counts and deposit numbers come from the same live sources as the public site — never a hand-entered number (roadmap "seat-count truth" decision).
- **Performance:** two users; optimize for one-screen glanceability and server components, not scale. Dashboard queries parallelized like alphahub's dashboard page.
- **Testing:** port alphahub's test posture — unit tests for stage derivation, `deriveNextMove`, `suggestHeat`, transition validation, consent gate; integration test for the Stripe-webhook → stage flow.

---

## 13. Suggested phasing (operator will slice tickets)

1. **P1 — See the truth:** staff auth + `/crm` shell, families backfill/sync, pipeline table + drawer (no co-pilot), dossier queue with payment visibility (S5), manual add. *Unblocks W2–W3 of the sprint.*
2. **P2 — Run the week:** GTM dashboard (KPIs, thermometer, funnel-vs-plan, source/ambassador tally), call stamps, Today's Briefing.
3. **P3 — Close the loop:** co-pilot, heat/concerns/signals, library + send composer, kanban, timeline system events, empty states, mobile pass.

## 14. Open questions (carried from GTM §7 — answers change the CRM)

1. Per-group seat caps (~24?) → drives the seats-by-group card and waitlist trigger.
2. Assessment ops (who reviews, SLA) → may need an "assessment scheduled" date on the dossier queue.
3. Cal.com webhook: worth wiring in P2 to kill the manual call stamps?
4. Waitlist mechanics (GTM §5.7) — v1 ships the `waitlist` override + a filtered view; is a public-facing waitlist form in scope later?
5. When does `ethan@the120.school` become a real mailbox? (Needed for his password resets and send-composer From identity.)

## 15. Source documents

- `120-The120/artifacts/gtm-8-week-sprint.md` — goals, funnel math, weekly targets, nurture rules
- `120-The120/artifacts/roadmap.md` — stack truth, S5/S8/S10, decisions log
- `120-The120/artifacts/The 120 Design Handoff/` — tokens, `Admin.dc.html`, `Design System.dc.html`, screenshots 16–18
- `alphahub/docs/brainstorms/pipeline-crm-requirements.md` + `docs/plans/2026-05-02-001-feat-pipeline-crm-plan.md` — the CRM pattern language being ported
- `alphahub/src/lib/pipeline/copilot-engine.ts`, `src/lib/constants/pipeline.ts`, `src/components/dashboard/*`, `supabase/migrations/001,003,007` — reference implementation
