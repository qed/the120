# The Gauntlet — Public Front Door: Marketing & Website Brief

**Version 1.0 — July 16, 2026**
**Owner:** Peter (v1 ships in ~24h) · Ethan + Dev (v2/v3 per gauntlet-roadmap.md phases B–D)
**Anchors:** roadmap E4 decision (Gauntlet = public lead magnet for basic play, never paywalled) · `gtm-8-week-sprint.md` (W2 soft launch Jul 20, W4 public Aug 3) · `gauntlet-roadmap.md` (B1–B4 tournament shell + integrity) · `the120-design-brief.md` (brand, voice, compliance)

---

## 1. The Strategy in One Paragraph

The Gauntlet is **lead generation, full stop**. Its job is to prove — in a kid's hands, for free, in under two minutes — that fast math can be fun and actually useful for school. The kid plays for free (E4 stands: no paywall, no forced sign-in). The **Summer Tournament is the conversion event**: to enter it and appear on the leaderboard, a parent's email + CASL consent is required. That is the one moment the kid bugs the parent, and it's the moment we capture the family. Membership in The 120 stays exactly what it is — $3,000, selective, the price is the price. The Gauntlet never becomes an admissions mechanic or an "earn membership" system; at most we hang **one or two in-person events** off the tournament (the W6 Toronto meetup and the winners' demo slot at the Fall Intensive Nov 7–8), which give parents a taste of what members get all year.

### Resolving the two open questions from the discussion

**Require sign-in to play?:** No. Sign-in-to-play kills the two things that make this channel work — share links that land a kid in a boss fight in one tap, and the E4 "public lead magnet, permanently" decision. Gate the *tournament*, not the *game* for basic game play. Guest play → "want your score to count or to enter the Tournament?" → parent email. The friction sits exactly where the motivation is highest. So we have no sign in to play, but sign in to save progress. 

**The 120 as progress-gated in-person activities:** The full "deliver results to get in" repositioning would rewrite the brand three weeks before the tournament and blur the $3,000 Membership pitch that the whole GTM sprint is built on. What we keep from the idea: (a) tournament achievement earns *recognition and event access* — permanent Founding Leaderboard, demo slot at the Fall Intensive, invite to the August meetup; (b) the message that The 120 is a place where results are the currency. What we drop: any implication that playing The Gauntlet and making progress is a path to membership in lieu of fees. 

---

## 2. The Funnel

```
Kid taps a share link / ambassador challenge / homepage "Play free"
        │  (no account, no friction — guest play, progress saves to device)
        ▼
Kid gets hooked (bosses, streaks, mastery heatmap)
        │
        ▼
"Enter the Summer Tournament — get on the leaderboard" (Aug 3–23)
        │  ← THE GATE: parent email + CASL express consent + grade band + kid-safe handle
        ▼
Parent email in the system  =  1 "interested family" (GTM funnel definition)
        │  nurture rails: welcome email → weekly standings email (D1) → info-session invite (W6)
        ▼
Info session / meetup → dossier → call → $250 deposit → Member of The 120
```

**What the parent is saying yes to when they consent:** tournament updates + their kid's standings + news about The 120. One checkbox, plain language, unsubscribe in every email (CASL).

**Why the gate converts:** the ask travels *through the kid*. "Mom, I need you to sign me up so my score counts" is a warmer intro than any ad. The GTM plan already prices this channel as the single highest-impact idea (§4 #1: "the only channel where the product markets itself to the actual member").

**GTM targets this must hit (from the sprint funnel):** W4 (Aug 3–9): +35 interested families, 105 cumulative, first 15 deposits. If tournament-sourced signups run 30% under for two weeks, the tournament becomes the primary push again the following week.

---

## 3. Message Architecture

Two audiences see the same surfaces. Every Gauntlet surface must work for both:

| | **The kid (player, gr. 3–8 or gr. 9-12)** | **The parent (buyer)** |
|---|---|---|
| What they want | Beat bosses. Climb the board. Beat their friends. | Proof this is a serious learning tool, not another screen game |
| Core line | "Every correct answer strikes the boss." | "A math trainer disguised as a boss battle — built by The 120." |
| Proof | Streaks, mastery counts, leaderboard rank | The "My Facts" mastery heatmap (A4) — screenshot-able evidence of exactly which facts their kid mastered, and how fast |
| CTA | **Play free** / **Enter the Tournament** | "See what your child mastered" → account → nurture |

**Naming and vocabulary (consistent everywhere):** *The Gauntlet* (the game) · *The Summer Tournament* (Aug 3–23) · *Founding Leaderboard* (the permanent page at close) · *raid*, *boss week*, *mastered facts*. Parent-facing copy always pairs fun with utility: "fast math, mastered" / "speed and accuracy your child can see."

**The bar (unchanged, from Peter):** UTS students say "this is both fun and helpful for my actual math learning." Marketing copy never claims more than the product shows.

---

## 4. Website Updates — Full Scope

Three releases mapped to the GTM calendar. v1 is Peter's, next 24h. v2 lands with the ambassador soft launch (Jul 20). v3 lands for the public open (Aug 3). Everything below is the complete build list.

### v1 — The Front Door (Peter, ships in ~24h)

**1. Nav entry (persistent, permanent).**
Label: **The Gauntlet** → `/gauntlet`. Nav order: The 120 · The Gauntlet · Tuition · FAQ · Log in · **Join the 120**. Rationale for the noun over "Play the Gauntlet": nav grammar (all other items are nouns), and parents scan navs — "The Gauntlet" reads as a program pillar, not a banner ad. The verb lives in the CTAs.

**2. Homepage section (new, sits after the Membership-components section, before testimonials).**
The hero does not change — the homepage still sells Membership first. The section is the proof-of-rigor beat *and* the kid entry point:

> **Section kicker:** THE GAUNTLET — FREE FOR EVERYONE
> **Headline:** Fast math, disguised as a boss battle.
> **Body:** The Gauntlet is The 120's free FastMath trainer for grades 3–8. Every correct answer strikes the boss — speed and streaks hit harder. Master a fact by answering it in under 3 seconds, twice in a row, and watch the mastery map fill in. No downloads, no ads, free to play.
> **Tournament line (state-dependent, see below):** *The Summer Tournament runs Aug 3–23. Three grade bands. Real prizes. A permanent spot on the Founding Leaderboard.*
> **CTAs:** [**Play free**] → /gauntlet · [Tournament rules] → /gauntlet/rules
> **Visual:** boss art (Clank/Gloop/Magmar/Vex) on one side, a My Facts mastery heatmap screenshot on the other — the kid hook and the parent proof in one frame.

**3. Section states (config-driven so nobody redeploys copy):**

| State | Window | Tournament line + CTA |
|---|---|---|
| Tease | now → Aug 2 | "The Summer Tournament opens **Aug 3**. Play now — be ready when the board goes live." [Play free] |
| Live | Aug 3–23 | "The Summer Tournament is **live until Aug 23**." + top-3-per-band mini-board or entrant count. [**Enter the Tournament**] |
| After | Aug 24 → | "The first Summer Tournament is in the books." [See the Founding Leaderboard] [Play free] |

**4. /gauntlet parent banner (minimal v1).**
One dismissible strip above the game, parent-voiced: *"Free to play, built by The 120 — a selective network for Toronto's brightest kids, grades 3–8 / grades 9-12. Summer Tournament opens Aug 3. → What is The 120?"* Links back to the homepage. This is the reverse-direction funnel: kids arrive at /gauntlet from share links and their parents need one obvious path to the pitch.

### v2 — The Capture Machine (Ethan + Dev, live by Jul 20 soft launch)

These are the B-phase tickets from `gauntlet-roadmap.md` with the marketing requirements made explicit:

**5. Tournament entry flow (the gate — new, highest priority).**
From any play state: **Enter the Tournament** → modal: kid-safe handle (B2: unique, word-filtered, *never real names*) + grade band (3–4 / 5–6 / 7–8) + **parent email** + CASL express-consent checkbox ("Email me my child's tournament standings and news from The 120 — unsubscribe anytime"). Parent email gets a confirmation email (double opt-in — cleanest CASL posture and it verifies deliverability). Until confirmed: kid can play trials, score is held, shown as "pending parent confirmation." Guest play remains untouched and unlimited — the gate applies only to leaderboard entry.

**6. Rules page (`/gauntlet/rules`, B3).**
Plain-language, parent-first: window (Mon Aug 3 → Sun Aug 23) · three bands · prizes ($50/$25/$10 per band + named spot on the permanent Founding Leaderboard + priority demo-stage time at the Fall Intensive Nov 7–8 for members) · **handles never real names** · **winners are verified** (screen-recorded re-run — B1 integrity, stated up front so it reads as fairness, not suspicion) · weekly boss themes · how parents get standings emails · privacy note (what we collect and why, per PIPEDA — collect only handle, band, parent email).

**7. Share card → landing loop (verify end-to-end).**
Share card already prints `the120.school/gauntlet`. Confirm the shared image → page → first raid path takes under 10 seconds with zero interstitials, and that ambassador referral codes (`AMB-FIRSTNAME`) attach to tournament entries via the "how did you hear" field so the Friday tally works.

**8. Homepage/nav config flags.**
`tournament_state` (tease/live/after) + kill switch (B4) drive the homepage section, /gauntlet banner, and entry CTA together.

### v3 — Tournament Live (by Aug 3, then live ops Aug 3–23)

**9. Homepage section flips to Live state** (config only, no deploy).
**10. Weekly boss-theme highlight** (B3/D2): homepage section and /gauntlet banner show the current week's theme ("Week 2: Magmar's Fraction Forge") — gives ambassadors and parent-group posts a fresh reason to share three times, not once.
**11. Weekly standings email (D1):** to consented parents — kid's band standing, facts mastered this week, one line about The 120 with the info-session link (W6 sessions are Aug 17–23; this email is their invitation channel).
**12. Founding Leaderboard permanent page** (D5, `/gauntlet/founding-leaderboard`): snapshot at close, winners named by handle, linked from the homepage After state. This page is a durable asset — every future season points at it ("names go up once").
**13. Post-close handoff (Aug 24 → W7 deposit push):** tournament families flow into the standard nurture; the "back-to-school, $250 refundable" sequence references the kid's tournament run ("[Handle] mastered 41 facts in August — imagine a year").

---

## 5. Copy Blocks (ready to paste, tune freely)

**Nav:** `The Gauntlet`

**Homepage section:** as spec'd in §4.2 above.

**/gauntlet parent banner (v1):**
> Free to play, built by The 120 — Toronto's selective network for kids who ask for more. **Summer Tournament opens Aug 3.** [What is The 120? →]

**Tournament entry modal:**
> **Enter the Summer Tournament**
> Aug 3–23 · Grades 3–8 · Three bands · Real prizes
> Pick your handle (not your real name — that's the rule): `[________]`
> Grade band: `[3–4] [5–6] [7–8]`
> A parent's email (they get your standings — and they have to say yes): `[________]`
> ☐ *Parent consent:* Email me my child's tournament standings and news from The 120. Unsubscribe anytime.
> [**Lock it in**]

**Parent confirmation email (subject):** "Your kid wants on the leaderboard" — body: what the Gauntlet is, what they'll receive, confirm button, one quiet line about The 120 with the explainer PDF.

**Ambassador share line (kit refresh, W2):** "I'm on the board for the Summer Tournament. Play free, then come find me — the120.school/gauntlet"

**Parent-group post skeleton (W3–W4, value-first per GTM rules):** free math trainer a Toronto founder built · grades 3–8 · mastery-based (under-3s twice = mastered) · free to play, tournament in August · no link-dropping in no-promo groups, PDF by DM.

---

## 6. Measurement

Track weekly in the Friday review, against the GTM funnel table:

| Metric | Source | Target |
|---|---|---|
| Guest plays (unique devices) | analytics event `raid_started_guest` | leading indicator, no target |
| Tournament entries started / completed | entry modal events | watch drop-off at the parent-email field |
| **Parent emails confirmed (double opt-in)** | Resend | **this is "+35 interested" in W4** |
| Entries by source (ambassador code / share card / homepage / parent group) | how-did-you-hear field | ambassadors should lead; if homepage leads, the section is over-performing — feed it |
| Standings-email → info-session RSVP | UTM on D1 email | the W6 bridge |
| Tournament families → dossier started | CRM stage | the September question |

---

## 7. Guardrails & Risks

1. **E4 is settled law:** the core game is never paywalled, never sign-in-gated. The tournament gate is additive.
2. **Integrity before publicity (B1/B2):** cash prizes + public leaderboard means score plausibility caps and unique filtered handles must be live before the Aug 3 open — a rigged board discovered by a parent group is the anti-lead-magnet. "Winners are verified" is stated in the rules from day one.
3. **Kids' data (PIPEDA / CASL):** handles never real names, parent email is the only contact captured, double opt-in, collect nothing else. Under-13s aren't in Discord — the in-game announcement line (B4) is their changelog.
4. **Don't oversell the ladder:** no copy implying Gauntlet performance earns or influences membership admission. Recognition and event invites only. The assessment stays the assessment.
5. **Brand ceiling:** the homepage hero always sells Membership; the Gauntlet section is one beat, not the lead. If the tournament section starts outperforming everything, that's a September strategy conversation, not an August hero swap.
6. **Prize-band mismatch to fix:** the roadmap decision says Grade School / Middle School / High School; the GTM plan and game bands say 3–4 / 5–6 / 7–8. Recommend the three game bands ($50/$25/$10 each) — confirm and make the rules page the single source of truth.


## 9. Next Actions

| When | Who | What |
|---|---|---|
| Next 24h | Peter | v1: nav link, homepage section (Tease state), /gauntlet banner. Ship ugly, review with Ethan. |
| By Jul 20 | Ethan + Dev | v2: entry flow + double opt-in, rules page, handle/score integrity (B1a/B2), config flags. Soft-launch to ambassadors with the refreshed kit line. |
| Jul 27–Aug 2 | All | W3 iteration: fix what ambassadors surface; pre-build 3 boss themes; parent-group posts warm up. |
| Aug 3 | Config flip | Section → Live. First standings email cycle begins. |
| Aug 24 | Ethan | Founding Leaderboard page live; entries flow into W7 deposit push. |

**Confirmed details**

(1) Prize bands confirmed = 3–6/7–8/9–12
(2) Events that tournament results drive into  — Recognition at the Sept 2026 Kickoff event + a guaranteed Fall Intensive demo slot
(3) the standings emails come from admissions@the120.school
