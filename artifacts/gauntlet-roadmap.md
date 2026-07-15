# Gauntlet roadmap — beta + Summer Tournament

Working surface for Gauntlet iteration (per Peter, 2026-07-15). High-churn game work lives here; milestone tickets stay in `roadmap.md` (M/G/GTM series) and link down. Feedback loop: **Discord (testers) → triage here → ship → changelog back to Discord.** Email = weekly summary + decisions.

**The bar (Peter):** UTS students say "this is both fun and helpful for my actual math learning."
**The deadline that matters:** tournament soft-launch to ambassadors W2 (week of Jul 20), public W4 (Aug 3), runs 3 weeks. Software must be good at open AND improvable mid-flight.

---

## 🧪 Beta program (G1)

- Testers: 3–5 UTS students (Ethan recruiting) — one hardcore math kid, one decidedly not.
- Channel: Discord server (13+ only — testers and ambassadors, **never grade 3–8 tournament players**; Discord ToS is 13+ and we are not moderating a server of 9-year-olds). Player-facing comms during the tournament = parent email + in-game announcement line.
- Cadence: testers play → #bugs / #ideas with screenshots → triaged into this file within a day → ship → changelog post.

## 🏆 Tournament readiness (blocks W4 public open; soft-run W2 with ambassadors)

**TR-1 · Score integrity** — 🔴 the one that bites if skipped. Trial scores are client-reported (`gauntlet_saves` upsert with the player's own JWT): any clever kid with devtools can post a fake `trial_best`. With prizes on the line, assume it happens. Plan, cheapest-first: (a) server-side plausibility caps on the upsert (score vs elapsed time vs problems-per-minute ceiling); (b) submit trial results as an event row (score, duration, band, topic mix) not just a high-water number, so outliers are auditable; (c) manual verification of prize winners (screen-record a re-run) stated in the rules. (a)+(c) are the W4 minimum.
**TR-2 · Handle integrity** — 🔴 handles have no uniqueness constraint: two kids can share one, enabling impersonation on the board. Unique index + profanity/reserved-word filter (kid-safe list), and the rules say "handles, never real names."
**TR-3 · Tournament shell (= GTM-3)** — 🔴 window config, rules page, weekly boss-theme highlight, parent-facing banner on /gauntlet, Founding Leaderboard snapshot at close (permanent page).
**TR-4 · Mid-flight ops** — 🔴 in-game announcement/changelog line (players see "new this week" without Discord); weekly boss-theme content drops prepped before open; feature-flag or config kill-switch so a broken feature can be disabled without a redeploy.
**TR-5 · Weekly leaderboard email** — 🔴 (sprint W4 asset) standings to consented parents; reuses nurture/Resend rails.

## 🎮 Fun & UX backlog (= roadmap M6, re-cut by beta feedback)

1. ✅ Persist topic selection between visits (2026-07-13)
2. ✅ Post-game "N new facts mastered" pill (2026-07-13)
3. 🔴 First-run setup: pick grade band before first raid (7th-graders currently land on Grades 3–4)
4. 🔴 "My facts" mastery heatmap (multiplication-table grid colored by mastery/speed) — the proof-of-learning artifact
5. 🔴 Mobile custom number pad (big tap targets; stock keyboard is the worst part of phone play)
6. 🔴 Boss personality: mid-fight barks/taunts, enrage state under 25% HP
7. 🔴 Daily quest: "master 5 new facts today" tied to daily streak
8. 🔴 Trial end recap: "tested 45/66 facts — 12 still unseen"
9. 🔴 Practice/zen mode (no timer, no HP)
10. 🔴 Cosmetic unlocks by level (doubles as M2 member flair + ambassador incentive)
11. 🔴 Weekly leaderboard view (feeds TR-3)

## 📓 Changelog (newest first — post each entry to Discord)

- **2026-07-13** — Mastery model v2 (fact sets per topic; mastered = under 3 s twice in a row; raids focus unmastered facts; Mastery Trial deals the full set without repeats). Fixed 6×6 over-serving (35–50% → 3–10%, never back-to-back). Topic selection persists; results show facts mastered; chips show mastery counts. Cloud saves + leaderboard live.
