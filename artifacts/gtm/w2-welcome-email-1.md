# Week-2 GTM Asset — Welcome Email #1 (account created, T+0)

*Sprint §5 nurture: `Account created → T+0 welcome ("your child's dossier is the application — start it")`. This is the first email the machine sends the moment a parent creates an account. Turns the nurture engine on. Send provider: Resend. Written to feel founder-personal (from Peter) but runs automated.*

**Status:** ready to load into Resend. Swap the merge fields, confirm the sender + links, send yourself a test, then set the trigger to fire on account-created.

---

## Setup (confirm before first send)

| Field | Value |
|---|---|
| From name | Peter Kuperman — The 120 |
| From address | peter@the120.school (reply-to: admissions@the120.school) |
| Trigger | Fires once, immediately on account creation |
| Merge fields | `{{parent_first}}` (from signup). **Do NOT** reference the child by name — the dossier isn't built yet, so no child name exists at T+0. |
| Links | Join The 120: `https://the120.school/` · Dossier/dashboard: `https://the120.school/dashboard` · Book a call: `cal.com/peter.k/the120` · One-pager: attach or link the finalized PDF |

---

## Subject line

Welcome to The 120 — here's your first step

**Preheader:** The 120 is a network for kids with top 1% academics and building your business. Applying takes about 5 minutes.

---

## Body (HTML-ready copy)

Hi {{parent_first}},

Welcome to **The 120.** What is it?

[bullet] 120 motivated and engaged kids
[bullet] Two age cohorts, Ages 8–13 and 14-17
[bullet] Five groups: Athletes, Founders, Makers, Scholars, and Givers.

As a child, you:
[bullet] Build your business (more on that later)
[bullet] Get Top 1% academics
[bullet] Find a group of motivated and awesome friends 

The Commitment:
[bullet] 20 in-person workshops over a year, approx. every 2 weeks
[bullet] 3-5 hours a week work to be done between workshops
[bullet] Work on general math skills, 2X - 4X faster than regular school
(Math can be Catch Up, Reach Ahead or Get Solid)

Your business:
[bullet] Athletes build their NIL.
[bullet] Founders build a company.
[bullet] Makers build music shows or gallery exhibits.
[bullet] Scholars build a research lab.
[bullet] Givers build a community service org.

The 120 gives you what you don't get in school:

The ability to build something cool and learn how to do it.

The Path:
Sell -> Build -> Validate -> Grow -> Scale

5 criteria to pass each phase, and 5 sub-criteria to work on at home for each.

What you don't get in school is muscle of how to create on your own something that lives in the real world. Getting solid in Math means you know how to run the numbers so your thing, whether it is an NIL presence or an art show, works and is healthy.

Plus, you get to join a city-wide network of kids building interesting lives together. The network is capped at 120 seats on purpose so you get to know everyone inside it.

The application process
When you click "Join The 120" on the website, you'll build your child's dossier: their group, their interests, and a pitch for what they'll build, in their own words. It's short (about 5 minutes), and it matters: the dossier *is* the application, and it's exactly what we walk through together in the process to join.

**→ Join The 120:** https://the120.school/

Here's how the whole thing works, so nothing is a surprise:

1. **Build the dossier** — your child's group, interests, and a pitch for what they'll build.
2. **Book a call** — we review the dossier together and find the right group.
3. **The qualifying assessment** — admission first; tuition only applies after a seat is offered.
4. **Reserve the seat** — once a seat is offered, a **$250 deposit, per child, holds it — fully refundable until September 30, 2026.** The only thing you can lose is the seat.

If you'd rather just talk it through first, that's completely fine — grab a time with me directly here: **cal.com/peter.k/the120**.

The founding cohort closes when the groups fill, and the live seat count is right on the site. I'd love for your family to be part of the first 120.

Talk soon,

**Peter Kuperman**
Founder, The 120
peter@the120.school · the120.school

*The year is 20 in-person workshops, starting Saturday, September 19, 2026. Kids build a real business and present it on stage at Demo Days for the cohort and parents, the first on **November 7, 2026.***

---

## Plain-text version (fallback)

Hi {{parent_first}},

Welcome to The 120. What is it?

- 120 motivated and engaged kids
- Two age cohorts: Ages 8–13 and 14–17
- Five groups: Athletes, Founders, Makers, Scholars, and Givers

As a child, you:
- Build your business (more on that later)
- Get Top 1% academics
- Find a group of motivated and awesome friends

The commitment:
- 20 in-person workshops over the year, roughly every 2 weeks
- 3–5 hours of work a week between workshops
- General math, 2X–4X faster than regular school (Catch Up, Reach Ahead, or Get Solid)

Your business:
- Athletes build their NIL.
- Founders build a company.
- Makers build music shows or gallery exhibits.
- Scholars build a research lab.
- Givers build a community service org.

The 120 gives you what you don't get in school: the ability to build something cool and learn how to do it.

The Path: Sell -> Build -> Validate -> Grow -> Scale. Five criteria to pass each phase, and five sub-criteria to work on at home for each.

What you don't get in school is the muscle of creating, on your own, something that lives in the real world. Getting solid in math means you can run the numbers so your thing, whether it's an NIL presence or an art show, works and is healthy.

Plus, you join a city-wide network of kids building interesting lives together, capped at 120 seats on purpose so you get to know everyone inside it.

The application process: when you click "Join The 120" on the website, you'll build your child's dossier — their group, interests, and a pitch for what they'll build, in their own words. It's short (about 5 minutes), and the dossier is the application, exactly what we walk through together.

Join The 120: https://the120.school/

How it works:
1. Build the dossier — your child's group, interests, and a pitch for what they'll build.
2. Book a call — we review the dossier together and find the right group.
3. The qualifying assessment — admission first; tuition only after a seat is offered.
4. Reserve the seat — a $250 deposit per child holds it, fully refundable until September 30, 2026. The only thing you can lose is the seat.

Prefer to talk it through first? Grab a time with me: cal.com/peter.k/the120

The founding cohort closes when the groups fill, and the live seat count is on the site. I'd love for your family to be part of the first 120.

Talk soon,
Peter Kuperman
Founder, The 120
peter@the120.school · the120.school

The year is 20 in-person workshops starting Saturday, September 19, 2026. Kids build a real business and present it on stage at Demo Days for the cohort and parents, the first on November 7, 2026.

---

## Notes for Peter
- **What I updated to match your edits:** rewrote the plain-text fallback to mirror your new body; changed the subject block to a single subject (dropped the old A/B/C); pointed the Setup "Links" row at the new **Join The 120** URL (`the120.school`); left your **preheader and body exactly as you saved them**.
- **Your body still uses `[bullet]` markers** — say the word and I'll convert them to real bullets so it's drop-in HTML-ready. Left as-is for now since it's your copy.
- **New facts you introduced here — worth reconciling across the other assets** so nothing contradicts: **two age cohorts (8–13 and 14–17)**, a **~5-minute application** (the one-pager/site still imply one 8–17 range and a longer dossier), **2X–4X math** with the *Catch Up / Reach Ahead / Get Solid* framing, and **"The Path"** (Sell → Build → Validate → Grow → Scale). The one-pager doesn't mention the two cohorts or The Path — flag if you want those added there too.
- **Voice check (optional):** the email greets the parent (`{{parent_first}}`) but the "As a child, you:" section speaks to the kid. Intentional? Easy to switch to "Your child will:" for one consistent addressee if you'd rather.
- **CASL:** fires only to parents who created an account themselves — express opt-in, compliant. Keep the unsubscribe/preferences footer Resend adds.
- **Sender:** defaulting to `peter@` (higher trust for a founding cohort) vs. `admissions@` (scales later) — flag to switch.
