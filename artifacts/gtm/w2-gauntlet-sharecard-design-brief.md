# The Gauntlet — Shareable Score Card — Design & Build Brief

**Version 1.0 — July 20, 2026**
**For:** Ethan (build owner) · **From:** GTM sprint (Dev Ticket B, sprint §6)
**Deliverable:** An auto-generated, shareable score-card image + share flow on `/gauntlet`
**Why it's on the critical path:** the ambassador program's entire viral mechanic is a kid finishing a Gauntlet run and sharing their score. No card = ambassadors have nothing to share. It's also required before the Gauntlet goes public in Week 4.

> **Ethan — this brief is written to be built around.** Section 9 ("What I need from you") lists the assets and answers I need to spec the visual design precisely. Send those back and I'll finalize the exact layout, copy, and dimensions. Everything before §9 is the intent and the requirements; §9 is where you fill in what only you and the game know.

---

## 1. What it is

When a kid finishes a Gauntlet session (or hits a milestone — new high score, beats a boss, climbs the leaderboard), the game offers a **one-tap "Share my score."** That generates a branded image — the score card — plus a share link that carries the kid's **referral code**. Friends see the card, tap the link, land on `/gauntlet`, and enter the same tournament. The referring kid gets credit; the family that signs up gets attributed to that ambassador.

It is two things working together:
1. **The image** — a good-looking, screenshot-worthy card a 10–14-year-old is proud to post or send.
2. **The link** — a referral-coded URL that turns a share into a tracked signup.

## 2. The job it has to do

- **Make the kid look good.** The card celebrates *their* achievement first, The 120 second. If it reads like an ad, they won't share it.
- **Be trivially shareable** where kids actually are: iMessage/text, AirDrop, Instagram DM/story, Snapchat, WhatsApp. That means a downloadable image *and* correct link-unfurl (OpenGraph) previews.
- **Carry the referral code** invisibly, so attribution just works with zero effort from the kid.
- **Give the recipient one obvious next step:** "Beat my score" → `/gauntlet` join flow.
- **Reassure the parent** who sees it over their kid's shoulder: this is a serious math trainer built by a Toronto founder, not a random game.

## 3. Where it's used

| Surface | Use |
|---|---|
| End-of-run screen | Primary "Share my score" CTA after a session/milestone |
| Ambassador shares | Ambassadors post/send their card to challenge friends (their code baked in) |
| Parent shares | "Free math game a Toronto founder built" — parent forwards to other parents |
| Leaderboard | Same card template for "I'm #3 in Grade 5–6 this week" |
| OpenGraph unfurl | When the share *link* is pasted, the card image previews in the chat/app |

## 4. What's on the card (content requirements)

Must include, in priority order:
1. **The kid's result** — the hero. Score / rank / boss beaten / grade-band standing (exact metric TBD, see §9).
2. **First name or handle** — "MAYA just cleared Boss Week 2" (first name only — never full name; COPPA/kid-safety, see §7).
3. **The Gauntlet mark** + a line that says what it is ("The 120's math gauntlet").
4. **The 120 wordmark** — present but secondary.
5. **The challenge CTA** — "Beat my score → the120.school/gauntlet".
6. **The referral code**, shown small (e.g. `AMB-MAYA`) *and* embedded in the link/QR.
7. **Grade band** (3–4 / 5–6 / 7–8) so it's an apples-to-apples brag.

Optional / nice-to-have: streak, XP, a weekly "boss week" theme badge, seat-count or "Founding Leaderboard" flair.

## 5. Behaviour & flow

1. Kid taps **Share my score**.
2. System generates the image server-side from live run data (name, score, rank, boss, grade band, code).
3. Kid gets: **(a)** the image to save/post, and **(b)** a share link `the120.school/g/{code}?s={score-token}`.
4. Link → `/gauntlet` landing with the OG image = their card, headline pre-filled ("MAYA challenged you"), and the referral code **pre-populated into the signup's referral field** (the `AMB-NAME` field already live on account creation).
5. On signup, `how did you hear = "A friend or ambassador"` + `referral code = AMB-MAYA` is written — closing the attribution loop into the CRM Source column.

## 6. Technical notes (proposed — adjust to your stack)

- **Image generation:** server-side rendered OG image (e.g. Vercel OG / `@vercel/og`, Satori, or an HTML-to-PNG worker) so every card is dynamic and crisp. Cache per (code, score-token).
- **Dimensions:** ship at least two crops from one template — **1200×630** (OG/link unfurl, landscape) and **1080×1350** (IG/story-friendly, portrait). A 1080×1080 square is a useful third.
- **Referral plumbing:** the `{code}` in the URL maps to the existing `AMB-NAME` referral field; carry a UTM set (`utm_source=gauntlet&utm_medium=sharecard&utm_campaign=summer-tournament`) for analytics without breaking the CRM attribution.
- **QR option:** include a QR encoding the referral link for in-person/AirDrop-adjacent sharing (kids showing friends on a phone).
- **Fallback:** if a kid shares before we have a name, use "A Gauntlet player" and still carry the code.

## 7. Kid-safety / compliance (non-negotiable)

- **First name or self-chosen handle only** on any public-facing card. Never full name, school, age, or photo.
- No location beyond "Toronto."
- Referral is recognition-only — the card must never imply a kid earns money per signup (sprint §3 ethics line).
- Parent consent already governs the account; the card shares achievement, not contact info. No harvesting: recipients arrive by acting themselves.

## 8. Voice & visual direction

- **Voice:** kid-proud, a little competitive, never corporate. "Cleared it." "Top 5 this week." "Think you can beat that?"
- **Visual:** on-brand with The 120 design system (tokens in `The 120 Design System/tokens/` — colours, fonts, wordmark) but with the Gauntlet's own energy — this is the one place the brand gets to feel like a game. Use the red Tin Can / 120 graphic devices sparingly; let the score be the hero.
- **Is:** screenshot-worthy, legible at thumbnail size, one clear brag + one clear CTA.
- **Is not:** a cluttered stats dump, an obvious ad, or anything that needs the kid to explain it.

## 9. What I need from you, Ethan (so I can finalize the design)

Please send back:
1. **The score model** — what does a Gauntlet run actually produce? Score? Rank? XP? "Boss" beaten? What's the single most brag-worthy number? (This decides the hero element.)
2. **Grade bands & "boss week"** — confirm the 3–4 / 5–6 / 7–8 bands and what a weekly "boss" is, so the card can badge them.
3. **Brand assets you have** — the Gauntlet logo/mark, any existing screenshots, colour usage, and the font files (or confirm we use the design-system fonts).
4. **Leaderboard data shape** — fields available for a "#3 in Grade 5–6 this week" card.
5. **Tech constraints** — your rendering stack and whether server-side OG image generation is feasible, or if we template it another way.
6. **The referral field contract** — confirm the exact param name and how the `AMB-NAME` field ingests a pre-filled code from a URL.
7. **Timeline** — your realistic build estimate, so we can sequence the public Gauntlet launch (currently Week 4).

Once I have 1–4, I'll deliver pixel-level layout specs and final copy for each card variant.

## 10. Open items

- Score-token security: signable so kids can't fake a score on the card? (Low stakes, but decide.)
- Do we gate "Share" behind account creation, or allow anonymous play → share → then the friend creates the account? (Anonymous-play-first likely converts better — confirm.)
- Weekly leaderboard email (sprint §2, W4 asset) reuses this card — build the template with that reuse in mind.
