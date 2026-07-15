# Gauntlet roadmap — beta → Summer Tournament

Working surface for Gauntlet iteration (per Peter, 2026-07-15). High-churn game work lives here; milestone tickets stay in `roadmap.md` (M/G/GTM series) and link down. Ethan + Dev work off this file as time allows; Peter is PM.

**Feedback loop:** Discord (testers, 13+ only) → triage here within a day → ship → changelog entry posted back to Discord. Email = weekly summary + decisions.
**The bar (Peter):** UTS students say "this is both fun and helpful for my actual math learning."
**Sizes:** S = hours · M = a day · L = multi-day. **Owner:** either dev seat unless named.

## 📅 The dates that drive everything (from the GTM sprint)

| When | What |
|---|---|
| now → Jul 19 (W1) | Beta hardening — testers in Discord, worst rough edges gone |
| Jul 20–26 (W2) | **Soft launch to ambassadors** — leaderboard seeded, integrity features live |
| Jul 27–Aug 2 (W3) | Soft-run iteration — fix what ambassadors surface, prep themes |
| Aug 3 (W4) | **Tournament opens to everyone** — 3-week leaderboard sprint |
| Aug 3–23 | Live ops: weekly boss themes, standings emails, daily triage |
| Aug 17–23 (W6) | Info sessions — kids play the Gauntlet live on a projector (demo must not embarrass us) |
| ~Aug 23 close | Founding Leaderboard snapshot → permanent page; winners verified, prizes out |

---

## Phase A — Beta hardening (now → Jul 19)

- **A1 · Discord server + testers in** *(Ethan, human task)* — 🔴 server up, 3–5 UTS testers invited (one hardcore math kid, one not), #bugs / #ideas channels. Blocks the whole loop.
- **A2 · First-run setup** *(S)* — 🔴 pick grade band (and starting skills) before the first raid. A 7th-grader landing on Grades 3–4 quits before the second problem. Biggest single first-impression fix. *(M6 #3)*
- **A3 · Mobile number pad** *(M)* — 🔴 big tap targets under the problem card. Testers will play on phones; the stock keyboard is the worst part of mobile play. *(M6 #5)*
- **A4 · "My facts" mastery heatmap** *(M)* — 🔴 the fact set as a grid (multiplication-table layout for ×) colored by mastery/speed. The proof-of-learning artifact — the "helpful for my actual math learning" half of the bar, and screenshot-able for parents. *(M6 #4)*
- **A5 · GTM-2 smoke test** *(S; needs a signed-in run)* — 🔴 Mastery Trial signed in → handle → confirm the leaderboard shows it. Last unchecked box on cloud saves.

## Phase B — Tournament integrity + shell (must be live for W2 soft launch, hardened by Aug 3)

- **B1 · Score integrity (TR-1)** *(M–L; the one that bites if skipped)* — 🔴 trial scores are client-reported (upsert with the player's own JWT): a clever kid with devtools can post any `trial_best`. With prizes, assume it happens. W2 minimum: (a) server-side plausibility caps (score vs elapsed time vs problems-per-minute ceiling) enforced in the write path; (c) "winners are verified" (screen-recorded re-run) in the rules. By Aug 3: (b) trial results logged as event rows (score, duration, band, topic mix) so outliers are auditable. Needs a migration → Peter applies via Management API.
- **B2 · Handle integrity (TR-2)** *(S–M)* — 🔴 unique index on handles + kid-safe word filter (profanity/reserved list). Today two kids can share a handle = leaderboard impersonation. Same migration batch as B1.
- **B3 · Tournament shell (TR-3 = GTM-3)** *(M)* — 🔴 tournament window config, rules page (incl. verification + handles-never-real-names), parent-facing banner on /gauntlet, weekly boss-theme highlight slot, Founding Leaderboard snapshot page at close.
- **B4 · Mid-flight ops (TR-4)** *(S–M)* — 🔴 in-game announcement/changelog line (players see "new this week" without Discord — they're under 13); config kill-switch so a broken feature can be disabled without a redeploy.

## Phase C — Fun layer (W2–W3, re-cut weekly by tester feedback)

- **C1 · Boss personality** *(S–M)* — 🔴 mid-fight barks/taunts, enrage state under 25% HP. *(M6 #6)*
- **C2 · Daily quest** *(S)* — 🔴 "master 5 new facts today," tied to the existing daily streak. *(M6 #7)*
- **C3 · Fifth boss, "bragging rights" hard** *(M)* — 🔴 G1's difficulty goal: last boss tuned brutal, 2nd-to-last "earn your level-up." Constants are ready for per-boss modifiers; needs new sprite/arena (Nano Banana pipeline exists).
- **C4 · Trial end recap** *(S)* — 🔴 "tested 45/66 facts — 12 still unseen." *(M6 #8)*
- **C5 · Practice/zen mode** *(S–M)* — 🔴 no timer, no HP; warm-up + math-anxious kids. *(M6 #9)*
- **C6 · Next content band** *(L)* — 🔴 the 7 "current-engine" picks from gauntletcontent.md's ranked 28, then the `fraction` / `short-expression` / `two-numbers` answer engines (#7, #21, #23, #25, #26). More topics = more tournament variety for weekly themes.

## Phase D — Live tournament ops (Aug 3–23)

- **D1 · Weekly standings email (TR-5)** *(M)* — 🔴 top movers + your kid's band standing to consented parents; reuses the nurture/Resend rails. (Sprint W4 asset.)
- **D2 · Weekly boss themes ×3** *(S each, prep in W3)* — 🔴 content drops pre-built so tournament weeks ship on schedule even in a busy week.
- **D3 · Cosmetic unlock drop** *(M)* — 🔴 skins/arena palettes by level, released as the week-2 hype moment; doubles as M2 member flair + ambassador incentive. *(M6 #10)*
- **D4 · Daily triage** *(ongoing)* — Discord → this file → ship → changelog. Budget ~1h/day during the 3 weeks.
- **D5 · Close-out** *(S)* — 🔴 snapshot the Founding Leaderboard to its permanent page, verify winners (B1c), hand list to Peter for prizes.

## Phase E — After close (not before Sept)

- G2 pathway system (skill-tree unlocks — mastery tracking already measures readiness) · M2 member perks (early-access bosses, flair) · multiplayer if ever (M4).

## ❓ Open questions for Peter

1. **Prizes** — what exactly, per band? (Earlier proposal: named spot on the permanent Founding Leaderboard + first-demo slot at the October intensive. Cash/gift cards raise stakes on B1.)
2. **Exact tournament window** — Aug 3 open is fixed by the sprint; is close Sun Aug 23 EOD Toronto?
3. **Do ambassador soft-run scores carry into the public tournament, or does the board reset Aug 3?** (Recommend: reset, ambassadors keep a "founding raider" cosmetic — seeding a board they can't lose feels rigged to newcomers.)
4. **One combined leaderboard with band filter (current) or separate prize pools per band?** (Recommend: prizes per band, one board with filters — a 3rd-grader can't beat a 8th-grader's raw trial score.)
5. Migration timing for B1/B2 (needs your Management API run once the SQL is committed).

## 📓 Changelog (newest first — each entry gets posted to Discord)

- **2026-07-13** — Mastery model v2 (fact sets per topic; mastered = under 3 s twice in a row; raids focus unmastered facts; Mastery Trial deals the full set without repeats). Fixed 6×6 over-serving (35–50% → 3–10%, never back-to-back). Topic selection persists; results show facts mastered; chips show mastery counts. Cloud saves + leaderboard live.
