# The Gauntlet — Public Front Door: Story Decomposition

**Version 1.0 — July 16, 2026** · Companion to `artifacts/public-gauntlet-marketing.md` (the brief)
**Purpose:** Turn the brief's 13-item build list into discrete, buildable stories with acceptance criteria, wired so the *entire* tournament ships now in a **dormant** state and is **turned on with a config flip** when the Summer Tournament opens (Aug 3, 2026).

Tracked as the **GPF** (Gauntlet Public Front-door) series in `artifacts/roadmap.md`. Story IDs below map 1:1 to the brief's numbered items and to the roadmap tickets.

---

## The keystone: one tournament state machine

Everything hangs off a single server-safe config module, `app/lib/tournament.ts`. Every surface (homepage section, `/gauntlet` banner, entry CTA, rules page, standings email, founding leaderboard) reads its phase and copy from here — so "turning on the tournament" is **one switch**, never a copy-hunt across files.

**Phase resolution (in priority order):**
1. `TOURNAMENT_KILL=1` (server env) → phase `off`: every tournament surface hides, `/gauntlet` falls back to plain "Play free". This is the B4 kill switch — disable a broken tournament with **no redeploy** (runtime server env).
2. `TOURNAMENT_STATE=tease|live|after` (server env) → manual override for testing / emergencies.
3. **Date-derived default** (no env needed): `tease` before Aug 3 → `live` Aug 3–23 → `after` Aug 24+. Because this is evaluated server-side per request, the tournament **auto-flips to Live on Aug 3 and to After on Aug 24 with zero action.** The env vars exist only to override or kill.

**Why server env (not `NEXT_PUBLIC_`):** `NEXT_PUBLIC_*` is inlined at build time and needs a redeploy to change. Plain server env is read at request time. `app/gauntlet/page.tsx` is already a server component, so it resolves the phase and passes it as a prop into the client game tree — the whole surface gets request-time state without a rebuild.

**Assumptions flagged for Peter/Ethan before turn-on (see Guardrails):**
- **A. Prize bands = 3–6 / 7–8 / 9–12** (brief §9 confirmed). Stored on the tournament entry as `prize_band`, independent of the game's `g34/g56/g78` practice bands. Consequence: a 9–12 entrant plays 7–8 content but competes in the 9–12 pool. Acceptable for the scaffold; Ethan may add a true 9–12 content band later.
- **B. Tournament entry is parent-email lead capture, not a forced account.** Per E4 + brief §1: no sign-in to play. The entry modal captures handle + prize band + parent email + CASL consent into a new `gauntlet_tournament_entries` table via a service-role API route (guests have no JWT). Double opt-in confirms the email. This is *additive* to the existing signed-in `gauntlet_saves` leaderboard.
- **C. Migrations are NOT auto-applied.** Like `gauntlet_saves` / `cloudSave.ts`, all new tournament code **degrades gracefully when its table is absent** (guest/dormant). The migration is applied via the Management API playbook as a documented turn-on step — the tables stay empty and untouched until Aug 3 anyway.

---

## v1 — The Front Door (ship now, safe in Tease state)

### GPF-1 · Nav entry (brief item 1)
Add `The Gauntlet → /gauntlet` as a permanent nav pillar.
- **Build:** append `{ label: "The Gauntlet", href: "/gauntlet" }` to `nav` in `app/lib/site.ts` (order: The Gauntlet · Tuition · FAQ). The wordmark already covers "The 120"; CTAs cover Log in / Join.
- **Accept:** link visible in desktop + mobile nav on every page; routes to `/gauntlet`; noun label (not "Play the Gauntlet").

### GPF-2 · Homepage Gauntlet section + states (brief items 2 + 3)
New section after the membership/how-it-works beat, **before** `ParentStoriesBand` (testimonials). Hero unchanged — Membership still leads.
- **Build:** `app/components/GauntletBand.tsx`, inserted in `app/page.tsx`. Kicker "THE GAUNTLET — FREE FOR EVERYONE", headline "Fast math, disguised as a boss battle.", body per brief §4.2, state-dependent tournament line + CTA from `tournament.ts`, boss-art + My-Facts-heatmap visual slot.
- **State copy** (from `tournament.ts`, brief §4.3):
  - Tease: "The Summer Tournament opens **Aug 3**. Play now — be ready." [Play free]
  - Live: "The Summer Tournament is **live until Aug 23**." [Enter the Tournament]
  - After: "The first Summer Tournament is in the books." [See the Founding Leaderboard][Play free]
- **Accept:** in Tease (today) the section shows the tease line + [Play free]/[Tournament rules]; flipping phase changes only this section's line/CTA; no hero change.

### GPF-3 · /gauntlet parent banner (brief item 4)
One dismissible, parent-voiced strip above the game — the reverse funnel for kids who arrive from share links.
- **Build:** `app/gauntlet/components/ParentBanner.tsx` (client, dismissible via localStorage), rendered from `app/gauntlet/page.tsx` (server passes phase). Copy per brief §4.4/§5, "What is The 120? →" links home.
- **Accept:** strip shows above the game, dismissible and stays dismissed; tournament line matches phase; hidden entirely when phase `off`.

### GPF-4 · Config flags + kill switch (brief item 8)
The turn-on machinery itself.
- **Build:** `app/lib/tournament.ts` (phase resolution above), `resolveTournamentState()` + typed config + all state copy + weekly-theme schedule. Unit-tested (date derivation, env override, kill switch).
- **Accept:** date-derivation returns tease/live/after across the window boundaries; `TOURNAMENT_KILL=1` forces `off`; `TOURNAMENT_STATE` overrides; tests cover all branches.

---

## v2 — The Capture Machine (built dormant; Ethan+Dev own hardening / B1–B2 integrity)

### GPF-5 · Tournament entry flow — the gate (brief item 5)
- **Build:**
  - `gauntlet_tournament_entries` migration (handle, prize_band, parent_email, consent, `confirm_token`, `confirmed_at`, `referral_code`/`heard_about`, timestamps). Dormant.
  - Entry modal component (`app/gauntlet/components/TournamentEntryModal.tsx`): handle + prize band (3–6/7–8/9–12) + parent email + CASL checkbox + "how did you hear / ambassador code" field.
  - `POST /api/gauntlet/tournament/enter`: service-role insert, generate HMAC confirm token (mirror `nurture/token.ts`), send double-opt-in email via `sendEmail`. Degrades to a clear error if table absent.
  - `GET/POST /app/gauntlet/tournament/confirm`: verify token → stamp `confirmed_at`.
  - "Enter the Tournament" CTA appears in-game only when phase `live` (Tease shows "opens Aug 3").
- **Accept:** in Live, modal collects + validates fields, writes a `pending` entry, sends confirmation email; confirm link stamps `confirmed_at`; guest play untouched; when phase ≠ live the CTA is dormant/absent. Integrity (score caps, handle uniqueness) is B1/B2 — Ethan.

### GPF-6 · Rules page (brief item 6)
- **Build:** `app/gauntlet/rules/page.tsx` (server) — window, three prize bands + prizes ($50/$25/$10 + Founding Leaderboard spot + Fall Intensive demo priority for members), handles-never-real-names, winners-verified, weekly themes, standings-email note, PIPEDA privacy note. All facts from `tournament.ts` (single source of truth per Guardrail #6).
- **Accept:** `/gauntlet/rules` renders all sections from config; prize bands read 3–6/7–8/9–12; linked from homepage section + entry modal.

### GPF-7 · Share card → landing loop + referral attribution (brief item 7)
- **Build:** confirm `shareCard.ts` prints `the120.school/gauntlet` (it does); ensure the entry modal's ambassador-code field stores `referral_code` on the entry using the same `AMB-FIRSTNAME` convention the CRM ambassador tally reads, so the Friday tally counts tournament-sourced entries.
- **Accept:** referral code entered in the modal persists on the entry row; format matches the ambassador registry; share image → `/gauntlet` → first raid path verified < 10s (manual QA note).

---

## v3 — Tournament Live (built dormant; light up with data + config flip)

### GPF-8 · Live-state flip (brief item 9)
Automatic via GPF-4's date derivation + env override. No separate code.
- **Accept:** on Aug 3 (or `TOURNAMENT_STATE=live`) every surface flips to Live with no redeploy.

### GPF-9 · Weekly boss-theme highlight (brief item 10)
- **Build:** weekly-theme schedule in `tournament.ts` (3 themes with date ranges); homepage section + parent banner show the current week's theme when Live.
- **Accept:** during Live, the current week's theme string renders; rolls over by date; empty/absent outside Live.

### GPF-10 · Weekly standings email (brief item 11)
- **Build:** `app/api/cron/gauntlet-standings/route.ts` mirroring the nurture cron (CRON_SECRET bearer, claim-first idempotency), + copy module + `vercel.json` cron entry. **Dormant:** returns early unless phase `live` AND `STANDINGS_ENABLED=1`. Reads confirmed entries; per-kid standing degrades to what score data exists (full per-fact standings depend on B1 score logging — Ethan).
- **Accept:** cron 503s without CRON_SECRET; no-ops when not Live/enabled; when enabled + Live, sends one standings email per confirmed+consented parent, CASL footer + unsubscribe.

### GPF-11 · Founding Leaderboard permanent page (brief item 12)
- **Build:** `app/gauntlet/founding-leaderboard/page.tsx` — renders the board grouped by prize band; in `after` phase it's the permanent "Founding" board. Snapshot-at-close (D5) is a documented ops action; page reads current standings until then.
- **Accept:** page renders three band groups from live data; linked from homepage After state; handles-only (never names).

### GPF-12 · Post-close handoff (brief item 13)
- **Build:** documented wiring point — the existing data-driven nurture engine can reference a tournament entrant's run in the back-to-school deposit sequence. Minimal now (copy stub + note); full sequence is an Aug-24 ops step on the nurture rails.
- **Accept:** roadmap documents the hook; no dormant code that could misfire before close.

---

## GPF-13 · Roadmap section + Turn-On Checklist
New **GPF** section in `artifacts/roadmap.md` tracking GPF-1..12 status, plus a single **Turn-On Checklist** (apply migration via Management API → set env if overriding date default → enable standings cron → verify surfaces). This is the "quickly turn the whole thing on" switch, documented.

---

## Guardrails carried from the brief (§7)
1. E4 settled: core game never gated. Tournament gate is additive.
2. Integrity before publicity (B1/B2) is **Ethan's** — score caps + unique handles must be live before Aug 3. This build ships the *surfaces* dormant; it does not claim integrity is done.
3. Kids' data: handles never real names; parent email only; double opt-in; collect nothing else (PIPEDA/CASL).
4. No copy implying Gauntlet performance earns membership. Recognition + event access only.
5. Homepage hero always sells Membership; the Gauntlet section is one beat.
6. **Prize bands = 3–6/7–8/9–12** (assumption A) — rules page is the single source of truth. Confirm before turn-on.
