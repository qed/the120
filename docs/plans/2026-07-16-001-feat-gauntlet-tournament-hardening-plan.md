---
title: "feat: Gauntlet Summer Tournament — data model + hardening to make turn-on real"
type: feat
status: active
date: 2026-07-16
origin: artifacts/gauntlet-public-front-door-stories.md
---

# feat: Gauntlet Summer Tournament — data model + hardening

## Overview

The v1 public front door for the Summer Tournament (nav, homepage section, `/gauntlet` parent banner, tournament state machine, rules page, entry modal + double-opt-in routes, standings cron, founding-leaderboard page) is already built and in **draft PR #9**. A 7-persona document review found that these are *surfaces*: flipping the config lights them up but does **not** yield a runnable tournament. Two P0 data-model gaps and several security/UX defects block a real turn-on.

This plan covers the work to make turn-on *real*: connect a tournament entry to a rankable score (D1), make prize-band winners computable (D2), fix the handle-hijack P0, add abuse controls to the public endpoint, and clear the P2 UX/security items. It does **not** re-do v1.

## ⚠️ Plan-Review Outcome (2026-07-16) — core approach D1/D2 refuted; plan re-scoped

A 5-persona plan-review gate (feasibility, adversarial, security, coherence, scope), verifying against the code, **refuted the D1/D2 shortcuts this plan was built on.** Recorded here so the plan is a truthful artifact, not implemented as originally written.

**Why D2 (prize-band board via a join on `gauntlet_saves`) does not work:**
- `gauntlet_saves.trial_best` is a **single band-agnostic scalar per user** (`Math.max(prev, score)` regardless of `save.band`), and the practice band is freely chosen and unrelated to `prize_band`. The join ranks everyone on one global score with no content scoping — so a **9–12 entrant can grind `g34` (single-digit) content and dominate the 9–12 money pool**; b78 and b912 both map to `g78`. Winners are "computable" but the split is unfair and trivially gameable, and the rules-page line "9–12 competes on our most advanced content" would be **false-in-fact**.
- The RPC also permits **one `user_id` across all three bands** (uniqueness is on `lower(handle)`, not `user_id`) → one kid can place in/win every pool.
- **Doing D2 correctly requires content-band-scoped, per-run tournament scores** — which is exactly Ethan's **B1** ("log trial results as event rows"), explicitly out of this plan's scope. D2-done-right converges with B1.

**Why D1 (account-to-rank) does not work as specified:**
- The "free account" the entry modal would route guests through is **not lightweight** — `AccountModal` collects parent name, email, password, phone, postal code, CASL consent and frames it as "claim your child's seat → dossier → assessment → call." That is the **full admissions funnel**, inserted *before* entry, contradicting the brief's "the ask travels through the kid, one email" thesis.
- `AccountModal` **cannot hand control back** (props are `{isOpen,onClose}`, no success callback), and under email-confirmation it returns **no session** — so the guest→account→entry linkage silently fails and stamps no `user_id`.
- A brand-new account has **no `gauntlet_saves` row yet** (written lazily, debounced, after a trial) → `trial_best=0` → excluded from the board. The entrant ranks nowhere.
- Account-to-rank **does not close the integrity hole** either: `gauntlet_saves` RLS restricts *which* row you write, not *what value* — a signed-in entrant can `PUT trial_best=999999`. "Makes turn-on real" was overstated; the board stays client-riggable without B1.

**Revised direction (what this plan should actually drive):**
1. **Independent P0/P1 code fixes — buildable now, correct regardless of the scoring design** (Units 3′, 4, 5, and the latent-bug fix): the handle-hijack fix (via `user_id`/`confirm_token` **only — not email**), the latent `upsert onConflict:"handle"` vs `lower(handle)` expression-index bug, abuse controls, confirm-prefetch hardening, PII lifecycle. These stand on their own.
2. **Real ranking (D1/D2) is a design problem to resolve *with* Ethan's B1**, not a shortcut to ship now. It needs (a) content-band-scoped, server-validated, per-run tournament scores (B1), and (b) a genuinely lightweight ranking identity (a handle/claim tied to a score row — *not* the admissions `AccountModal`). Until that exists, the v1 surfaces stay honestly dormant.
3. **Keep v1 (PR #9)** — the surfaces are sound; the review only refuted the ranking/scoring *mechanism*, which v1 never actually shipped (it's dormant).

The Implementation Units below are re-tagged **[NOW]** (independent, buildable) vs **[BLOCKED-ON-B1]** (needs the real scoring design). Do not implement the [BLOCKED] units on the refuted join.

## Problem Frame

The tournament's core promise (brief §2: "enter → appear on the leaderboard → weekly standings → conversion") cannot function as built:

- **Scores are account-bound; entries are not.** `gauntlet_saves` (the only source the leaderboard RPC reads) is keyed to `auth.users` with own-row RLS and written only for signed-in players by `app/gauntlet/game/cloudSave.ts`. Tournament entries land in a separate `gauntlet_tournament_entries` table with a parent email but no score and no join key. An email-only entrant can never appear on the board they entered to appear on.
- **Prize bands can't be computed.** Entries carry `prize_band` ∈ {b36, b78, b912}; scores carry game `band` ∈ {g34, g56, g78}, with no 9–12 bucket. Per-band winners and the $50/$25/$10 payouts are uncomputable, and `FoundingBoard` can only group by game band.

See origin: `artifacts/gauntlet-public-front-door-stories.md` (open decisions D1/D2/D3 and the review-hardened Turn-On Checklist).

## Requirements Trace

- **R1 (D1).** A confirmed tournament entrant can appear on a tournament leaderboard with a real score. (brief §2 funnel; origin D1)
- **R2 (D2).** Winners are determinable per prize band (3–6 / 7–8 / 9–12), and the founding board shows the three pools. (origin D2, A; gauntlet-roadmap Decisions #1)
- **R3.** A family's confirmed entry cannot be overwritten/hijacked by another family choosing the same handle. (review P0; origin GPF-5)
- **R4.** The public enter endpoint cannot be used to email-bomb a parent or flood Resend, and `referral_code` cannot forge ambassador tallies. (review P1; origin GPF-5/GPF-7)
- **R5.** Double-opt-in confirmation reflects genuine parental action (not email-scanner prefetch) and is constant-time. (review P2; origin GPF-5)
- **R6.** The entry modal is usable on mobile with the keyboard open and accessible to screen-reader/keyboard users. (review P2; origin GPF-5)
- **R7.** CASL/PIPEDA posture is complete: dedicated unsubscribe secret, stated retention/deletion, name-filter owner. (review P2; origin GPF-6/Guardrails)
- **R8.** The standings email carries a real rank once R1/R2 land, or is honestly reframed until then. (review P2; origin GPF-10)

## Scope Boundaries

- **Not** re-implementing v1 surfaces (shipped in PR #9) — only the data model + hardening.
- **Not** B1 score plausibility caps or B2 handle word/profanity filter — those remain Ethan's game-integrity tickets. This plan *depends on* them for public launch and names them, but does not build them. (The handle *uniqueness/ownership* fix in Unit 3 is a PII-hijack fix on the capture path, distinct from B2's anti-cheat filter.)
- **Not** building a new 9–12 content band — season 1 maps 9–12 to the top existing content (flagged decision D2).
- **Not** the Aug-24 post-close nurture handoff (GPF-12) — remains an ops step.

## Context & Research

### Relevant Code and Patterns

- **Score source:** `supabase/migrations/20260712150000_gauntlet_saves.sql` — `gauntlet_saves` (PK `user_id → auth.users`, own-row RLS) + `gauntlet_leaderboard(band_in)` SECURITY DEFINER RPC returning top-20 by game band. This is the pattern the new prize-band RPC mirrors.
- **Entry table:** `supabase/migrations/20260716120000_gauntlet_tournament_entries.sql` — already has a nullable `user_id → auth.users` column (currently unused) that becomes the join key.
- **Cloud save / handle / band:** `app/gauntlet/game/cloudSave.ts`, `app/gauntlet/GauntletGame.tsx` (handle editor, band on `save.band`, `cloudUser()`).
- **Account creation:** `app/components/account/AccountModal.tsx` + `JoinButton.tsx` (the existing free-account flow the guest banner already uses).
- **Entry flow:** `app/gauntlet/components/TournamentEntryModal.tsx`, `app/gauntlet/game/tournamentEntry.ts` (validators), `app/api/gauntlet/tournament/{enter,confirm,unsubscribe}/route.ts`.
- **Email/cron/token patterns:** `app/lib/email.ts` (Resend), `app/api/cron/nurture/route.ts` (CRON_SECRET bearer + claim-first idempotency), `app/lib/nurture/token.ts` (HMAC unsub token — the util to parameterize/share).
- **Ambassador registry:** `ambassador_codes` table (migration `20260715120000_ambassador_registry.sql`) + `/crm/ambassadors` tally — the source `referral_code` must validate against.
- **Migrations are applied via the Supabase Management API** (stored DB password is stale) — playbook cited below.

### Institutional Learnings

- **Migrations via Management API** — `docs/solutions/integration-issues/supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md`: apply all new SQL/DDL via `POST /v1/projects/{ref}/database/query` with the CLI token (`Supabase CLI:supabase`); after each file, insert its version into `supabase_migrations.schema_migrations`; send the body as UTF-8 bytes (PS 5.1 mangles em-dashes). `supabase db push` will fail auth.
- **Forged-consent hijack (directly on-point for Unit 3 + Unit 5)** — `docs/solutions/security-issues/supabase-autoconfirm-forged-consent-email-confirmation-signup-retrofit-2026-07-13.md`: an email-matched trigger let an attacker hijack another lead's family, overwrite contact identity, and OR-merge `consent_given=true` — *the same shared-key-overwrite class as the handle-hijack P0*. Lesson: **consent is only trustworthy when the email is proven** (reinforces the double-opt-in + confirm hardening), and **deploy-before-flip**. Reuse its SQL-based E2E recipe (`update auth.users set email_confirmed_at = now()`, Resend black-hole `delivered+x@resend.dev`).
- **CHECK-constraint drift + staff-table RLS (Unit 2)** — `docs/solutions/best-practices/crm-audit-action-allowlist-db-check-constraint-drifts-from-ts-enum-2026-07-15.md`: keep any DB CHECK (the entry table's `prize_band in (...)`) in lockstep with app enums; staff/service-role tables = **RLS enabled with zero policies** (the pattern the entry table already uses); tolerant pre-migration reads (`res.error ? [] : res.data`) but truth tables still throw.
- **Claim-then-send + never-throw email (Unit 4/7)** — `docs/solutions/best-practices/atomic-claim-then-send-db-guarded-stamp-column-dedupes-best-effort-email-2026-07-14.md` and `…resend-safe-atomic-claim-then-send-cas-guarded-claim-and-unclaim-2026-07-15.md`: claim atomically then send (never send-then-stamp); `sendEmail` stays never-throw with an 8s timeout; keep stamp columns opaque strings (don't re-parse through `Date`); CAS-guard resends (the "resend to a different email" affordance in Unit 8).
- **Escape every email interpolation (add to Unit 4/9)** — `docs/solutions/security-issues/admissions-notification-email-html-injection-via-unescaped-child-parent-names-2026-07-14.md`: reuse the tested `escapeHtml` from `app/crm/lib/library-rules.ts` in every hand-built template. The gauntlet handle is sanitized to `[A-Z0-9-]` (safe today), but `standingsEmail`/`entryEmail` should escape any user-controlled interpolation as defense-in-depth.
- **Split-phase migrations** — `docs/solutions/workflow-issues/split-phase-migrations-pre-deploy-schema-post-deploy-purge-separate-files-rerun-2026-07-14.md`: one migration file per rollout phase; state the phase imperatively in the header (the only enforcement, since migrations apply manually).
- **Vercel env delete-and-recreate** — `docs/solutions/integration-issues/stripe-live-mode-cutover-vercel-env-var-silently-stale-2026-07-15.md` + memory `powershell-bom-pipe-pitfall`: set `UNSUBSCRIBE_SECRET` / `STANDINGS_ENABLED` in the Vercel UI (or REST/`--value`), never a PS pipe; if an in-place edit doesn't land, delete-and-recreate with explicit per-environment scopes.
- **Prior-art gaps (design fresh):** no institutional pattern exists for (a) Vercel cron / `CRON_SECRET` — but the shipped `app/api/cron/nurture/route.ts` is the in-repo precedent to mirror; and (b) **rate-limiting / bot protection on public endpoints** — Unit 4 is genuinely net-new; document it as a new solution afterward.

### External References

External research skipped — local patterns are strong for every layer (Resend, RLS + SECURITY DEFINER RPC, Management-API migrations, CRON_SECRET cron, HMAC tokens, CASL consent). The one thin area is **rate-limiting** (no existing limiter in the repo): use Vercel platform primitives — **Vercel BotID** (bot detection, GA) and/or **Vercel Firewall** rate rules — as the first line, with an app-level per-email/day cap as defense-in-depth. (Per session Vercel knowledge context, 2026-02.)

## Key Technical Decisions

- **D1 — Ranking requires a free account (account-to-rank).** To appear on a tournament board a player must have a `gauntlet_saves` row (created on free-account sign-in), and the entry links to it via `gauntlet_tournament_entries.user_id`. The entry modal drives account creation when the player is a guest. *Rationale:* the brief (§4.1: "no sign-in to play, but sign in to save progress") and GTM-2 already establish this; it reuses proven infra and keeps guest *play* frictionless (E4) while making *ranking* real. See Alternatives.
- **D2 — Prize band lives on the entry; the tournament board is a join, not a schema change.** A new SECURITY DEFINER RPC joins `gauntlet_saves` (score, by `user_id`) to `gauntlet_tournament_entries` (`prize_band`, `confirmed_at is not null`) and groups by `prize_band`. `gauntlet_saves` is untouched. *Rationale:* prize band is a tournament concept, not a game concept; the join key (`user_id`) exists after D1; avoids polluting the game's schema.
- **9–12 (D2 sub-decision).** Ships in season 1, mapped to the top existing content (g78) — flagged as a known content gap, surfaced on the rules page ("9–12 competes on our most advanced content this season"). Cutting 9–12 is the fallback if that's unacceptable.
- **D3 — Homepage rendering.** Mark `app/page.tsx` `force-dynamic` so a `TOURNAMENT_KILL` takes effect on the homepage section on the next request, not after ~60s ISR. Accept the small perf cost on the marketing page for an instant kill. *(Reversible; low-risk.)*
- **Abuse controls (R4).** Vercel BotID/Firewall on `/api/gauntlet/tournament/enter` + an app-level per-parent-email daily cap (count confirmed/pending entries for that email in a window). Validate `referral_code` against `ambassador_codes` before storing (unknown → store null/unverified).
- **Confirm hardening (R5).** The confirm link lands on a page with a **POST** confirm button (GET no longer stamps), defeating email-scanner prefetch; token compare uses `timingSafeEqual`.

## Open Questions

### Resolved During Planning

- *How does a guest entrant get a score?* → D1: free account required to rank; modal drives sign-in.
- *How are prize-band winners computed?* → D2: join RPC on `user_id`, group by `prize_band`.
- *Does 9–12 ship without content?* → Yes for season 1, mapped to top content, disclosed on rules page. (Confirm at plan-review.)
- *Where does rate-limiting live?* → Vercel BotID/Firewall + app-level per-email cap.

### Deferred to Implementation

- Exact RPC SQL (column list, tie-breakers) — settle against real schema during `ce:work`.
- Whether the per-email cap needs its own counter table or can derive from `created_at` counts on the entries table — decide when writing the query.
- Final BotID vs Firewall choice — depends on what's enabled on the Vercel project; confirm at implementation.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

Entry ↔ score linkage and the prize-band board (D1 + D2):

```
Guest plays (localStorage)  ──▶  "Enter the Tournament"
                                     │
                        signed in? ──�no──▶ AccountModal (free account)  ──▶ gauntlet_saves row (score home)
                                     │yes                                          │
                                     ▼                                             ▼
        gauntlet_tournament_entries { user_id ⟵ auth.uid, prize_band, parent_email, confirm_token }
                                     │  double opt-in (POST confirm) → confirmed_at
                                     ▼
   RPC gauntlet_tournament_leaderboard(prize_band):
     SELECT s.handle, e.prize_band, s.trial_best
     FROM gauntlet_tournament_entries e
     JOIN gauntlet_saves s ON s.user_id = e.user_id
     WHERE e.confirmed_at IS NOT NULL AND e.consent_given
       AND (prize_band IS NULL OR e.prize_band = prize_band)
     ORDER BY s.trial_best DESC   -- top N per band
```

Prize-band → content-band mapping for season 1 (decision matrix):

| prize_band | competes in pool | served game content | note |
|---|---|---|---|
| b36 (3–6) | 3–6 | g34 / g56 | mixed-difficulty within pool (accepted S1) |
| b78 (7–8) | 7–8 | g78 | clean |
| b912 (9–12) | 9–12 | g78 (top content) | **content gap — disclosed on rules page** |

## Implementation Units

**Phase tags (per the Plan-Review Outcome):**
- **[NOW]** — independent, correct regardless of the scoring redesign: **Unit 3′** (handle-hijack, `user_id`/token only), the **latent upsert-vs-expression-index fix** (fold into Unit 3′), **Unit 4** (abuse controls), **Unit 5** (confirm hardening), **Unit 9** (PII lifecycle + token dedup), **Unit 10** (D3 homepage `force-dynamic`). Plus the scope split: Unit 8's **mobile-scroll fix is [NOW]**; its a11y/resend polish is [NICE].
- **[BLOCKED-ON-B1]** — do NOT build on the refuted join; resolve with Ethan's B1 first: **Unit 1** (D1 identity), **Unit 2** (D2 scoring/RPC), **Unit 6** (prize-band board), **Unit 7** (standings rank), plus Unit 8's a11y/resend polish [NICE].

> Server-derive invariant (security P1): the enter route must read `user_id` **only** from the verified session bearer (like `app/api/welcome/route.ts`), **never** from the request body. Applies to Units 1 and 3′.

- [ ] **Unit 1: [BLOCKED-ON-B1] Tournament ranking identity + linkage (D1 — redesign with B1)**

**Goal:** A confirmed entry is tied to a `gauntlet_saves` row via `user_id`, so an entrant has a rankable score.

**Requirements:** R1

**Dependencies:** None (entry table already has `user_id`).

**Files:**
- Modify: `app/gauntlet/components/TournamentEntryModal.tsx` (drive account creation when guest; pass the signed-in `user_id`)
- Modify: `app/gauntlet/game/tournamentEntry.ts` (submit includes `user_id` when signed in)
- Modify: `app/api/gauntlet/tournament/enter/route.ts` (stamp `user_id` from the caller's session when present; require it for ranking-eligibility)
- Modify: `app/gauntlet/GauntletGame.tsx` (entry CTA path: if guest, open `AccountModal` first, then the entry modal)
- Test: `app/gauntlet/game/__tests__/tournamentEntry.test.ts`

**Approach:**
- Guest clicks "Enter the Tournament" → if `cloudUser()` is null, route through `AccountModal` (existing free-account flow) → on success, continue to the entry modal with the new session.
- The enter route reads the caller's Supabase session (anon client with the bearer, like `app/api/welcome/route.ts`) and stamps `user_id`. Entries without a `user_id` are accepted as leads but flagged non-ranking (they won't join the board).
- Keep guest *play* untouched; only *ranking* requires the account.

**Patterns to follow:** `app/api/welcome/route.ts` (bearer→session), `app/components/account/AccountModal.tsx`, the guest-banner CTA in `GauntletGame.tsx`.

**Test scenarios:**
- Happy path: signed-in submit stores an entry with `user_id` = session user.
- Edge case: guest submit path opens account creation, then completes the entry with the new `user_id`.
- Edge case: entry with no `user_id` is stored but marked non-ranking (won't appear via the RPC).
- Error path: expired/invalid session bearer → entry still stored as a lead, no `user_id`, no crash.

**Verification:** A confirmed, signed-in entry's `user_id` matches a `gauntlet_saves` row; a guest is guided to an account before ranking.

- [ ] **Unit 2: Prize-band leaderboard RPC (D2)**

**Goal:** A prize-band-aware leaderboard join so winners per 3–6 / 7–8 / 9–12 are computable.

**Requirements:** R2

**Dependencies:** Unit 1 (needs `user_id` on entries).

**Files:**
- Create: `supabase/migrations/20260716140000_gauntlet_tournament_leaderboard.sql` (SECURITY DEFINER RPC + grant to anon/authenticated)
- Test: `supabase/migrations/__tests__` or an integration note (RPC tested via the board component in Unit 6)

**Approach:**
- RPC `gauntlet_tournament_leaderboard(prize_band_in text default null)` joins `gauntlet_tournament_entries` (confirmed + consented) to `gauntlet_saves` on `user_id`, returns `handle, prize_band, trial_best`, ordered `trial_best desc, updated_at asc`, top-N per band. Handles-only projection (never emails/names), mirroring the existing `gauntlet_leaderboard` SECURITY DEFINER pattern.
- Migration applied via the Management API playbook (dormant until applied; board degrades to empty).

**Patterns to follow:** `supabase/migrations/20260712150000_gauntlet_saves.sql` (`gauntlet_leaderboard` RPC shape, grants, `security definer set search_path = public`).

**Test scenarios:**
- Happy path: two confirmed entrants in b78 with different `trial_best` rank correctly.
- Edge case: unconfirmed or unconsented entry is excluded.
- Edge case: entry with `user_id` but no `gauntlet_saves` row (never played) is excluded.
- Edge case: `prize_band_in = null` returns all bands; a specific band filters.

**Verification:** Querying the RPC returns confirmed entrants grouped by prize band with real scores; emails/names never appear.

- [ ] **Unit 3′: [NOW] Fix handle-hijack + latent upsert-conflict bug (P0)**

**Goal:** A second family cannot overwrite another family's confirmed entry by reusing its handle, and the write path actually works.

**Requirements:** R3

**Dependencies:** None (land independently; before turn-on).

**Files:**
- Modify: `app/api/gauntlet/tournament/enter/route.ts` (replace blind `upsert onConflict:"handle"` with an explicit select-then-insert-or-owner-update)
- Test: `app/api/gauntlet/tournament/__tests__/enter.test.ts`

**Approach:**
- **Latent bug (review, verify first):** the table's uniqueness is a functional index on `lower(handle)`, not a constraint on bare `handle` — PostgREST `onConflict:"handle"` may fail to infer the target and error (503). Replace the upsert with an explicit `select … where lower(handle)=lower($1)` then branch, or add a proper unique constraint the conflict target can name.
- **Ownership proof (security P0 correction):** on conflict, only update if the caller proves ownership via a **session `user_id` match OR the original `confirm_token`**. **Do NOT accept `parent_email` as proof** — email is guessable, so an email-match branch reintroduces the hijack (a griefer who knows the family's email resets their confirmation). Otherwise reject with a field-level "that handle's taken."
- Owner-update must **not** reset `confirmed_at`/`consent` when only attribution fields change (specify field-level merge, not a blanket reset).

**Patterns to follow:** field-level error surfacing in `tournamentEntry.ts` validators; the forged-consent hijack precedent (`docs/solutions/security-issues/supabase-autoconfirm-forged-consent-…`) — same shared-key-overwrite class, resolved by proving ownership before mutating.

**Test scenarios:**
- Happy path: same `user_id`/email re-entry updates the existing row.
- Error path (the P0): different family, same handle → rejected, original row's `parent_email`/`consent`/`confirmed_at` unchanged.
- Edge case: handle free → normal insert.

**Verification:** A hijack attempt leaves the original entry intact and returns a taken-handle error.

- [ ] **Unit 4: Abuse controls + referral validation (R4)**

**Goal:** The public, email-sending endpoint resists email-bombing/flooding, and `referral_code` can't forge ambassador tallies.

**Requirements:** R4

**Dependencies:** None.

**Files:**
- Modify: `app/api/gauntlet/tournament/enter/route.ts` (per-parent-email daily cap; validate `referral_code`)
- Config: Vercel BotID/Firewall rule on the route (ops step, noted in Turn-On Checklist)
- Test: `app/api/gauntlet/tournament/__tests__/enter.test.ts`

**Approach:**
- App-level: cap confirmations/sends per `parent_email` per rolling window (derive from `created_at` counts, or a small counter — decide at implementation). Over cap → 429, no email.
- Validate `referral_code` against `ambassador_codes`; unknown → store null (or `unverified`), never credit. Confirm whether the CRM tally already validates independently; if so, this is defense-in-depth.
- Platform: enable Vercel BotID or a Firewall rate rule on the route.

**Patterns to follow:** `ambassador_codes` lookups in `/crm/ambassadors`; the `sendEmail` best-effort contract.

**Test scenarios:**
- Happy path: first entry for an email sends; a known referral code persists.
- Error path: N+1th entry for the same email in the window → 429, no send.
- Edge case: unknown referral code stored as null/unverified, entry still succeeds.

**Verification:** Scripted repeat submissions for one email are throttled; a bogus `AMB-` code is not credited.

- [ ] **Unit 5: Confirm-link hardening (R5)**

**Goal:** Confirmation reflects genuine parental action and is constant-time.

**Requirements:** R5

**Dependencies:** None.

**Files:**
- Modify: `app/api/gauntlet/tournament/confirm/route.ts` (GET renders a confirm *button*; POST performs the stamp; `timingSafeEqual`)
- Test: `app/api/gauntlet/tournament/__tests__/confirm.test.ts`

**Approach:**
- GET renders the branded landing page with a POST form ("Confirm my child's entry") — no side effect on GET, so Safe Links/Proofpoint prefetch can't false-confirm. POST verifies token (constant-time) and stamps `confirmed_at`. Keep idempotent success / expired / already-confirmed states.

**Patterns to follow:** the "/unsubscribe GET confirm page → POST revoke" pattern (nurture); `timingSafeEqual` in `app/lib/gauntlet/token.ts`; the forged-consent doc's "prove the email before trusting consent" + its SQL-based E2E recipe (`update auth.users … email_confirmed_at`, Resend black-hole address).

**Test scenarios:**
- Happy path: POST with a valid token stamps `confirmed_at`, shows success.
- Edge case: GET does not stamp (prefetch-safe); shows the confirm button.
- Edge case: already-confirmed → idempotent reassuring copy.
- Error path: bad/expired token → neutral "link expired," no enumeration; constant-time compare.

**Verification:** A simulated GET prefetch leaves `confirmed_at` null; the button POST confirms.

- [ ] **Unit 6: Founding board uses the prize-band RPC (D2 surface)**

**Goal:** The founding leaderboard shows the three prize pools (incl. 9–12), not game bands.

**Requirements:** R2

**Dependencies:** Unit 2.

**Files:**
- Modify: `app/gauntlet/components/FoundingBoard.tsx` (call the new RPC; band chips = prize bands)
- Modify: `app/gauntlet/game/cloudSave.ts` (add a `fetchTournamentLeaderboard(prizeBand)` helper alongside `fetchLeaderboard`)
- Test: `app/gauntlet/components/__tests__/FoundingBoard.test.tsx` (or a helper unit test)

**Approach:**
- Swap the board's data source to the prize-band RPC; chips become b36/b78/b912 with the labels from `tournament.ts`. Keep the empty/loading states (helper returns `[]` on error → intentional empty state).

**Patterns to follow:** existing `fetchLeaderboard` + `FoundingBoard` structure.

**Test scenarios:**
- Happy path: three band chips render; selecting b912 filters to that pool.
- Edge case: empty pool → intentional empty state, not a spinner.

**Verification:** The board groups by prize band and shows a 9–12 pool.

- [ ] **Unit 7: Standings email carries a real rank (R8)**

**Goal:** The weekly standings email includes the entrant's actual band standing (or stays an honest nudge until D1/D2 land).

**Requirements:** R8

**Dependencies:** Units 1, 2.

**Files:**
- Modify: `app/api/cron/gauntlet-standings/route.ts` (read the entrant's rank via the RPC/join)
- Modify: `app/lib/gauntlet/standingsEmail.ts` (include the rank line)
- Test: `app/lib/gauntlet/__tests__/standingsEmail.test.ts`

**Approach:**
- Join each confirmed entry to its score/rank within its prize band; render "You're #k in Grades 7–8." Until Units 1–2 are deployed, the existing generic-nudge copy stands (the cron already no-ops when not enabled).

**Patterns to follow:** `app/api/cron/nurture/route.ts` idempotency + CASL footer.

**Test scenarios:**
- Happy path: entrant with a score renders a rank line.
- Edge case: entrant with no score row → nudge copy, no rank, no crash.
- Integration: unsubscribed entry (consent_given false) is skipped.

**Verification:** A confirmed entrant with a score receives an email naming their band rank.

- [ ] **Unit 8: Entry modal UX + a11y polish (R6)**

**Goal:** The modal is usable on mobile with the keyboard open and accessible; duplicate/pending states are clear.

**Requirements:** R6

**Dependencies:** Unit 3 (duplicate-handle messaging pairs with the ownership rule).

**Files:**
- Modify: `app/gauntlet/components/TournamentEntryModal.tsx` (internal scroll `max-h`/`overflow-y-auto`; band selector `role=radiogroup` + arrow-key nav + `aria-checked`; field-level errors via `aria-describedby`; taken-handle + already-pending messaging; "resend to a different email" affordance in the done state)
- Test: `app/gauntlet/components/__tests__/TournamentEntryModal.test.tsx`

**Approach:**
- Card scrolls internally so the submit button stays reachable with the on-screen keyboard. Band buttons become an accessible radiogroup. Distinguish duplicate-handle (field error) from network error (banner). Done-state offers a resend for a mistyped email.

**Patterns to follow:** existing modal idiom (`LeaderboardPanel` in `GauntletGame.tsx`); form patterns in `AccountModal.tsx`.

**Test scenarios:**
- Happy path: valid submit shows the done state with a resend affordance.
- Edge case: taken handle → field-level error on the handle input (not a generic banner).
- Edge case: missing consent → inline, field-associated message.
- Accessibility: band selector exposes group semantics + selected state; keyboard arrows move selection.

**Verification:** On a narrow viewport with the keyboard open the submit button is reachable; a screen reader announces the band group and selection.

- [ ] **Unit 9: CASL/PIPEDA completeness + token dedup (R7)**

**Goal:** Close the remaining compliance/hygiene gaps.

**Requirements:** R7

**Dependencies:** None.

**Files:**
- Modify: `app/lib/nurture/token.ts` → parameterize into a shared HMAC util; `app/lib/gauntlet/token.ts` imports it (remove the duplicate)
- Modify: `app/lib/gauntlet/entryEmail.ts`, `app/lib/gauntlet/standingsEmail.ts` (escape user-controlled interpolation via the shared `escapeHtml`)
- Modify: `app/gauntlet/rules/page.tsx` (retention/deletion line in the PIPEDA note)
- Modify: `artifacts/roadmap.md` Turn-On Checklist (already includes `UNSUBSCRIBE_SECRET`, name-filter owner) — verify
- Test: `app/lib/gauntlet/__tests__/token.test.ts`

**Approach:**
- One HMAC util parameterized by purpose string; both nurture and gauntlet tokens use it. Reuse the tested `escapeHtml` (`app/crm/lib/library-rules.ts`) for the `handle` interpolation in the gauntlet email templates — defense-in-depth even though the handle is already `[A-Z0-9-]`-sanitized. Add a plain-language retention/deletion line to the rules page. `UNSUBSCRIBE_SECRET` provisioning and the name/profanity filter owner are already in the Turn-On Checklist.

**Patterns to follow:** `docs/solutions/security-issues/admissions-notification-email-html-injection-…` (escape every hand-built-template interpolation); `app/lib/nurture/token.ts` current HMAC.

**Patterns to follow:** `app/lib/nurture/token.ts` current HMAC.

**Test scenarios:**
- Happy path: shared util produces distinct tokens per purpose; verify round-trips.
- Edge case: wrong purpose/token fails verification (constant-time).

**Verification:** One HMAC implementation; rules page states retention/deletion.

## System-Wide Impact

- **Interaction graph:** Unit 1 wires the entry CTA to `AccountModal` (new dependency between the game and the account flow). Unit 7 makes the standings cron read scores (new join).
- **Error propagation:** enter route stays best-effort on email (existing contract); new caps return 429; ranking-ineligible entries (no `user_id`) are stored as leads, never error.
- **State lifecycle risks:** re-entry ownership (Unit 3) must not strand a half-confirmed row; the per-email cap must not lock out a legitimate parent with two kids (cap per email, not per handle — tune the window).
- **API surface parity:** the new RPC mirrors `gauntlet_leaderboard`'s handles-only, SECURITY DEFINER, anon-grant shape — no new data exposure.
- **Integration coverage:** entry `user_id` ↔ `gauntlet_saves` join is the crux; cover it with a real RPC test, not mocks.
- **Unchanged invariants:** `gauntlet_saves` schema and RLS are untouched; guest *play* stays account-free (E4); the v1 surfaces' copy/state machine are unchanged.

## Risks & Dependencies

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Requiring an account to rank adds friction that suppresses entries | Med | Med | Guest *play* stays free; account is only at the "make it count" moment where motivation is highest (brief §2). Measure entry→confirm drop-off. |
| 9–12 competing on 7–8 content reads as unserious to high-schoolers | Med | Med | Disclose on rules page; treat as season-1 known gap; fallback is cutting 9–12. Confirm at plan-review. |
| B1/B2 integrity slips past Aug 3 while the date auto-flips the board Live | Med | High | Turn-On Checklist gates the flip on an explicit integrity sign-off; `TOURNAMENT_KILL` (with D3 `force-dynamic`) as the catch. |
| Per-email cap locks out a legit multi-kid parent | Low | Med | Cap sized for realistic family use (e.g., a few/day); cap per email not per handle. |
| Migration not applied before standings enabled → cron 500s | Low | Low | Turn-On Checklist orders migration before `STANDINGS_ENABLED`. |

## Documentation / Operational Notes

- Update `artifacts/roadmap.md` GPF section as units land (GPF-5/10/11 move toward ✅; note D1/D2 resolved).
- All migrations applied via the Management API playbook; record in `schema_migrations`.
- New env: `UNSUBSCRIBE_SECRET` (Vercel Production, distinct from service-role key), `STANDINGS_ENABLED` when ready.
- Enable Vercel BotID/Firewall on the enter route as an ops step.

## Alternative Approaches Considered

- **D1 alt — guest-scored entries table (entries store a client-posted `trial_best`).** Rejected: re-creates the B1 client-reported-score integrity hole on an *unauthenticated* service-role table (worse abuse surface than the signed-in path), and duplicates `gauntlet_saves`. Account-to-rank reuses the RLS-protected score home.
- **D2 alt — add `prize_band` to `gauntlet_saves`.** Rejected: pollutes the game's schema with a tournament concept and forces every player (not just entrants) to carry a prize band; the join-on-`user_id` RPC keeps concerns separate.
- **D3 alt — leave homepage ISR-60.** Acceptable for the date flip, but a broken-tournament kill would lag ~60s on the highest-traffic page; `force-dynamic` is a cheap fix for an instant kill.

## Sources & References

- **Origin document:** [artifacts/gauntlet-public-front-door-stories.md](../../artifacts/gauntlet-public-front-door-stories.md) (review-hardened; D1/D2/D3, Turn-On Checklist)
- **Brief:** artifacts/public-gauntlet-marketing.md · **Roadmap:** artifacts/roadmap.md (GPF section), artifacts/gauntlet-roadmap.md (B/D phases, Decisions)
- **Draft PR:** #9 (v1 surfaces)
- Related code: `supabase/migrations/20260712150000_gauntlet_saves.sql`, `app/gauntlet/game/cloudSave.ts`, `app/api/gauntlet/tournament/*`, `app/api/cron/nurture/route.ts`, `app/lib/nurture/token.ts`
- Migration playbook: `docs/solutions/integration-issues/supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md`
