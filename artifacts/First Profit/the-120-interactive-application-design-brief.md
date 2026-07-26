---
date: 2026-07-23
topic: the-120-interactive-application-design-brief
status: draft for review (rev 2 — Peter's 2026-07-23 changes applied; open questions resolved and removed)
source-of-truth: artifacts/First Profit/first-profit-app-design-brief.md (app mechanics, skins, verification); artifacts/First Profit/first-profit-home-study-curriculum-brief.md (the 125 unit tasks, pass criteria); app/lib/site.ts (tuition, seats, groups, dates)
audience: Claude Design (first pass — funnel screens, mini-app, reveal), then Claude Code CLI (build)
---

# Foundry — The 120 Interactive Application — Design Brief

**Applying to The 120 should feel like the first day of running a real business — not like filling out a form.**

The 120's website converts poorly to "Join The 120." This brief specifies the replacement: an interactive application process, modeled on applying to a competitive middle or high school, in which the family *does the first real work of the program* as part of applying. A parent starts the application; their kid (or kids — multiple children per family) designs a real business project inside it; the family sees exactly what the program will make of that project; and the application, deposit, and tuition are gates on a ladder the family is already climbing.

This is not a demo bolted onto a funnel. The funnel *is* the product's front door: it lives at **the120.school/foundry** and feeds directly into the real app — working name **Foundry** (Section 6) — which becomes progressively gated. Nothing done during the application is throwaway — the project created while applying is the project the student runs all year. **This flow completely supersedes the current "Join The 120" link and process** — but it *includes* the existing application process (the dashboard wizard) as its final stretch; the new flow simply puts more application in front of it.

## Decisions Log

These decisions were made with Peter on 2026-07-22 and revised 2026-07-23; all previously open questions are resolved and folded in. Downstream tools (Claude Design, Claude Code) should treat them as settled. Where a decision here conflicts with an assumption in First Profit app brief, this document wins for the application flow; First Profit app brief still governs in-program mechanics.

| # | Decision |
|---|---|
| A1 | **The frame is a school application.** The whole flow is an interactive application to The 120, structured like applying to a competitive middle/high school. The parent drives the process from the landing page until the $250 fully refundable deposit is paid. Only after deposit does the student get their own account, connected to their own email, with their own login. Families who stall or never deposit are treated exactly as a competitive school treats applicants: everything stays on file — they may apply later, and staff can re-engage them. |
| A2 | **Parent is the account owner pre-deposit.** During the application (including the project mini-app), the parent controls the session. The parent brings the kid in — to help (earlier grades) or to answer fully in their own words (later grades). The UI designs these "bring in your kid" moments explicitly. |
| A3 | **Funnel shape:** landing page (inbound marketing only) → CTA → 3-step "what's about to happen" explainer → parent first name + last name + email capture → **Add a Child** (one or more children; more can be added at any time, mirroring the current Join The 120 flow) → per child: project mini-app (group pick → starter template or own idea → guided quiz → AI-shaped project) → first 3 criteria shown (read-only) → the Reveal + Apply screen (mock of Sell complete + plan forward + Apply button + FAQ accordion, closed by default) → submit application (Gate 1). All "Join The 120" CTAs and every other CTA site-wide point at the **3-step explainer**, not the landing page. |
| A4 | **Gate ladder (per child):** Free = project creation + read-only view of the first 3 criteria + the Reveal. Application submitted = real task work begins, with the full verification mechanic live from task 1. Gate 2 fires when task **1.2.1 (Choose the offer and set the price)** is verified. Deposit ($250, fully refundable) = student account + email created; work continues. Calendar gate: post-deposit families can keep working until **Sept 30, 2026** — the same date as the deposit refund deadline, deliberately aligned; full tuition paid = the whole app, forever. |
| A5 | **The deposit CTA promise:** "Sign up to The 120 and we'll help you get to **$10K in profit** — or a goal you set." Profit, not sales/revenue. The $10K is aspirational and the timeline is **open-ended**: some founders hit it in 90 days; younger or less-engaged kids may take much longer. The goal doesn't expire, and gate copy says so. |
| A6 | **Verification is real from the first task.** Pre-deposit tasks are verified by the parent exactly as in-program tasks are — the core loop is itself the product demo. No self-marking, no soft-verify tier. |
| A7 | **Project creation:** the kid picks one of the five groups (Athletes, Founders, Givers, Makers, Scholars) → **step 1a: choose a starter template or write your own** (two curated, prewritten templates per group + a third "my own idea" box; template copy ships in this brief, §8.2, AI-drafted and refined with Claude Design) → a group-specific guided quiz → an AI call shapes the answers into a well-structured project description. A student can hold **up to 5 projects**, switch between them, abandon and revive them; the UI states clearly and early that the project can be changed at any time. |
| A8 | **The Reveal and Apply are one screen.** After project creation the app fast-forwards — the student's own project shown with Phase 01 · SELL complete (crests, stats, filled Founder File) — then rewinds to the plan forward. On the same screen: the **Apply** button, and an **FAQ accordion (closed by default)** carrying the "what you're joining" content (The 120 itself, tuition, the ask). The family has already *seen* how it works by doing it; the accordion serves the ones who want detail. There is no separate How It Works page. |
| A9 | **Skin:** each child's age is asked at Add a Child (it feeds the application anyway); default skin by band exactly as the app does (Grades 3–5 → Trail; 6–8 and 9–12 → HQ). |
| A10 | **Landing promise register: "Your kid, transformed."** The headline speaks to the parent about who their child becomes — confident, unafraid of "no," money-literate. The business is the vehicle; the kid is the product. The landing page exists **only for inbound marketing** (ads, QR, press); internal site traffic never routes through it. |
| A11 | **The "what you're joining" content** (The 120 itself — 5 phases, 25 criteria, 125 unit tasks, 119 other kids, the network; tuition with real numbers; the ask) lives in the Reveal screen's FAQ accordion (A8), not on its own page. |
| A12 | **Conversion is four-tier**, each instrumented as a named conversion: (1) **parent first + last name and email captured** (soft), (2) **application submitted**, (3) **deposit made**, (4) **tuition paid.** |
| A13 | **Traffic:** Meta/Instagram ads, Google search ads, ambassadors/word-of-mouth, and organic/local (QR, press, SEO) all land on the landing page; everything else on the site lands on the explainer. Mobile-first is mandatory; the whole flow must work one-handed on a phone. |
| A14 | **Placement:** everything lives under the existing site at **the120.school/foundry** — landing page, explainer, and the gated app. No separate domain for now. |
| A15 | **The name is Foundry (working name, adopted now).** Rendered with the same visual logo as First Profit but with different letters — the wordmark's visual system carries over, only the letterforms change. Trademark/domain checks remain to be done before any external brand push; Sellcraft and Ascent are the held-in-reserve alternates. The name covers the whole Sell → Build → Validate → Grow → Scale process of learning to build a profit-generating business the kid owns and has agency over. |
| A16 | **Child email at application; school email at deposit.** The application asks for the child's email address, with a **"Don't have one"** option. If chosen, The 120 creates a unique **@the120.school** address upon deposit receipt, and emails the parent the student's login email and password. The password for all such created accounts is **"iloveschool"** and is included in that email. (Build recommendation, not a gate: force a password change on the student's first login.) |
| A17 | **The CRM sees everything, live.** Application progress maps to granular CRM stages so staff can spot exactly where a family is stuck and help. The child's quiz and project answers fill their CRM dossier **in real time**, so staff can see what each student created before any parent conversation. |

---

# PART ONE — VISION & EXPERIENCE

## 1. The Problem and the Bet

The current site asks a cold visitor to "Join The 120" on the strength of copy. The bet of this flow: **families convert when the kid has already started.** A parent who has watched their child design a real business in ten minutes — and seen a credible picture of that same child, months later, having sold to real strangers for real money — is no longer evaluating a program. They are deciding whether to interrupt something that has already begun.

The school-application frame does three jobs at once. It sets the register (this is an admissions process with standards, not a SaaS signup); it puts the parent in their natural role (parents apply to schools *for* their children — the flow never pretends otherwise, and like any school application it may cover several children at once); and it makes each gate legible (application → deposit → tuition is exactly the ladder every competitive school uses, so no gate feels like a paywall trick).

## 2. The Funnel at a Glance

```
 STAGE 1              STAGE 2                          STAGE 3                STAGE 4
 Landing         →    Start Building           →       Project mini-app  →    The Reveal + Apply
 the120.school/       3-step explainer                 (run per child)        Sell complete (mock)
 foundry              parent first + last name         group → template       + the plan forward
 inbound mktg         + email [CONVERSION 1]           or own idea →          + APPLY button
 only                 → ADD A CHILD (1 or more,        quiz → AI project      + FAQ accordion
                        age/grade per child)           first 3 criteria       (closed by default)
                                                       (read-only)

 STAGE 5 — THE LADDER (per child)
 Application submitted — includes the child's project  [CONVERSION 2]
   → real task work, full verification from task 1
   → 1.2.1 verified (GATE 2) → $250 refundable deposit [CONVERSION 3]
   → student account + email created
   → Sept 30, 2026 calendar gate → tuition paid [CONVERSION 4] → everything, forever
```

One continuous surface. Stage 1 is for inbound marketing only; every CTA elsewhere on the120.school — including the old "Join The 120" links — points straight at the Stage 2 explainer. From Stage 3 on, the family is inside the real app in "application mode." A family with several children runs Stage 3–5 once per child under one parent account; there is no separate throwaway mini-app to build and later discard.

## 3. The People

**The parent** is the driver from first click to deposit (A1, A2). Every navigational decision, every gate, every payment is theirs. The flow speaks to them in the register of a serious school: warm, plain, confident, zero cheerleading. They are never asked to pretend the app is for them — their job is to add their children, bring each one in at the right moments, and verify real work exactly as the program will ask of them all year (A6).

**The kid** is the founder. The flow stages their entrances deliberately: the project quiz addresses the kid directly ("hand the device over" copy for older grades; "do this together" copy for earlier grades, per A2). The work — choosing a group, picking or writing a starter idea, answering the quiz, later doing tasks — is theirs. The dramatic engine of the whole funnel is the parent watching the kid take it seriously. Siblings each get their own run: own group, own project, own ladder.

**The age bands** are asked per child at Add a Child (A9): band sets the skin (Trail for 3–5, HQ for 6–8/9–12), the quiz voice, and the displayed task variants — identical to the in-program model, because from Stage 3 onward this *is* the program's software.

## 4. Stage by Stage

### Stage 1 — The Landing Page (inbound marketing only)

**Job:** earn one tap from four very different traffic temperatures (A13) with one promise (A10). This page exists solely for inbound marketing — ads, QR codes, press, search. Nothing internal links to it; it has one exit, forward.

The page leads with transformation, not features: who the child becomes. The hero is a full-bleed photo treated with the site's existing gradient system. Candidate headline lines for Claude Design to explore (final copy is Peter's call):

- *"Send us a kid. Get back a founder."*
- *"Confident. Money-smart. Unafraid of no. That kid."*
- *"Your kid will build a real business this year. We'll show you how right now."*

Below the fold, in order: the three-beat proof strip (real customers · real money · verified by real adults — no simulations, no pretend points); a glimpse of the Reveal artifact (a crest-and-stats card, the shareable unit of the whole program); one line of what The 120 is; and the CTA repeated. The page is short. Its entire job is the button, which routes to the Stage 2 explainer: *"Start Your Application — your kid designs their business in the first 10 minutes."* Scarcity stays truthful per the site's existing rule: the live seats-remaining line renders here from the single source of truth.

**Hero image — AI generation prompt (Nano Banana Pro).** Send this prompt as-is; request the listed variants and pick against the gradient treatment:

> Editorial documentary photograph, golden-hour light: a 10-year-old kid standing tall behind a handmade neighborhood market stand, mid-pitch, handing a small product to a smiling adult customer, while a parent watches proudly from one step behind. A cash box and a hand-lettered price sign sit on the table. Tree-lined Toronto residential street, warm summer evening, shallow depth of field, shot on 35mm film, natural skin tones, confident posture, genuine candid expressions. Keep the upper third and lower quarter of the frame compositionally quiet (soft sky and bokeh) for headline overlay. No visible brand logos, no text anywhere in the image, no watermarks. 16:9, high resolution, photorealistic.

> **Variants to request:** girl and boy versions; a range of ethnicities; a winter version (hot-chocolate stand, toques, breath in the air — this is Toronto); a door-to-door version (kid mid-ask at a neighbour's front door, parent at the sidewalk). Every variant must survive the site's dark gradient overlay at top and bottom and keep faces out of the darkest zones.

### Stage 2 — Start Building: the Explainer, the Email, the Children

Tapping any CTA — from the landing page or from anywhere on the120.school — opens the 3-step "here's what's about to happen" sequence (A3), three swipes, one idea each:

1. **Your child designs a real business.** A guided 10-minute project builder. You can do it together, or hand them the device.
2. **You'll see exactly where it leads.** We'll show you their first phase complete — and every step between here and there.
3. **This is the application.** What your child builds today carries into the program. Nothing is throwaway.

Then the capture: **parent first name, last name, and email** (Conversion 1, A12), framed as opening the family's application file. School-application register throughout: this is enrollment paperwork made pleasant, not a newsletter signup.

**Then — Add a Child.** The parent adds one or more children: first name, age/grade (drives band and skin, A9), and optionally which child goes first. The pattern mirrors the current Join The 120 application flow's add-a-child step; more children can be added at any point later. Each child gets their own project run and their own ladder; the parent account holds them all. The email capture feeds the CRM from minute one (§11), so a family that stops here is not lost — and per A1, is kept on file like any school applicant.

### Stage 3 — The Project Mini-App (run per child)

**Job:** produce a real, structured, owned project in ~10 minutes, with the kid's hands on it. This is the heart of the funnel and the first screen of the actual product.

**Step 1 — Pick your group.** The five groups, rendered as five doors: Athletes, Founders, Givers, Makers, Scholars (copy adapted from the site's existing group definitions).

**Step 1a — Pick a starting template, or write your own.** Behind each door: **two curated, prewritten starter templates plus a third open box — "I've got my own idea."** The templates (full copy in §8.2) are concrete and vivid so no kid faces a blank page; the open box feeds the same quiz with freeform seed text. The AI drafted these templates and Claude Design refines their presentation.

**Step 2 — The guided quiz.** Group-specific, 4–6 playful questions, addressed to the kid (A2 staging: a "bring in your founder" interstitial invites the handoff, with a parent-assist mode for grades 3–5). The quiz gathers: what they love doing, what they could make/do/sell, who they imagine as their first customer, and (9–12) what they'd want to be known for. A chosen template pre-seeds the answers; the kid edits rather than starts cold. Tone follows the band: Trail register for 3–5, HQ register for 6–12.

**Step 3 — AI shapes the project.** The answers go to an AI call (§8.3) that returns a structured project: a name, a one-paragraph description, the offer sketch, the first customer hypothesis, and the group tag. The kid sees it composed live — their words becoming a company page. Two controls always visible: **"Change anything"** (edit any field) and **"Start over."**

**The flexibility promise renders on this screen in plain words (A7):** *"This project is yours. You can change it any time — and you can hold up to five. Founders pivot. That's normal here."*

**Step 4 — The first three criteria, read-only.** The project page shows the opening of the journey: criteria 1.1 (pitch to a non-family adult), 1.2 (make a real sale), 1.3 (hear three no's) rendered in the student's skin — visible, concrete, and locked, with honest lock copy: *"Work begins once your application is in."* No task can be opened or worked before Gate 1 (A4). The locked state must read as anticipation, not paywall: the mist-before-the-trail (Trail) / the pending rows of a real plan (HQ).

### Stage 4 — The Reveal + Apply (one screen)

**Job:** show the family the end state of Phase 01 for *their* project, hand them the map from here to there, and take the application — all without leaving the page (A8). The family has already seen how it works by *doing* it; this screen closes.

**Movement 1 — the fast-forward.** "This is [child's name], a few months from now." The app renders the student's own project with Phase 01 · SELL complete, in their skin: five crests earned, the Founder File filling with representative evidence slots, and the stats told in the curriculum's real numbers — *a stranger said yes · real money in hand · 25 asks made · 3 no's, each one logged and learned from · cost, price, and profit explained on one page.* Every stat maps to an actual pass criterion; the mock invents nothing the program doesn't demand. It is unmistakably labeled as a projection — *"Here's what done looks like"* — never as achieved fact. A share-card of this screen (project name + crests + the stat strip) is generated for the parent; it is the funnel's most shareable artifact and the ambassador channel's fuel.

**Movement 2 — the rewind.** The screen pulls back to today: the full trail/ledger from the current position to Sell complete, first milestone glowing — with the project-creation step already stamped done, because it is. The copy carries the whole thesis in one line: *"Between today and that screen: 25 real steps. First one's done. The next one opens when your application is in."*

**The Apply button** sits directly under the rewind — the primary action of the screen and of the whole funnel: *"If this is for you, please apply."*

**The FAQ accordion — closed by default** — sits below the button and carries the "what you're joining" content (A11) for families who want detail before committing. Sections, each one accordion row:

1. **What is The 120?** Working copy direction from Peter, to be polished: *The 120 is a place where you work through 5 phases, 25 criteria, and 125 unit tasks to learn how to build your business. You've seen what it's like to design a project that's custom to you. Now it's up to you to work through the 125 steps to get it to $10K in profit — or a goal of your choosing. Along the way you'll meet 119 other motivated, engaged kids, make awesome friends, and make progress down a path they don't cover in school.* Plus the mechanics that make it credible: parent-verified evidence, no partial credit, the five groups, Toronto intensives.
2. **What does it cost?** The real numbers from the single source of truth ($3,000 membership / $15,000 full core), the $250 fully refundable deposit, and the Sept 30, 2026 refund deadline. Price transparency here is the school register; hiding it is the SaaS register.
3. **What happens after I apply?** The gate ladder rendered honestly — what's free, what the application unlocks, what deposit unlocks, what tuition includes (A4) — so no family ever feels ambushed by a gate.
4. **How long until $10K?** Honest, per A5: the goal is aspirational and open-ended. Some founders hit it in 90 days; others take a year or more. The goal doesn't expire.

### Stage 5 — The Application, and the Ladder Beyond

**Gate 1 — the application.** Parent-completed (A1), one per child. **This flow supersedes the current "Join The 120" process but contains it:** the application here *is* the existing dashboard wizard's application (basics, academics, group, project, workshops, review) — reached with most of it already done. The group step is pre-answered by the door the kid chose; the **project step is pre-filled with the actual project the kid built in the mini-app — the child's work is submitted as part of the application itself.** That is the trick of the whole flow: the hard part of the application already happened, pleasantly, and what admissions receives is not a form but a project.

The application also asks for **the child's email address, with a "Don't have one" option** (A16). If the parent selects "Don't have one," the system will create a unique @the120.school address for the child upon deposit receipt (see below).

Submitting is **Conversion 2** (A12) and unlocks real work.

**The working stretch.** Tasks open in curriculum order with the full verification mechanic from task 1 (A6): kid does, parent verifies against the *Done when* line. This stretch is deliberately the product demo — by the deposit decision, the parent has verified real work several times and the kid has real wins: a project, a product, an offer, a price.

**Gate 2 — the deposit ask.** Fires when 1.2.1 is verified (A4). Full-screen moment addressed to both: the wins so far listed as facts, then the promise (A5): *"Sign up to The 120 and we'll help you get to $10K in profit — or a goal you set."* Goal-setting input renders right on this screen, and the timeline copy is honest: the goal is open-ended — 90 days for some, longer for others, and it doesn't expire. The $250 deposit is **Conversion 3**, fully refundable until Sept 30, 2026, and says so at the point of ask.

**After deposit — the student arrives.** The account model flips (A1): the student gets their own login, connected to their own email — designed as a ceremony, not a settings screen. This is the acceptance-letter moment of the school metaphor: *"[Name], you're in. This account is yours."* If the family chose "Don't have one" at application, deposit receipt triggers creation of the child's unique **@the120.school** email address, and an automated email goes to the parent containing the student's login email and password — the password is **"iloveschool"** for all such accounts and is stated in the email (A16; build recommendation: force a change on first login). The kid now drives their own Foundry; the parent moves to the verifier/dashboard role First Profit app brief already specifies. Work continues freely until **Sept 30, 2026** (A4). Tuition paid — **Conversion 4** — lifts the calendar gate forever.

## 5. The Gate Ladder (canonical, per child)

| Rung | Who's driving | What's open | What's shown-but-locked | The ask on screen |
|---|---|---|---|---|
| Free | Parent (kid invited in) | Project creation (up to 5 projects per child), the Reveal + Apply screen | First 3 criteria, all tasks | Submit the application |
| Applied (Gate 1 passed) | Parent | Real task work, full verification, through 1.2.1 | Everything past 1.2.1 | — (work) |
| 1.2.1 verified (Gate 2) | Parent | — (work pauses at the gate) | The rest of the journey | $250 refundable deposit + $10K-profit/own-goal promise |
| Deposit paid | **Student** (own login + email) | Continued work, all app features | Nothing (calendar limit only) | Full tuition before Sept 30, 2026 |
| Tuition paid | Student | Everything, forever | — | — |

## 6. The Name: Foundry

**Decision (A15): the software is named Foundry, effective now as the working name.** It replaces "First Profit" for this product: the whole Sell → Build → Validate → Grow → Scale process of learning to build a profit-generating business the kid owns and has agency over. Foundry carries the right register — where founders are forged; institutional weight beside The Gauntlet; kid-sayable and parent-proud.

**Wordmark:** the same visual logo system as First Profit — same lockup construction, same treatment — with different letters. Claude Design's task is a letterform swap within the existing visual logic, not a new identity.

**Route:** the120.school/foundry (A14). No separate domain for now; everything lives under the existing site.

**Held in reserve:** Sellcraft (invented register) and Ascent (journey register) remain the tested alternates if trademark/domain diligence — still to be done before any external brand push — knocks Foundry out. The skins' working names (Trail, HQ) survive in any case.

---

# PART TWO — BUILD SPEC

*For Claude Design: Part Two constrains the screens — read for structure, states, and roles. For Claude Code: this is the implementation contract. Where the two parts conflict, Part Two wins on behavior, Part One on tone.*

## 7. Architecture & Placement

- **Everything under the120.school/foundry** (A14): the landing page, the 3-step explainer, the capture + Add a Child steps, and the gated app all live in the existing Next.js site. The landing page is reachable only by inbound marketing URLs; internal navigation never links to it.
- **CTA rewiring:** every "Join The 120" CTA and every other conversion CTA across the120.school points at the **3-step explainer** (Stage 2), not the landing page. The old Join The 120 process is retired as an entry point; its application wizard survives as the tail of this flow (Stage 5).
- **The app in application mode (Stages 3–5):** the existing app codebase (`app/path/*`, to be renamed with the product) gains an `application` context: parent-owned account, multiple child applicants, no student login until deposit, gate enforcement per §10. This reuses the app's existing content package, skins, task surfaces, and verification actions — the funnel must not fork the product.
- **The 2026-27 page and groups pages** remain as depth for Google-intent traffic; their CTAs converge on the explainer too.

## 8. Children, Projects, Templates & the Quiz

### 8.1 Data objects

```
Application    id, parent{firstName, lastName, email}, createdAt, source(UTM)
Applicant      id, applicationId, childFirstName, band: g3_5|g6_8|g9_12, age/grade,
               childEmail | needsSchoolEmail: bool, state (§10), skin (band default)
Project        id, applicantId, groupTag: athletes|founders|givers|makers|scholars,
               name, description, offerSketch, firstCustomerHypothesis,
               status: active|paused|abandoned, createdVia: template|own_idea|revival,
               templateId?, quizAnswers[], aiGenerationMeta{model, promptVersion, editedByFamily: bool},
               createdAt, lastActiveAt
```

- One Application per family; **one or more Applicants** (children), addable at any time (A3). Each Applicant has their own projects, own gate state, own ladder.
- Up to **5 projects** per child (A7); exactly one `active` at a time; switching is instant; `abandoned` projects can be revived.
- **Task progress is tied to the project, not the student** (Peter, 2026-07-23): each project carries its own task states, so a brand-new project starts with all steps blank. The **student's credential ledger is derived**: a step counts as complete-and-verified for the student if it was verified in *any* of their projects — they did it at some point in time, and a pivot never costs verified progress. A student *may* backfill steps in a new project (redo the one-liner for the new idea, re-rehearse the pitch) when it helps them move forward — backfilling is always allowed, never required, and re-verification in the new project updates that project's ledger without touching the old one.

### 8.2 The starter templates (step 1a) — shipping copy

Two curated templates per group plus the open box. This copy is the v1 content (AI-drafted per A7; Claude Design refines presentation, Peter approves final wording). Each template pre-seeds the quiz; the kid customizes from there.

| Group | Template | Kid-facing pitch | First customers |
|---|---|---|---|
| Athletes | **The Sponsorship Deal** | Get real businesses to sponsor your season. You pitch, they pay, you deliver: their logo on your gear, shout-outs, and a season report they'll be proud to show. | Businesses your family already buys from |
| Athletes | **The Skills Clinic** | Run paid mini-clinics teaching younger kids your sport. You design the drills, book the space, coach the session, and get paid to be good at what you love. | Teammates' younger siblings |
| Founders | **The Market Stand** | Make something people love — bracelets, baked goods, hot chocolate — and sell it at markets, games, and doorsteps for real money. | Your neighbours |
| Founders | **The Neighbourhood Service** | Dog walking, car washing, lawn and leaves, tech help for grandparents. Customers who come back every week — that's the secret. | Three houses on your street |
| Givers | **The Cause Company** | Sell a real product where the profits fund a cause you choose — and every customer knows exactly what their money does. | People who care about your cause |
| Givers | **The Benefit Event** | Plan and run a ticketed event — a tournament, a concert, a bake-off — where the profits go to your cause and the whole neighbourhood shows up. | Local businesses as sponsors, families as ticket-buyers |
| Makers | **The Commission Shop** | Take paid commissions for what you already make: portraits, custom builds, beats, edits. Real briefs, real deadlines, real money. | Friends of your parents |
| Makers | **The Digital Studio** | Sell your creations at scale: sticker packs, prints, a zine, a beat tape. Make it once, sell it many times. | Your school and team community (parent-approved channels) |
| Scholars | **The Research Grant** | Pick a real research question and raise the funding to run the study — micro-grants from local organizations, businesses, and family friends who back your proposal. | Local organizations and family friends who fund curious kids |
| Scholars | **The Scholarship Fund** | Build a fund that awards a scholarship you created: raise the donations, set the criteria, and hand it to a winner in public. | Donors in your community who believe in students |
| All | **My own idea** | Got something else burning? Tell us in your own words — we'll help you shape it into a real project. | — |

### 8.3 The quiz and AI project generation

- **Quiz spec:** one question set per group, 4–6 questions, each with band-variant phrasing (3–5 / 6–8 / 9–12). Questions produce structured fields, not free chat. A chosen template pre-fills draft answers the kid edits. Content ships in the versioned content package alongside the 125 tasks, not in code.
- **AI project generation:** one API call, server-side. Input: group, band, template (if any), quiz answers (or own-idea freeform text). Output (JSON, validated): name (≤5 words), description (≤120 words, second person, band register), offerSketch, firstCustomerHypothesis. Guardrails: no promised outcomes, no invented facts about the kid, safety flags honored (no real names/addresses in the description), profanity/brand-name filtering on the kid's inputs. Every field editable by the family afterward (`editedByFamily`). Regeneration allowed twice per quiz run.

## 9. The Reveal + Apply Screen

- **Movement 1 (mock)** is assembled from the content package, not free-generated: the five Sell criteria and their real pass-bar numbers, skinned crest assets, and slot-machine evidence placeholders. The only AI-generated text is a 2–3 sentence project-specific framing line per criterion ("Your bracelet stand's first stranger-yes…"), produced in the same call as §8.3 or a follow-up call, cached on the project.
- **Never present the mock as fact.** Fixed label copy: "Here's what done looks like." The stat strip may only cite numbers that are actual pass criteria (25 attempts, 3 no's, real money in hand, one-page profit math, pitch without notes).
- **Share card:** static image render (project name, crests, stat strip, Foundry wordmark), downloadable/shareable by the parent only — consistent with the app's nothing-is-public rule.
- **Movement 2 (plan)** renders the real Phase 01 structure from the content package in the student's skin, with project-creation stamped complete and Gate 1 state on everything else.
- **Apply button + FAQ accordion** render on the same route (A8): the accordion's four sections (§4, Stage 4) ship as content-package copy; all rows closed by default; opening a row emits an instrumentation event (§12) so we learn which questions families actually need answered before applying.

## 10. Gates & Permissions

```
applicant_state (per child):
  added              → child exists under the application (Stage 2 complete for this child)
  project_created    → ≥1 Project exists; Reveal+Apply available; tasks visible, locked
  submitted          → Gate 1 passed; tasks 1.1.1+ workable, full verification live
  deposit_due        → task 1.2.1 verified; further task opens blocked; Gate 2 screen active
  deposited          → $250 paid; student account + email provisioned; work resumes
  enrolled           → tuition paid; no gates
calendar_gate:        deposited && !enrolled && date > 2026-09-30 → work pauses (read/export never pauses)
```

- Gate checks live server-side in the existing transition/access-rules layer (`path/lib/access-rules.ts`, `transition-table.ts`) — a gate is a state consult, not scattered UI conditionals. States are per-Applicant; the parent account holds N children at N different rungs.
- **Gate 2 precision:** fires on *verification* of 1.2.1 (parent-verified, per A6), not on submission. Tasks already `in_progress` elsewhere in criteria 1.1/1.3 may finish verification, but no new task opens past the gate. (Criteria run parallel within a phase, so the gate must be a global "no new opens," not a 1.2-only lock.)
- **Deposit/tuition payments** ride the existing Stripe rails (`api/checkout`, `api/stripe/webhook`). The calendar gate and the deposit refund deadline are **the same date — Sept 30, 2026** — stored once in `lib/site.ts` (the existing `DEPOSIT_REFUND_DEADLINE_LABEL` constant becomes the single source for both).
- **Student provisioning at deposit** reuses the existing invite/provision actions (`path/lib/actions/invite.ts`, `provision.ts`): deposit webhook triggers provisioning; child's email from the application attaches, or — if `needsSchoolEmail` — a unique @the120.school mailbox is created (Workspace/mail-provider integration), password set to "iloveschool", and the parent notification email (containing login email + password) is sent via the existing email rails. Recommendation: flag these accounts for forced password change at first student login. History transfers intact: everything done pre-deposit was recorded against the Applicant and now belongs to the student.
- **Never-deposited families** are never reaped: the evidence reaper (`path-evidence-reaper`) exempts application-context records. Per A1, applications stay on file indefinitely for re-engagement and later application cycles.

## 11. CRM, Email & Nurture

- Stage 2 capture (first name, last name, email) posts to the existing lead-ingest (`crm/lib/lead-ingest.ts`) with source attribution (§12) — every funnel entrant is a CRM lead from minute one.
- **Granular pipeline stages (A17):** the CRM pipeline maps 1:1 onto the funnel's fine-grained states so staff can see exactly where each family is and intervene when they're stuck. Minimum stage set per family/child: `email_captured → child_added → quiz_started → project_created → reveal_viewed → application_started → application_submitted → first_task_verified → gate2_reached → deposit_paid → enrolled`, each stamped with time-in-stage so the sprint queue can surface stalls (e.g., "project created 6 days ago, application never started").
- **Live dossiers (A17):** as a child moves through the quiz and project creation, their answers and the AI-shaped project stream into their CRM dossier in real time (the existing dossier system — `crm/(app)/dossiers`, `DossierEditor` — gains an application-sourced section). Before any parent call, staff see what the kid actually built: group, template chosen, quiz answers, project name and description, tasks verified so far. The child's own work informs every conversation.
- Nurture (existing `lib/nurture`) gets funnel-aware sequences keyed to the abandonment point: captured-but-no-child, child-but-no-project, project-but-no-application, applied-but-stalled-before-1.2.1, deposit-due-but-unpaid. Each email deep-links back to the exact resume point. The kid's project name appears in every nurture subject line — it is the family's own hook.

## 12. Instrumentation

Every stage boundary is an event with a shared schema (`event, applicationId, applicantId?, source, band, group, ts`):

`landing_view → explainer_start → email_captured → child_added → quiz_start → project_created → reveal_viewed → plan_viewed → faq_opened(section) → application_started → application_submitted → first_task_verified → gate2_reached → deposit_paid → student_account_created → school_email_created → tuition_paid`

plus `project_regenerated`, `project_switched`, `share_card_created`, `nurture_resume`. The four conversions (A12) — `email_captured`, `application_submitted`, `deposit_paid`, `tuition_paid` — are first-class named conversions in analytics. Source attribution (UTM → the four channels of A13) persists from first touch to tuition so channel-level CAC is readable at every tier off one funnel table. The success question this build answers — *what does it take to get an application, a deposit, an enrollment?* — must be answerable from this event stream alone, per channel, per band, per group.

## 13. Copy Registers

Three voices, strictly assigned: **school-application register** (parent-facing: landing, explainer, capture, Add a Child, FAQ accordion, gates, payments — plain, warm, confident, price-transparent, zero cheerleading); **band register** (kid-facing: templates, quiz, project page, reveal, tasks — Trail voice for 3–5, HQ voice for 6–12, exactly as First Profit app brief defines); **the handoff seams** (the "bring in your founder" interstitials that pass the device between them — these are the funnel's signature copy moments and deserve real craft).

## 14. Non-Goals (v1)

No freeform-only project creation without the quiz spine (the own-idea box feeds the quiz, it doesn't skip it); no public sharing of anything; no separate demo/sandbox app; no discounting mechanics at gates; no AI that verifies or grades (the app's hard rule holds everywhere); no deletion of stalled applications (school-file rule, A1).

## 15. Handoff Notes

**To Claude Design (first):** design the spine in this order — (1) the Reveal + Apply screen (both movements, Apply button, FAQ accordion, both skins): it is the emotional benchmark and now also the closing surface; (2) the project mini-app including the group doors, the step-1a template cards (§8.2 copy) with the own-idea box, the quiz, the AI-composition moment, and the "bring in your founder" handoff interstitials; (3) the Add a Child step and the multi-child parent home; (4) the Gate 2 deposit ceremony and the post-deposit "this account is yours" student-arrival moment (including the school-email variant); (5) landing + explainer + capture, with hero art generated from the §4 Stage 1 prompt. Also: the Foundry wordmark as a letterform swap on First Profit's existing visual logo. Mobile-first throughout (A13). The gate ladder must always read as a school's admissions ladder, never as a paywall.

**To Claude Code CLI (second):** build order — application context (Application/Applicant model, multi-child) + gate state machine on the existing access-rules layer (§10) → capture + Add a Child + lead-ingest wiring (§11) → project object with per-project task state + derived student credential ledger (§8.1) → templates + quiz + AI generation (§8.2–8.3) → Reveal + Apply screen assembly (§9) → application form reusing the existing wizard with pre-filled group/project and child-email step → Stripe deposit + student provisioning + school-email creation and parent credentials email (§10) → CRM stages + live dossier streaming (§11) → instrumentation (§12) → nurture sequences. Reuse the app's content package, skins, and verification actions wholesale; the funnel forks nothing. CTA rewiring across the site (every CTA → the explainer) ships with the first release.

**The one-sentence test for every decision in this flow:** does this make the family feel they are *already inside a serious school that has already started teaching their kid* — and would stopping now mean taking something real away from their child? If not, it doesn't belong in the application.
