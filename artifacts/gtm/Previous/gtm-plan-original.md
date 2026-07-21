# The 120 — 8-Week Summer GTM Sprint

**Window:** Mon Jul 13 → Fri Sep 4, 2026 · **Mission:** 200 interested families + a pile of $250 refundable deposits before Sept 1, so September fills the calendar on its own.
**Hard goal:** all 120 seats (113 open) committed by Sept 30, with a waitlist.
**Operator:** the founder, solo, with two devs on tickets. Assume ~20 focused GTM hours/week plus calls.

Borrowed from founders.school's "Year in Detail": (1) **named phases with one verb each** — their year is five 8-week sessions named Sell/Build/Validate/Grow/Scale; this sprint is four 2-week phases named **Arm / Seed / Surge / Land**; (2) **"the rhythm stays constant"** — one primary push per week, same weekly cadence throughout; (3) **peer-driven advancement** — their students are voted forward by their cohort; our ambassador program makes kids the engine, not the audience; (4) **parents attend the capstone** — every pitch ends on the Nov 7–8 intensive where kids demo real work; (5) **high-conviction risk reversal** — their "$1M by senior year or full refund" becomes our honest version: *"$250, fully refundable until Sept 30. The only thing you can lose is the seat."*

---

## 1. The Funnel Math

One "interested family" = a CASL-consented email in the system (account created, info-session RSVP, or opt-in form).

| Stage | Conversion | Count by Sep 1 |
|---|---|---|
| Interested families (consented) | — | **200** |
| Account + child dossier started | 55% of interested | 110 |
| Dossier submitted | 70% of started | 77 |
| Intro call booked | 45% of interested | 90 |
| Call held (no-show ~20%) | 80% of booked | 72 |
| **$250 deposit paid** | ~60% of held calls + some call-skippers | **48–55** |

Reality checks: 200 leads over 7 active weeks ≈ **29/week**. 72 calls over 7 weeks ≈ **10/week** (2/day, sustainable solo). 48–55 deposits by Sept 1 leaves ~60 seats for September — fed by the nurture machine, evangelist parents, and back-to-school urgency (§5). Track weekly against this table; if any stage runs 30% under for two weeks, that stage is the next week's primary push regardless of plan.

**Blocking dependency (Week 1, non-negotiable):** Stripe is still test mode (roadmap S10). No real deposit can be taken until live keys + a verified $250 charge/refund round-trip ship. Also: booking link (T2) doesn't exist, and there's no email provider. Week 1 exists to fix all three.

---

## 2. Week-by-Week

### Phase 1 — ARM (Weeks 1–2): build the machine, ignite the warm network

| Week | Primary push | Concrete actions | Channels | Targets | Asset the week needs |
|---|---|---|---|---|---|
| **W1** Jul 13–19 | **Machine online + warm 25** | Create Cal.com booking link (T2, 30 min) and set `NEXT_PUBLIC_BOOKING_URL`. Kick S10 Stripe go-live (account decision + live keys + one real charge/refund test). Pick email provider (Resend for transactional + simple broadcasts; Customer.io if budget allows) and wire welcome email. Dev ticket: "How did you hear about us? / referral code" field on account creation. Personally message 25 warmest contacts (UTS circles, the 7 founding families, /parents story families) — personal notes, not blasts. | Personal email/text, coffee | 25 warm convos started, 10 calls booked, machine live | **One-page explainer PDF** (five groups, $3,000, refundable $250, Nov 7–8 intensive) + welcome email #1 |
| **W2** Jul 20–26 | **Recruit the ambassadors** | Recruit 12–15 F1/F2 (grade 7/8) ambassadors through the founder's kids' network and friends-of-friends (§3). One 45-min virtual kickoff with kids + a parent each. Issue referral codes. Soft-launch the Gauntlet Summer Tournament to ambassadors only — seed the leaderboard. Ask each of W1's warm families for two introductions. | DM/text via parents, one Zoom kickoff | 12 ambassadors onboarded, 20 total calls booked, 40 interested | **Ambassador kit**: 1-page "what you do," referral code card, 3 shareable Gauntlet images, parent consent note |

### Phase 2 — SEED (Weeks 3–4): plant in communities where the 120 already hang out

| Week | Primary push | Concrete actions | Channels | Targets | Asset the week needs |
|---|---|---|---|---|---|
| **W3** Jul 27–Aug 2 | **Gifted-parent communities** | Value-first posts (founder's TimeBack story from /parents — real data, real kids) in Ontario gifted/enrichment parent Facebook groups and ABC (Association for Bright Children) Ontario chapters; offer the explainer PDF on request. Never post links cold into groups that ban promo — answer questions, DM the PDF. 3 "120 coffees" with connector parents (school-council chairs, camp directors). | Facebook groups, ABC Ontario, Reddit r/askTO & r/ontario parenting threads, coffees | +30 interested (70 cum.), 30 calls booked cum. | **/parents story post** (300-word founder narrative, no hype, link at end) + 5 canned answers to common objections |
| **W4** Aug 3–9 | **The Gauntlet goes public** | Open the Gauntlet Summer Tournament to everyone: 3-week leaderboard sprint, grade bands 3–4/5–6/7–8, weekly "boss week" themes. Winners earn a named spot on a permanent Founding Leaderboard + first-demo slot at the Fall Intensive (Nov 7–8). Ambassadors challenge classmates; parents share scores. Landing: /gauntlet with a parent-facing banner → join flow. Dev ticket: shareable score card image. | Kid word-of-mouth, ambassador shares, parent groups ("free math game a Toronto founder built") | +35 interested (105 cum.), 40 calls cum., first 15 deposits | **Gauntlet share card** (auto-generated score image) + tournament rules page + weekly leaderboard email |

### Phase 3 — SURGE (Weeks 5–6): go vertical on the five groups, then gather everyone

| Week | Primary push | Concrete actions | Channels | Targets | Asset the week needs |
|---|---|---|---|---|---|
| **W5** Aug 10–16 | **Five-group verticals** | One tailored outreach per group: **Scholars** → CEMC/Waterloo contest + Math Kangaroo parent communities and math-circle coaches; **Athletes** → rep/AAA team parent reps (GTHL, rep soccer, competitive swim); **Makers** → arts-program parent lists (RCM, youth film/maker camps); **Founders** → kid-entrepreneur fairs and DECA-adjacent parents; **Givers** → youth-volunteering orgs and faith/community groups. Ask coaches/organizers to forward, don't blast their lists (CASL: forwarding by the organizer is their consent relationship, not ours). | Coaches, program directors, contest-parent groups | +35 interested (140 cum.), 55 calls cum., 22 deposits cum. | **Five one-page group sheets** (same skeleton, one hero line each — e.g. "Train seriously, compete seriously, and think like a pro") |
| **W6** Aug 17–23 | **Info sessions week** | Two 45-min virtual info sessions (Tue eve, Sat morning): 15 min founder story → 15 min the year in detail (project → quarterlies → Nov 7–8 demo) → 15 min Q&A; end on refundable-deposit offer. One in-person Toronto meetup (park/rec-room, kids play the Gauntlet live on a projector, parents talk). Every RSVP = consented lead; every attendee gets a next-day recap + booking link. | Luma/Eventbrite, all prior channels invited, ambassadors bring one family each | +30 interested (170 cum.), 70 calls cum., 32 deposits cum. | **Info-session deck** (10 slides) + RSVP page + recap email |

### Phase 4 — LAND (Weeks 7–8): convert and hand off to September

| Week | Primary push | Concrete actions | Channels | Targets | Asset the week needs |
|---|---|---|---|---|---|
| **W7** Aug 24–30 | **Deposit push** | Back-to-school moment: "before the school year swallows you, reserve the seat — $250, fully refundable until Sept 30." 3-email sequence to all non-depositors (consented list only). Personally call every submitted-dossier family without a deposit. Publish live seat count in emails (it's truthful — use it). Founding-member cutoff: families deposited by Sept 1 are named the Founding 120 at the Fall Intensive (Nov 7–8). | Email sequence, personal calls, SMS only where expressly consented | +20 interested (190 cum.), 85 calls cum., **45 deposits cum.** | **Deposit-push sequence** (3 emails) + written deposit/refund terms page (roadmap S7 item — required before pushing hard) |
| **W8** Aug 31–Sep 4 | **September landing** (§5) | Nurture automation verified end-to-end; ambassador back-to-school kits delivered; waitlist copy ready; founder's calendar opened to 12 call slots/week; weekly-metrics dashboard (even a spreadsheet) reviewed. Send "the year begins" email: intensive #1 dates, what happens next. | Email, ambassadors in schools | 200+ interested, 48–55 deposits, 20+ calls pre-booked into September | **"The Year Ahead" email** + waitlist page copy |

**The constant weekly rhythm** (borrowed straight from founders.school's tighten-and-loosen cadence): Mon — pick the week's push, send the week's email. Tue–Thu — calls (2/day) + the push. Fri — metrics vs. §1 table, thank-yous, ambassador shout-outs. Never more than one primary push per week.

---

## 3. The Ambassador System (F1/F2 — grades 7/8)

Kids in grades 7–8 are the most networked members of the target population and the most credible voice to other kids. Recruited through the founder's own kids' circles, UTS-adjacent families, and friends-of-friends. **12–15 ambassadors, each bringing 3–5 genuinely interested families = 40–70 leads**, the single biggest organic channel in the plan.

**What ambassadors do**
- Challenge friends to the Gauntlet Tournament (their code on the share card).
- Bring one family to an info session or the August meetup.
- Give a 2-minute "why I'm in" at info sessions (kid voice sells better than any deck).
- Show off the Tin Can + Address Book to friends — the bat phone is a physical, enviable object.

**Incentives — recognition, never cash (ethics line: no per-signup payments to minors, no pressure quotas, everything opt-in with a parent's consent)**
- **Founding Ambassador** title: named in the Address Book, badge at the Fall Intensive (Nov 7–8).
- **Gauntlet glory:** permanent leaderboard flair + early access to new bosses (cheap dev ticket, huge to a 12-year-old).
- **Intensive perks:** first pick of demo slot, ambassador table at intensive #1.
- Milestone recognition (3 families joined → intensive shout-out), not per-head bounties.

**Parent-facing version:** parents of ambassadors get a plain-language note: what their kid is doing, why there's no money involved, opt out anytime. Referring **parents** get recognition as Founding Families + priority assessment scheduling — no fee kickbacks (keeps admissions integrity credible for a "selective" brand).

**Tracking:** referral code (`AMB-FIRSTNAME`) captured in the W1 "how did you hear" field → one Supabase column → weekly tally in the Friday review. No extra tooling.

**CASL safety:** ambassadors and their parents share person-to-person (personal-relationship territory, and the message is theirs, not the company's). The company only ever emails addresses with express opt-in from the join flow/RSVP. No harvesting contacts from ambassadors — leads must arrive by the family acting themselves (playing the Gauntlet, creating an account, RSVPing).

---

## 4. Spread-the-Word Ideas

| # | Idea | What it is | Effort | Impact |
|---|---|---|---|---|
| 1 | **Gauntlet Summer Tournament** | 3-week public leaderboard sprint on /gauntlet; weekly boss themes; winners on a permanent Founding Leaderboard + intensive demo slot. Kids recruit kids; parents see a serious math trainer, not a game. | Medium (share-card + rules page dev) | **High** — the only channel where the product markets itself to the actual member |
| 2 | **Ontario gifted-parent communities** | ABC Ontario chapters, gifted/IEP parent Facebook groups, r/askTO parenting threads. Value-first founder posts (real TimeBack data from /parents), PDF by DM. | **Low** | Medium-High — exactly the top-1–2% parent, already searching for this |
| 3 | **Math-contest ecosystem** | CEMC (Waterloo)/Math Kangaroo/Caribou parent circles and math-circle coaches; pitch the Gauntlet as free FastMath training, The 120 (Scholars) as the year-round home. | Medium | **High** — pre-qualified Scholars pipeline; contest parents pay for acceleration |
| 4 | **Rep-sports & arts verticals** | One parent-rep per rep hockey/soccer/swim team and one director per arts program gets the Athletes/Makers one-pager to forward. "Your kid trains like a pro at sport — The 120 is that, for everything else." | Medium | Medium — slower, but Athletes/Makers seats won't fill from math channels |
| 5 | **"120 Coffees"** | Founder does 3 coffees/week with Toronto connector-parents (school-council chairs, camp directors, coaches). Each coffee = ask for 2 introductions. 20+ coffees by Sept 1. | High (founder hours) | High — deposits at this price close on trust; connectors compound |

---

## 5. September Landing Plan

**Definition of done — all true on Sept 1:**
1. **200+ CASL-consented families** in the email system, tagged by stage (lead / account / dossier / deposit) and source.
2. **48+ deposits paid** (live Stripe, verified), live seat count showing ~58–65 remaining — real scarcity for the September push.
3. **Booking link with 12 slots/week open through October**, at least 20 September calls already booked from W6–W8 activity.
4. **Automated nurture running** so the calendar fills itself (see below).
5. **12–15 ambassadors back in school** with kits, codes, and a September Gauntlet season announced.
6. **Intensive #1 (Nov 7–8, 2026) sellable:** date + city confirmed in all copy, venue at least internally locked.
7. **Waitlist mechanics ready:** copy, form, and admin flow for the moment groups fill (Scholars will likely cap first).

**The automated nurture (the calendar-filling machine)** — every email ends with one CTA: book the call or finish the dossier.

| Trigger | Sequence |
|---|---|
| Account created | T+0 welcome ("your child's dossier is the application — start it") → T+2d dossier nudge → T+5d founder story → T+9d "book the 20-min call" |
| Dossier submitted | Instant confirmation + booking link → T+2d "what the review looks for" → T+5d personal-feeling founder note |
| Call held, no deposit | T+1d recap + deposit link ("refundable until Sept 30") → T+4d live seat count → T+10d final personal email |
| Deposit paid | Welcome to the Founding 120 → intensive #1 details → "know one more family?" referral note |
| Stalled 14 days at any stage | One re-engagement email, then monthly digest only |

September weeks then run themselves: Labour Day week = "school just reminded you why" email to all non-depositors; mid-September = last two weeks of refundability countdown (truthful — refund window closes Sept 30); evangelist parents (deposited families) each asked for one introduction.

---

## 6. Do This Monday (Jul 13)

- [ ] Create the Cal.com/Calendly booking link (roadmap T2, ~30 min) and set `NEXT_PUBLIC_BOOKING_URL` in Vercel — every Book-a-call button goes live at once.
- [ ] Make the Stripe go-live decision (S10 step 1: dedicated account vs. "THE120" descriptor on the existing one) and hand devs the go-live ticket.
- [ ] Sign up for Resend (or Customer.io), send yourself welcome email #1.
- [ ] File two dev tickets: (a) "how did you hear / referral code" field on account creation; (b) Gauntlet shareable score card.
- [ ] Write the 25-name warm list and send the first 5 personal messages before noon.
- [ ] Draft the one-page explainer PDF (steal copy from the live home + /tuition pages — it's already written).
- [ ] Text 3 families about their kid becoming a Founding Ambassador.
- [ ] Start S6: register the120.school + admissions@ mailbox (unblocks branded email and fixes signup-confirmation rate limits).

---

## 7. Open Questions for the Founder

1. **Dossier review ops:** who reviews, what's the SLA, and is the qualifying assessment ready to administer before deposits pile up? A 48-deposit pipeline with no assessment path is a refund machine.
2. **Group-level seat caps:** is it ~24 per group? Scholars will likely oversubscribe first — do surplus Scholars go to waitlist or get steered to another group?
3. **Founder hours:** the plan assumes ~20 GTM hours/week plus 10 calls/week through August. True? If not, cut W5's five-vertical week to the two strongest groups (Scholars + one other).
4. **Intensive #1 venue:** how confirmed is Nov 7–8, 2026? It is the closing argument in every call and email — "details on enrollment" gets weaker as September nears.
5. **$3,000 vs $15,000 on calls:** what share of calls should hear the Full Academic Core pitch? The plan sells Membership everywhere and lets the call up-sell — confirm that's still the play.
