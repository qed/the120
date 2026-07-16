# The Gauntlet — Public Front Door: Story Decomposition

**Version 1.0 — July 16, 2026** · Companion to `artifacts/public-gauntlet-marketing.md` (the brief)
**Purpose:** Turn the brief's 13-item build list into discrete, buildable stories with acceptance criteria, wired so the *entire* tournament ships now in a **dormant** state and is **turned on with a config flip** when the Summer Tournament opens (Aug 3, 2026).

Tracked as the **GPF** (Gauntlet Public Front-door) series in `artifacts/roadmap.md`. Story IDs below map 1:1 to the brief's numbered items and to the roadmap tickets.

---

## The keystone: one tournament state machine

Everything hangs off a single server-safe config module, `app/lib/tournament.ts`. Every surface (homepage section, `/gauntlet` banner, entry CTA, rules page, standings email, founding leaderboard) reads its phase and copy from here — so "turning on the tournament" is **one switch**, never a copy-hunt across files.

**Phase resolution (in priority order):**
1. `TOURNAMENT_KILL=1` (server env) → phase `off`: every tournament surface hides, `/gauntlet` falls back to plain "Play free". This is the B4 kill switch — **no code change**, but note the redeploy caveat below.
2. `TOURNAMENT_STATE=tease|live|after` (server env) → manual override for testing / emergencies.
3. **Date-derived default** (no env needed): `tease` before Aug 3 → `live` Aug 3–23 → `after` Aug 24+. Evaluated server-side per request, so the date boundaries **auto-flip to Live on Aug 3 and to After on Aug 24 with zero action** — this is the only truly redeploy-free path.

**Redeploy caveat (corrected after review):** the *date* auto-flip needs no redeploy (the server recomputes each request). But **changing a Vercel env var (`TOURNAMENT_STATE` / `TOURNAMENT_KILL`) takes effect only on the next deployment** — it's a config change, not a code change, but it still requires a redeploy. So the emergency kill switch is "set env + redeploy," not instant. Plan around this: the date flip is the primary mechanism; env is the override.

**Rendering caveat (corrected after review):** `/gauntlet`, `/gauntlet/rules`, and `/gauntlet/founding-leaderboard` are `force-dynamic` (per-request, instant). **The homepage section is NOT** — `app/page.tsx` has no dynamic directive and is only ISR-revalidated (~60s) incidentally via `getSeatsRemaining`'s `revalidate:60` fetch. So on the homepage the phase flip (and a kill) lag up to ~60s plus one stale-served request. **Decision needed (D3):** mark `app/page.tsx` `force-dynamic` for an instant homepage kill, or accept the ISR lag on the marketing surface.

**Why server env (not `NEXT_PUBLIC_`):** `NEXT_PUBLIC_*` is inlined at build time. Plain server env is read at request time (still redeploy-gated on Vercel, per the caveat above). `app/gauntlet/page.tsx` is a server component, so it resolves the phase and passes it as a prop into the client game tree — request-time state without a code rebuild.

**What "turned on" actually means (corrected after document review):** the config flip lights up the *surfaces* — nav, homepage section, banner, rules page, entry modal, standings cron, founding-leaderboard page. It does **not**, by itself, produce a *runnable* tournament. Two data-model gaps (D1, D2 below) and the B1/B2 integrity work must be resolved before the flip yields a tournament that can rank entrants, compute per-band winners, or send real standings. Framing this as "one switch turns on the whole tournament" overclaims; it turns on the shell.

**🚧 Open architecture decisions — BLOCKING, must resolve before turn-on (surfaced by review):**
- **D1. Guest entries have no path to a leaderboard score.** Scores live only in `gauntlet_saves`, which is account-bound (`user_id → auth.users`, own-row RLS) and written only for signed-in players by `cloudSave.ts`. A tournament entry writes to a separate `gauntlet_tournament_entries` table with a parent email but **no score column and no join key to a save**. So an email-only entrant literally cannot appear on the board they entered to appear on. **Decision needed:** either (a) require a free account (sign-in-to-save) to rank, and have the entry modal drive account creation; or (b) build an entries-keyed scoring path independent of `auth.users`. The brief's funnel ("enter → appear on the leaderboard") does not work until this is chosen and built.
- **D2. Prize bands can't be computed from scores.** Entries store `prize_band` ∈ {b36, b78, b912}; scores store `band` ∈ {g34, g56, g78}. No join key, and there is **no 9–12 bucket in the game at all** (a 9–12 entrant's save band is g78). So the three prize pools and the $50/$25/$10 per-band payouts are **uncomputable** from what exists, and `FoundingBoard` can only ever group by the game bands, not the prize bands the rules page promises. **Decision needed:** add a `prize_band` (or a mapping) to the score source plus a prize-band-aware RPC, and decide whether 9–12 ships (it has no content band) or is cut for the first season.

**Assumptions flagged for Peter/Ethan before turn-on (see Guardrails):**
- **A. Prize bands = 3–6 / 7–8 / 9–12** (brief "Confirmed details (1)", not §9 "Next Actions"). Stored on the entry as `prize_band`, independent of the game's `g34/g56/g78` practice bands. **Note the unresolved consequence in D2** — a 9–12 entrant currently plays 7–8 content and there is no 9–12 board bucket.
- **B. Tournament entry is parent-email lead capture, not a forced account.** Per E4 + brief §1: no sign-in to play. The entry modal captures handle + prize band + parent email + CASL consent into a new `gauntlet_tournament_entries` table via a service-role API route (guests have no JWT); a random opaque `confirm_token` (stored, not HMAC) drives double opt-in at `/api/gauntlet/tournament/confirm`. **This is only "additive" to the `gauntlet_saves` leaderboard once D1 is resolved** — until then the two are disjoint.
- **C. Migrations are NOT auto-applied.** Like `gauntlet_saves` / `cloudSave.ts`, all new tournament code **degrades gracefully when its table is absent** (guest/dormant) — except the standings cron, which returns 500 on a missing table once enabled, so it must not be enabled before the migration is applied. The migration is applied via the Management API playbook as a documented turn-on step.

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
  - `POST /api/gauntlet/tournament/enter`: service-role insert, generate a **random opaque `confirm_token`** (stored on the row — not HMAC; the unsubscribe token is the HMAC one), send double-opt-in email via `sendEmail`. Degrades to a clear error if table absent.
  - `GET /api/gauntlet/tournament/confirm`: match token → stamp `confirmed_at`, idempotent, with success / expired / already-confirmed landing states. **Note (review P2):** a plain GET side-effect can be triggered by email-scanner prefetch (Safe Links/Proofpoint) and falsely confirm CASL consent — consider a confirm *button* (POST) on the landing page. Also use `timingSafeEqual` for the token compare (the unsubscribe route already does).
  - **Token util (review P3):** `app/lib/gauntlet/token.ts` duplicates `nurture/token.ts` — parameterize and share one HMAC util instead of two.
  - "Enter the Tournament" CTA appears in-game only when phase `live` (Tease shows "opens Aug 3").
  - **Handle-collision rule (review P0 — must fix before turn-on):** the enter route currently upserts `onConflict:"handle"`, so a second family choosing a taken handle **overwrites the first family's parent_email, consent, and confirmation** (PII/consent hijack + griefing). Change to: reject a taken handle unless the request proves ownership (matching `parent_email` or original `confirm_token`); surface "that handle's taken" on the handle field.
  - **Abuse control (review P1):** rate-limit the endpoint (per-IP + per-parent-email) — it sends real email on every call.
- **Accept:** in Live, modal collects + validates fields, writes a `pending` entry, sends confirmation email; confirm link stamps `confirmed_at`; a taken handle is rejected (not overwritten); guest play untouched; when phase ≠ live the CTA is dormant/absent. Integrity (score caps, handle uniqueness, name filter) is B1/B2 — Ethan.

### GPF-6 · Rules page (brief item 6)
- **Build:** `app/gauntlet/rules/page.tsx` (server) — window, three prize bands + prizes ($50/$25/$10 + Founding Leaderboard spot + Fall Intensive demo priority for members), handles-never-real-names, winners-verified, weekly themes, standings-email note, PIPEDA privacy note (**including a retention/deletion line: how long entries are kept and how a parent requests deletion — review P2**). All facts from `tournament.ts` (single source of truth per Guardrail #6).
- **Accept:** `/gauntlet/rules` renders all sections from config; prize bands read 3–6/7–8/9–12; retention/deletion stated; linked from homepage section + entry modal.

### GPF-7 · Share card → landing loop + referral attribution (brief item 7)
- **Build:** confirm `shareCard.ts` prints `the120.school/gauntlet` (it does); ensure the entry modal's ambassador-code field stores `referral_code` on the entry using the same `AMB-FIRSTNAME` convention the CRM ambassador tally reads, so the Friday tally counts tournament-sourced entries.
- **Validate the code (review P1):** the endpoint stores any `referral_code` string with no existence check — on an unauthenticated endpoint this lets anyone inflate/deflate an ambassador's tally. Validate `referral_code` against the `ambassador_codes` registry before storing (unknown → store as unverified/null), unless the CRM tally already validates independently (confirm).
- **Accept:** referral code entered in the modal persists on the entry row; unknown codes are not silently credited; share image → `/gauntlet` → first raid path verified < 10s (manual QA note).

---

## v3 — Tournament Live (built dormant; light up with data + config flip)

### GPF-8 · Live-state flip (brief item 9)
Automatic via GPF-4's date derivation + env override. No separate code.
- **Accept:** on Aug 3 (or `TOURNAMENT_STATE=live`) every surface flips to Live with no redeploy.

### GPF-9 · Weekly boss-theme highlight (brief item 10)
- **Build:** weekly-theme schedule in `tournament.ts` (3 themes with date ranges); homepage section + parent banner show the current week's theme when Live.
- **Accept:** during Live, the current week's theme string renders; rolls over by date; empty/absent outside Live.

### GPF-10 · Weekly standings email (brief item 11)
- **Build:** `app/api/cron/gauntlet-standings/route.ts` mirroring the nurture cron (CRON_SECRET bearer, weekly `last_standings_at` gate), + copy module + `vercel.json` cron entry. **Dormant:** returns early unless phase `live` AND `STANDINGS_ENABLED=1`.
- **Correction (review P2):** the cron reads *no score source* (only handle / prize_band / email), so today the "standings" email carries **no rank or standing** — it's a generic weekly nudge. Real per-kid standings are blocked on D1 (entry↔score linkage) + B1 score logging. Either reframe the copy as a nudge or hold the feature until D1 lands. It also 500s if the table is absent — apply the migration before enabling.
- **Accept:** cron 503s without CRON_SECRET; no-ops when not Live/enabled; when enabled + Live, sends one email per confirmed+consented parent, CASL footer + one-click unsubscribe (honored by the cron).

### GPF-11 · Founding Leaderboard permanent page (brief item 12)
- **Build:** `app/gauntlet/founding-leaderboard/page.tsx` — reuses the existing public board (`FoundingBoard` → `gauntlet_leaderboard` RPC). **Correction (D2):** it currently groups by the *game* bands (g34/g56/g78), **not** the prize bands, and has no 9–12 bucket — so it does not yet show the three prize pools the rules page promises. Resolving D2 (prize-band-aware RPC) is prerequisite. Snapshot-at-close (D5) is a documented ops action.
- **Dormancy criterion (review P2):** the route is publicly reachable now with sparse/empty data. Decide: gate it (coming-soon / unlinked until `after`) or accept early visibility with an intentional empty state. `FoundingBoard` degrades to an empty state on fetch failure (the RPC helper returns `[]`, not an error), so there is no infinite-spinner state.
- **Accept:** board renders from live data with an intentional empty state; grouping reflects the D2 decision; linked from homepage After state; handles-only (never names).

### GPF-12 · Post-close handoff (brief item 13)
- **Build:** documented wiring point — the existing data-driven nurture engine can reference a tournament entrant's run in the back-to-school deposit sequence. Minimal now (copy stub + note); full sequence is an Aug-24 ops step on the nurture rails.
- **Accept:** roadmap documents the hook; no dormant code that could misfire before close.

---

## GPF-13 · Roadmap section + Turn-On Checklist
New **GPF** section in `artifacts/roadmap.md` tracking GPF-1..12 status, plus the **Turn-On Checklist**. Ordered gates (a flip is only safe once all pass):
1. **Resolve D1 (entry↔score linkage) and D2 (prize-band winner computation)** — without these the tournament cannot rank or pay out. Blocking.
2. **B1 + B2 integrity live** (Ethan): score plausibility caps, unique handles, **and the name/profanity handle filter** that enforces "handles never real names" (Guardrail #3). Blocking, before any public open.
3. **Abuse controls on the public enter endpoint** — per-IP / per-parent-email rate limiting or a bot challenge (it sends real email via Resend on every call; unthrottled it is an email-bomb + deliverability risk). Blocking.
4. **Apply the migration** `20260716120000_gauntlet_tournament_entries.sql` via the Management API playbook, *before* enabling the standings cron (which 500s on a missing table).
5. **Provision `UNSUBSCRIBE_SECRET`** in Vercel (distinct from `SUPABASE_SERVICE_ROLE_KEY`, whose fallback should never be used in prod).
6. **State (redeploy-gated):** date auto-flips on Aug 3; to force early set `TOURNAMENT_STATE=live` + redeploy; emergency `TOURNAMENT_KILL=1` + redeploy. Decide D3 (homepage `force-dynamic` vs ISR lag).
7. **Standings:** set `STANDINGS_ENABLED=1` + confirm `CRON_SECRET` (GTM-1 dependency).
8. **PII ops:** confirm a retention/deletion process for `gauntlet_tournament_entries` (see GPF-6).
9. **Verify** surfaces + entry → confirmation email → confirm-link states.

---

## Guardrails carried from the brief (§7)
1. E4 settled: core game never gated. Tournament gate is additive.
2. Integrity before publicity (B1/B2) is **Ethan's** — score caps + unique handles must be live before Aug 3. This build ships the *surfaces* dormant; it does not claim integrity is done.
3. Kids' data: handles never real names; parent email only; double opt-in; collect nothing else (PIPEDA/CASL).
4. No copy implying Gauntlet performance earns membership. Recognition + event access only.
5. Homepage hero always sells Membership; the Gauntlet section is one beat.
6. **Prize bands = 3–6/7–8/9–12** (assumption A) — rules page is the single source of truth. Confirm before turn-on.
