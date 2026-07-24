/**
 * GENERATED — do not edit by hand.
 *
 * Source: artifacts/The Path/the-path-home-study-curriculum-brief.md
 * Built by: scripts/build-path-content.ts
 * Version: 2026-27 (The Path 1.0 — 2026-27)
 * Totals: 5 phases, 25 criteria, 125 tasks (25/26/24/25/25)
 *
 * This module is PERMANENT once a student is pinned to this version (D27).
 * A curriculum revision ships a NEW version and a NEW module beside this one —
 * it never regenerates this file, because a pinned student still reads it.
 */

import { registerProgram } from "../manifest";
import type { ProgramContent } from "../types";

export const PROGRAM_2026_27: ProgramContent = {
  "versionId": "2026-27",
  "phases": [
    {
      "num": "01",
      "key": "SELL",
      "subtitle": "Learn to confidently sell anything.",
      "seq": 1,
      "criteria": [
        {
          "id": "1.1",
          "seq": 1,
          "passCriterion": "Pitch a product in 60 seconds to an adult who isn't family, without notes",
          "tasks": [
            {
              "id": "1.1.1",
              "seq": 1,
              "title": "Pick the product and the one-liner.",
              "body": "Choose the product to pitch (something the child made or genuinely wants to sell) and write a single sentence: what it is, who it's for, why they'd want it.",
              "doneWhen": "the one-liner is written in the Founder File and the child can say it from memory.",
              "bandVariants": {
                "g3_5": "Parent scribes; child chooses the product and says the sentence unprompted.",
                "g6_8": "Child writes the sentence; parent may veto only on safety/feasibility.",
                "g9_12": "Child also writes one sentence on who the *wrong* customer is and why."
              },
              "completesCriterion": false
            },
            {
              "id": "1.1.2",
              "seq": 2,
              "title": "Write the full 60-second pitch.",
              "body": "Draft the pitch with four beats: hook, what it is, why it's good, and the ask. Maximum 150 words.",
              "doneWhen": "the written pitch is in the Founder File and reads aloud in under 60 seconds.",
              "bandVariants": {
                "g3_5": "Child dictates, parent types; child can point to each of the four beats.",
                "g6_8": "Child drafts alone; parent gives at most two notes.",
                "g9_12": "Child writes two versions with different hooks and picks one, noting why."
              },
              "completesCriterion": false
            },
            {
              "id": "1.1.3",
              "seq": 3,
              "title": "Rehearse to camera until note-free.",
              "body": "Practice on video until the child delivers the pitch without notes, under 60 seconds, three times in a row.",
              "doneWhen": "a video of three consecutive clean, note-free runs is in the Founder File.",
              "bandVariants": {
                "g3_5": "Runs may be up to 75 seconds; parent may hold up beat-reminder pictures (not words).",
                "g9_12": "Third run must include a deliberate pause and eye contact with the lens — no racing."
              },
              "completesCriterion": false
            },
            {
              "id": "1.1.4",
              "seq": 4,
              "title": "Cold-pitch a parent and revise.",
              "body": "Pitch a parent who reacts as a real skeptical customer (one honest objection required). Child revises one thing in the pitch based on the objection.",
              "doneWhen": "the objection and the one revision are written under this task ID in the Founder File.",
              "bandVariants": {
                "g3_5": "Parent's objection is gentle but real (\"Why would I need that?\").",
                "g9_12": "Two objections; the child must answer one live rather than revising for it."
              },
              "completesCriterion": false
            },
            {
              "id": "1.1.5",
              "seq": 5,
              "title": "Deliver to a non-family adult, no notes.",
              "body": "Pitch a non-family adult live (in person or video call), without notes, in under 60 seconds. The adult then says back what the product is and what was asked of them.",
              "doneWhen": "the adult's say-back matches the pitch (parent witnesses), and the date, adult's name, and outcome are logged.",
              "bandVariants": {
                "g3_5": "A familiar non-family adult (neighbor, coach) is fine.",
                "g6_8": "An adult the child doesn't see weekly.",
                "g9_12": "An adult the child has never pitched anything to, met for this purpose."
              },
              "completesCriterion": true
            }
          ]
        },
        {
          "id": "1.2",
          "seq": 2,
          "passCriterion": "Make a real sale: a real customer who isn't family, real money changing hands",
          "tasks": [
            {
              "id": "1.2.1",
              "seq": 1,
              "title": "Choose the offer and set the price.",
              "body": "Decide exactly what is being sold (product, service, or charity offer), what one unit is, and its price.",
              "doneWhen": "offer, unit, and price are written in the Founder File with one sentence on how the price was chosen.",
              "bandVariants": {
                "g3_5": "Parent lists three price options; child picks and says why.",
                "g6_8": "Child proposes the price; parent checks it covers costs.",
                "g9_12": "Price justified against two real alternatives a customer could buy instead."
              },
              "completesCriterion": false
            },
            {
              "id": "1.2.2",
              "seq": 2,
              "title": "Build the first prospect list.",
              "body": "With a parent, list ten real people or households (non-family) the child can safely ask, and how each will be reached.",
              "doneWhen": "a list of ten names/households with a channel for each is in the Founder File, parent-approved for safety.",
              "bandVariants": {
                "g3_5": "Drawn from the family's known circle (neighbors, teammates' families).",
                "g6_8": "At least three prospects outside the family's immediate circle.",
                "g9_12": "At least five outside the immediate circle, with a one-line reason each might buy."
              },
              "completesCriterion": false
            },
            {
              "id": "1.2.3",
              "seq": 3,
              "title": "Set up the point of sale.",
              "body": "Decide how money will actually change hands (cash box with float, parent-held e-transfer, square reader) and how the product will be delivered. Do one full dress rehearsal with a parent playing the buyer.",
              "doneWhen": "the rehearsal has run start to finish — greeting, ask, payment, delivery, thank-you — without stopping.",
              "bandVariants": {
                "g3_5": "Parent handles the money mechanics; child does everything else.",
                "g6_8": "Child handles money; parent watches the math.",
                "g9_12": "Child also prepares change/receipt handling and a simple sales record sheet."
              },
              "completesCriterion": false
            },
            {
              "id": "1.2.4",
              "seq": 4,
              "title": "Ask until one yes.",
              "body": "Work the prospect list, making real asks, until one real customer agrees and pays real money.",
              "doneWhen": "money from a non-family customer is in hand and the sale (who, what, amount, date) is logged.",
              "bandVariants": {
                "g3_5": "Parent physically present at every ask; child speaks the ask.",
                "g6_8": "Parent present but silent unless safety requires.",
                "g9_12": "Child runs the asks; parent verifies from the log afterward."
              },
              "completesCriterion": false
            },
            {
              "id": "1.2.5",
              "seq": 5,
              "title": "Deliver, thank, and log.",
              "body": "Deliver the product or service in full, thank the customer, and complete the sale record — including what the customer said.",
              "doneWhen": "the customer has what they paid for, and the completed sale record plus a photo (of the product, booth, or handoff — customer's face optional) is in the Founder File.",
              "bandVariants": {},
              "allBandsNote": "as written; **9–12** adds one sentence on what they'd change about the sale process.",
              "completesCriterion": true
            }
          ]
        },
        {
          "id": "1.3",
          "seq": 3,
          "passCriterion": "Hear \"no\" at least three times and log what each no taught them",
          "tasks": [
            {
              "id": "1.3.1",
              "seq": 1,
              "title": "Build the No Log.",
              "body": "Create a log template with five fields: date, who was asked, exact words of the ask, what they said, what it taught.",
              "doneWhen": "the blank template is in the Founder File and the child can explain why collecting no's is the point, in their own words.",
              "bandVariants": {
                "g3_5": "Parent draws/prints the template; child decorates and explains it.",
                "g6_8": "Child makes it.",
                "g9_12": "Child makes it."
              },
              "completesCriterion": false
            },
            {
              "id": "1.3.2",
              "seq": 2,
              "title": "Collect and log No #1.",
              "body": "Make a real ask, hear a no, and fill in all five fields the same day. Talk it through with a parent: what did this no teach?",
              "doneWhen": "No #1 is fully logged, lesson included.",
              "bandVariants": {
                "g3_5": "Parent helps name the lesson; the words in the log are the child's.",
                "g9_12": "Lesson must name something specific about the ask, not \"try again.\""
              },
              "completesCriterion": false
            },
            {
              "id": "1.3.3",
              "seq": 3,
              "title": "Change one thing, then collect No #2.",
              "body": "Before the next round of asks, change exactly one thing (the offer, the opener, the audience, the price) and write it down. Then make asks until the next no, and log it.",
              "doneWhen": "the pre-declared change and the fully logged No #2 are both in the file.",
              "bandVariants": {},
              "allBandsNote": "as written; **9–12** notes whether the change made the no *different* in kind.",
              "completesCriterion": false
            },
            {
              "id": "1.3.4",
              "seq": 4,
              "title": "Collect and log No #3.",
              "body": "Continue asking; log the third no with all five fields.",
              "doneWhen": "No #3 is fully logged.",
              "bandVariants": {},
              "allBandsNote": "as written.",
              "completesCriterion": false
            },
            {
              "id": "1.3.5",
              "seq": 5,
              "title": "Write the three-lesson summary.",
              "body": "Summarize: the three lessons, one pattern across the no's, and one change now permanent in how the child sells.",
              "doneWhen": "the summary (5–8 sentences or a poster) is in the Founder File and the child presents it aloud to a parent.",
              "bandVariants": {
                "g3_5": "Poster or dictated page.",
                "g6_8": "Written page.",
                "g9_12": "Written page plus the ratio of asks to no's to yeses so far."
              },
              "completesCriterion": true
            }
          ]
        },
        {
          "id": "1.4",
          "seq": 4,
          "passCriterion": "Explain cost, price, and profit for a product created by them, on one page",
          "tasks": [
            {
              "id": "1.4.1",
              "seq": 1,
              "title": "Count every cost.",
              "body": "List every real cost of making and selling one unit — materials, packaging, fees, ingredients — with actual numbers from receipts or store prices.",
              "doneWhen": "the per-unit cost list is in the Founder File and totals correctly (parent checks the math).",
              "bandVariants": {
                "g3_5": "Parent gathers prices with the child; child does the adding (calculator fine).",
                "g6_8": "Child researches prices; parent spot-checks two.",
                "g9_12": "Includes at least one non-obvious cost (their time, transaction fees, spoilage/waste)."
              },
              "completesCriterion": false
            },
            {
              "id": "1.4.2",
              "seq": 2,
              "title": "Justify the price.",
              "body": "Write the price and *why*: what two alternatives cost, and why a customer would pay this much for this product.",
              "doneWhen": "the price justification (3–5 sentences) naming two real alternatives is in the file.",
              "bandVariants": {},
              "allBandsNote": "as written; **9–12** adds what the highest defensible price would be and why they didn't choose it.",
              "completesCriterion": false
            },
            {
              "id": "1.4.3",
              "seq": 3,
              "title": "Do the profit math.",
              "body": "Compute profit per unit (price − cost) and total profit so far from real sales.",
              "doneWhen": "both numbers are computed correctly in the file and the child answers two \"what if\" questions from the parent (e.g., \"If the price drops a dollar, what happens to profit?\") correctly, out loud.",
              "bandVariants": {
                "g3_5": "Whole-dollar rounding fine; parent asks one \"what if.\"",
                "g9_12": "Also computes profit margin as a percentage."
              },
              "completesCriterion": false
            },
            {
              "id": "1.4.4",
              "seq": 4,
              "title": "Build the one-pager.",
              "body": "Assemble cost, price, and profit onto a single page with at least one visual (drawing, diagram, or chart).",
              "doneWhen": "the one-pager exists, fits on one page, and contains all three numbers plus the visual.",
              "bandVariants": {
                "g3_5": "Poster format; parent may assemble, child directs layout.",
                "g6_8": "Child makes it, paper or digital.",
                "g9_12": "Digital, with a simple chart (drawn in a spreadsheet or tool)."
              },
              "completesCriterion": false
            },
            {
              "id": "1.4.5",
              "seq": 5,
              "title": "Teach it back.",
              "body": "Present the one-pager to a parent playing a curious investor who asks three questions. The child answers all three without help.",
              "doneWhen": "the parent confirms all three answers were the child's own and correct.",
              "bandVariants": {
                "g3_5": "Questions are concrete (\"Which costs the most to make?\").",
                "g6_8": "One question is a \"what if.\"",
                "g9_12": "One question is adversarial (\"Why wouldn't I just buy the cheaper one?\")."
              },
              "completesCriterion": true
            }
          ]
        },
        {
          "id": "1.5",
          "seq": 5,
          "passCriterion": "Complete 25 supervised outreach attempts: a booth, door to door, calls, or messages",
          "tasks": [
            {
              "id": "1.5.1",
              "seq": 1,
              "title": "Choose channels and write the safety plan.",
              "body": "Pick at least two outreach channels (booth, door-to-door, calls, messages) and write the family safety plan: where, when, who supervises, what's off-limits.",
              "doneWhen": "channels and the signed safety plan (parent and child both sign) are in the Founder File.",
              "bandVariants": {},
              "allBandsNote": "as written; channel choice should fit the child's age and neighborhood.",
              "completesCriterion": false
            },
            {
              "id": "1.5.2",
              "seq": 2,
              "title": "Script the openers and build the tracker.",
              "body": "Write a short opener for each channel and create a tracker numbered 1–25 with columns: date, channel, who, response, note.",
              "doneWhen": "openers are written and the blank 25-row tracker is ready.",
              "bandVariants": {
                "g3_5": "Parent builds tracker; child authors openers aloud.",
                "g6_8": "Child builds both.",
                "g9_12": "Tracker also captures a follow-up column."
              },
              "completesCriterion": false
            },
            {
              "id": "1.5.3",
              "seq": 3,
              "title": "Attempts 1–5, shoulder to shoulder.",
              "body": "Complete the first five attempts with the parent alongside, then debrief: what was scariest, what worked, what to change.",
              "doneWhen": "rows 1–5 are filled in and the debrief's one change is written down.",
              "bandVariants": {
                "g3_5": "Parent may open the conversation; child makes the ask.",
                "g6_8": "Child runs the whole attempt; parent within earshot.",
                "g9_12": "Parent observes only."
              },
              "completesCriterion": false
            },
            {
              "id": "1.5.4",
              "seq": 4,
              "title": "Attempts 6–15, applying the change.",
              "body": "Complete ten more attempts using the declared change. Review the tracker mid-way with a parent.",
              "doneWhen": "rows 6–15 are filled in and a one-line mid-point review note is added.",
              "bandVariants": {},
              "allBandsNote": "supervision per the safety plan.",
              "completesCriterion": false
            },
            {
              "id": "1.5.5",
              "seq": 5,
              "title": "Attempts 16–25 and the funnel count.",
              "body": "Finish the final ten attempts, then compute the funnel: attempts → real conversations → yeses.",
              "doneWhen": "all 25 rows are complete and the three funnel numbers are written at the bottom of the tracker.",
              "bandVariants": {
                "g3_5": "Parent helps count; child states the numbers aloud.",
                "g9_12": "Adds one sentence on which channel converted best and a guess why."
              },
              "completesCriterion": true
            }
          ]
        }
      ]
    },
    {
      "num": "02",
      "key": "BUILD",
      "subtitle": "Make a real product with AI.",
      "seq": 2,
      "criteria": [
        {
          "id": "2.1",
          "seq": 1,
          "passCriterion": "Ship a working product, site, or offer built with AI tools, with a live URL, pricing, and instructions",
          "tasks": [
            {
              "id": "2.1.1",
              "seq": 1,
              "title": "Write the product spec.",
              "body": "Half a page: who it's for, what it does, what it will cost, and what \"working\" means for v1.",
              "doneWhen": "the spec is in the Founder File and the child can state the user and the job in one breath.",
              "bandVariants": {
                "g3_5": "Dictated to parent; child draws the product.",
                "g6_8": "Child writes it.",
                "g9_12": "Spec also lists what v1 deliberately *won't* do."
              },
              "completesCriterion": false
            },
            {
              "id": "2.1.2",
              "seq": 2,
              "title": "Set up the AI toolkit.",
              "body": "With a parent, choose the AI build tools and set up accounts (parent-owned per the safety rules). Do one 15-minute warm-up build together to learn the tool.",
              "doneWhen": "tools are chosen, accounts work, and the throwaway warm-up build exists.",
              "bandVariants": {
                "g3_5": "Parent drives the keyboard; child directs every prompt aloud.",
                "g6_8": "Child drives; parent reviews prompts before sending.",
                "g9_12": "Child sets up solo; parent verifies account safety settings."
              },
              "completesCriterion": false
            },
            {
              "id": "2.1.3",
              "seq": 3,
              "title": "Build v0.1.",
              "body": "Build a first rough version with the AI tools — enough that a parent can click it, use it, or hold it.",
              "doneWhen": "a parent has used v0.1 for two minutes without the child touching it, and a screenshot/photo is filed.",
              "bandVariants": {
                "g3_5": "Parent executes prompts the child composes; every design decision is the child's.",
                "g9_12": "v0.1 includes a working core interaction, not just static pages."
              },
              "completesCriterion": false
            },
            {
              "id": "2.1.4",
              "seq": 4,
              "title": "Add pricing and instructions.",
              "body": "Put the price and plain-language \"how to use this\" instructions into the product itself.",
              "doneWhen": "a stranger opening the product would know what it costs and how to use it, verified by the parent reading it cold.",
              "bandVariants": {},
              "allBandsNote": "as written; **9–12** instructions must survive the parent following them literally, step by step.",
              "completesCriterion": false
            },
            {
              "id": "2.1.5",
              "seq": 5,
              "title": "Go live and test from outside.",
              "body": "Publish to a live URL (or, for a physical offer, a public order page/flyer with a reachable contact). Test it from a different device on a different network.",
              "doneWhen": "the live URL loads on someone else's device, the link is logged in the Founder File, and a parent confirms pricing + instructions are visible.",
              "bandVariants": {
                "g3_5": "Parent publishes; child verifies on the second device.",
                "g6_8": "Child publishes with parent review.",
                "g9_12": "Child publishes solo; also asks one non-family person to open it and confirm."
              },
              "completesCriterion": true
            }
          ]
        },
        {
          "id": "2.2",
          "seq": 2,
          "passCriterion": "Explain in a 1-page brief how the product connects to a gap in a domain they know",
          "tasks": [
            {
              "id": "2.2.1",
              "seq": 1,
              "title": "Map what you know.",
              "body": "List three domains the child actually knows well (a sport, a game, a hobby, a subject, a community) and pick one.",
              "doneWhen": "the list of three and the pick, with one sentence on why, are in the Founder File.",
              "bandVariants": {},
              "allBandsNote": "as written.",
              "completesCriterion": false
            },
            {
              "id": "2.2.2",
              "seq": 2,
              "title": "Hunt the gap.",
              "body": "Gather evidence of a real annoyance or unmet need in that domain: talk to three people who share it, or list five specific frustrations from the child's own experience.",
              "doneWhen": "the raw evidence (interview notes or the frustration list) is in the file.",
              "bandVariants": {
                "g3_5": "Parent sits in on interviews; child asks the questions.",
                "g6_8": "Child interviews; at least one interviewee outside the household.",
                "g9_12": "All three interviewees outside the household; notes capture quotes."
              },
              "completesCriterion": false
            },
            {
              "id": "2.2.3",
              "seq": 3,
              "title": "Name the gap in one sentence.",
              "body": "Compress the evidence into a single gap statement: \"People who ___ struggle to ___ because ___.\"",
              "doneWhen": "the sentence is written and a parent can repeat the gap back accurately after hearing it once.",
              "bandVariants": {},
              "allBandsNote": "as written.",
              "completesCriterion": false
            },
            {
              "id": "2.2.4",
              "seq": 4,
              "title": "Write the brief.",
              "body": "One page: the domain, the evidence, the gap statement, and exactly how the product fills the gap.",
              "doneWhen": "the brief fits one page and contains all four parts.",
              "bandVariants": {
                "g3_5": "Dictated/scribed; child's words.",
                "g6_8": "Child writes.",
                "g9_12": "Brief also names one competitor or existing workaround and why the product beats it."
              },
              "completesCriterion": false
            },
            {
              "id": "2.2.5",
              "seq": 5,
              "title": "The outside-reader test.",
              "body": "A non-family reader (adult or peer who knows the domain) reads the brief cold and says back the gap and the solution. Revise until their say-back is right.",
              "doneWhen": "the reader's accurate say-back is witnessed by a parent and the final brief is filed.",
              "bandVariants": {},
              "allBandsNote": "as written; **9–12** reader should be someone from the domain itself.",
              "completesCriterion": true
            }
          ]
        },
        {
          "id": "2.3",
          "seq": 3,
          "passCriterion": "Contact 40 potential customers; launch one piece of marketing with metrics",
          "tasks": [
            {
              "id": "2.3.1",
              "seq": 1,
              "title": "Build the 40-contact list.",
              "body": "With a parent, assemble a list of 40 real potential customers (people, households, or community groups) with a channel for each. Booth passers-by and event attendees count when logged individually.",
              "doneWhen": "the 40-row list exists and the parent has approved every channel for safety.",
              "bandVariants": {
                "g3_5": "Parent sources most contacts; child sorts who's most likely to buy and why.",
                "g6_8": "Child builds at least half the list.",
                "g9_12": "Child builds the list; at least 10 contacts beyond the family's existing circle."
              },
              "completesCriterion": false
            },
            {
              "id": "2.3.2",
              "seq": 2,
              "title": "Write and approve the outreach message.",
              "body": "Draft the message or script, one per channel. Parent reviews and approves before anything is sent.",
              "doneWhen": "approved scripts are in the Founder File, marked APPROVED with the date.",
              "bandVariants": {},
              "allBandsNote": "as written — the approval gate applies to every band.",
              "completesCriterion": false
            },
            {
              "id": "2.3.3",
              "seq": 3,
              "title": "Contact 1–20.",
              "body": "Make the first twenty contacts. Track every one: date, who, channel, response.",
              "doneWhen": "rows 1–20 are complete.",
              "bandVariants": {
                "g3_5": "Parent sends written messages the child composed; child handles in-person contacts.",
                "g6_8": "Child sends from parent-supervised accounts.",
                "g9_12": "Child runs it; parent audits the tracker weekly."
              },
              "completesCriterion": false
            },
            {
              "id": "2.3.4",
              "seq": 4,
              "title": "Contact 21–40 and tally.",
              "body": "Finish the list, then tally: contacted → replied → interested → bought.",
              "doneWhen": "all 40 rows are complete and the four-number tally is written at the bottom.",
              "bandVariants": {},
              "allBandsNote": "as written.",
              "completesCriterion": false
            },
            {
              "id": "2.3.5",
              "seq": 5,
              "title": "Design the marketing piece and pick its metric first.",
              "body": "Create one piece of marketing (flyer, poster, short video, social post) and — before launching — write down the one metric that will define \"it worked\" (scans, replies, visits, sales) and the number to beat.",
              "doneWhen": "the finished piece and its pre-declared metric + target are in the file.",
              "bandVariants": {
                "g3_5": "Child designs, parent produces; metric target set together.",
                "g6_8": "Child makes it; parent approves before it goes anywhere public.",
                "g9_12": "Piece includes a trackable mechanism (code, dedicated link, \"mention this flyer\")."
              },
              "completesCriterion": false
            },
            {
              "id": "2.3.6",
              "seq": 6,
              "title": "Launch, measure, conclude.",
              "body": "Launch the piece, let it run for a set window (1–2 weeks), then read the metric and write three sentences: what happened vs the target, why, and what you'd change.",
              "doneWhen": "the metric reading and three-sentence conclusion are in the Founder File.",
              "bandVariants": {},
              "allBandsNote": "as written; **9–12** compares the marketing channel's results to the direct-outreach results from 2.3.4.",
              "completesCriterion": true
            }
          ]
        },
        {
          "id": "2.4",
          "seq": 4,
          "passCriterion": "Ship a v2 that responds to feedback from at least three real users",
          "tasks": [
            {
              "id": "2.4.1",
              "seq": 1,
              "title": "Watch three real users.",
              "body": "Recruit three real users (non-family preferred; one family member allowed for 3–5) to try the product while the child watches silently and takes notes on where they hesitate, stumble, or quit.",
              "doneWhen": "three sets of observation notes are in the Founder File.",
              "bandVariants": {
                "g3_5": "Parent may take the notes the child dictates immediately after each session.",
                "g6_8": "Child takes notes live.",
                "g9_12": "Sessions include one \"think aloud\" user; notes capture direct quotes."
              },
              "completesCriterion": false
            },
            {
              "id": "2.4.2",
              "seq": 2,
              "title": "Turn notes into a ranked fix list.",
              "body": "Convert observations into a list of possible improvements, then rank and pick the top three.",
              "doneWhen": "the ranked list exists, each of the top three traceable to a specific user moment.",
              "bandVariants": {},
              "allBandsNote": "as written.",
              "completesCriterion": false
            },
            {
              "id": "2.4.3",
              "seq": 3,
              "title": "Build the three changes.",
              "body": "Implement the top three changes using the AI tools, keeping a simple before/after change log.",
              "doneWhen": "all three changes work and the change log (what changed, which user prompted it) is filed.",
              "bandVariants": {
                "g3_5": "Parent drives the tools; child directs each change and confirms it matches the user note.",
                "g6_8": "Child builds with parent review.",
                "g9_12": "Child builds solo."
              },
              "completesCriterion": false
            },
            {
              "id": "2.4.4",
              "seq": 4,
              "title": "Ship v2 live.",
              "body": "Publish v2 to the live URL (or updated offer), replacing v1.",
              "doneWhen": "v2 is live and a parent confirms each of the three changes is visible/working in the shipped version.",
              "bandVariants": {},
              "allBandsNote": "publishing rules per band as in 2.1.5.",
              "completesCriterion": false
            },
            {
              "id": "2.4.5",
              "seq": 5,
              "title": "Close the loop with the users.",
              "body": "Tell all three users what changed because of them. At least one tries v2 and confirms the change addressed their issue.",
              "doneWhen": "the thank-you messages and one user's confirmation are in the Founder File.",
              "bandVariants": {},
              "allBandsNote": "as written; messages via parent-approved channels.",
              "completesCriterion": true
            }
          ]
        },
        {
          "id": "2.5",
          "seq": 5,
          "passCriterion": "Present a 3–5 minute live demo: the build, the results, and the lessons",
          "tasks": [
            {
              "id": "2.5.1",
              "seq": 1,
              "title": "Outline the demo.",
              "body": "Structure it in four parts: the gap (from 2.2), the live product walkthrough, the numbers (from 2.3), and three lessons about building.",
              "doneWhen": "the one-page outline is in the Founder File.",
              "bandVariants": {},
              "allBandsNote": "as written; **3–5** may be a picture storyboard.",
              "completesCriterion": false
            },
            {
              "id": "2.5.2",
              "seq": 2,
              "title": "Rehearse against the clock.",
              "body": "Practice with the real, live product (not screenshots) until two consecutive runs land between 3 and 5 minutes.",
              "doneWhen": "two timed clean runs are logged (parent timestamps them).",
              "bandVariants": {
                "g3_5": "Parent may run the device while the child presents.",
                "g6_8": "Child runs their own demo.",
                "g9_12": "One rehearsal must survive a parent-injected surprise (\"the wifi is slow — keep going\")."
              },
              "completesCriterion": false
            },
            {
              "id": "2.5.3",
              "seq": 3,
              "title": "Stage the Family Demo Session.",
              "body": "Calendar a Family Demo Session at least three days out and invite the audience: both parents/household adults if possible, plus **at least one non-family adult**.",
              "doneWhen": "the invitation is sent and the session is on the family calendar.",
              "bandVariants": {
                "g3_5": "One non-family adult.",
                "g6_8": "One non-family adult.",
                "g9_12": "Two non-family adults, at least one with business or domain experience."
              },
              "completesCriterion": false
            },
            {
              "id": "2.5.4",
              "seq": 4,
              "title": "Deliver the demo and take questions.",
              "body": "Present live, product running, 3–5 minutes, then take at least two audience questions.",
              "doneWhen": "the demo ran live within time and both questions were answered by the child alone — parent verifies.",
              "bandVariants": {},
              "allBandsNote": "as written.",
              "completesCriterion": false
            },
            {
              "id": "2.5.5",
              "seq": 5,
              "title": "Record and file.",
              "body": "Video the demo (or record the call) and file it with the outline and one sentence from the child: the single biggest lesson about building.",
              "doneWhen": "the video and lesson sentence are in the Founder File.",
              "bandVariants": {},
              "allBandsNote": "as written.",
              "completesCriterion": true
            }
          ]
        }
      ]
    },
    {
      "num": "03",
      "key": "VALIDATE",
      "subtitle": "Test ideas like a scientist.",
      "seq": 3,
      "criteria": [
        {
          "id": "3.1",
          "seq": 1,
          "passCriterion": "Run at least 2 validation loops: hypothesis, test, outcome",
          "tasks": [
            {
              "id": "3.1.1",
              "seq": 1,
              "title": "Build the loop template.",
              "body": "With a parent, create the validation loop template: hypothesis (\"We believe ___\"), test (\"We will ___\"), pass bar (\"It's true if ___ happens by ___\"), result, decision (persevere / pivot / kill).",
              "doneWhen": "the blank template is in the Founder File and the child explains, in their own words, why the pass bar is set *before* the test.",
              "bandVariants": {
                "g3_5": "Parent builds the template; the explanation is the child's.",
                "g6_8": "Child builds it.",
                "g9_12": "Child builds it."
              },
              "completesCriterion": false
            },
            {
              "id": "3.1.2",
              "seq": 2,
              "title": "Loop 1: write the bet before the test.",
              "body": "Fill in hypothesis, test design, and pass bar for a real question about the business (will people pay more? do customers want delivery? does the flyer work better than the post?). The test must be runnable within two weeks and cost under an agreed cap.",
              "doneWhen": "all three pre-test fields are complete and dated *before* any testing starts.",
              "bandVariants": {
                "g3_5": "Parent proposes two testable questions; child picks and fills the template aloud.",
                "g6_8": "Child writes the loop; parent checks the pass bar is measurable.",
                "g9_12": "Child writes it solo; the hypothesis must be one the child genuinely believes could fail."
              },
              "completesCriterion": false
            },
            {
              "id": "3.1.3",
              "seq": 3,
              "title": "Loop 1: run it and decide.",
              "body": "Run the test exactly as designed, record the result, compare it to the pre-set bar, and write the decision.",
              "doneWhen": "result and decision fields are complete, and the decision follows the bar (not the child's hopes) — parent verifies the logic.",
              "bandVariants": {},
              "allBandsNote": "as written.",
              "completesCriterion": false
            },
            {
              "id": "3.1.4",
              "seq": 4,
              "title": "Loop 2: a second, different bet.",
              "body": "Write and pre-date a second full loop testing a *different kind* of question than Loop 1.",
              "doneWhen": "Loop 2's three pre-test fields are complete and dated before testing.",
              "bandVariants": {},
              "allBandsNote": "as written; **9–12** must design a cheaper or faster test than Loop 1.",
              "completesCriterion": false
            },
            {
              "id": "3.1.5",
              "seq": 5,
              "title": "Loop 2: run it, then compare beliefs.",
              "body": "Run Loop 2, record result and decision, then write the belief ledger: \"Before these loops I believed ___. Now I believe ___.\"",
              "doneWhen": "both loops are complete in the file and the belief ledger is written.",
              "bandVariants": {
                "g3_5": "Belief ledger may be dictated.",
                "g9_12": "Ledger also states which loop produced more information per dollar/hour spent."
              },
              "completesCriterion": true
            }
          ]
        },
        {
          "id": "3.2",
          "seq": 2,
          "passCriterion": "Deliver a pricing experiment: price points, margin math, feedback from two groups",
          "tasks": [
            {
              "id": "3.2.1",
              "seq": 1,
              "title": "Set the price points and do the margin math first.",
              "body": "Choose at least two price points to test and compute the per-unit margin at each *before* testing.",
              "doneWhen": "the price points and correct margin math are in the Founder File, dated before the test.",
              "bandVariants": {
                "g3_5": "Child does the arithmetic with a calculator; parent checks.",
                "g9_12": "Adds a third \"too high on purpose\" price point."
              },
              "completesCriterion": false
            },
            {
              "id": "3.2.2",
              "seq": 2,
              "title": "Define the two customer groups.",
              "body": "Name two genuinely different groups (e.g., neighbors vs. market-stall strangers; kids vs. adults; online vs. in-person) and how each will be reached.",
              "doneWhen": "both groups and their channels are written and parent-approved.",
              "bandVariants": {},
              "allBandsNote": "as written.",
              "completesCriterion": false
            },
            {
              "id": "3.2.3",
              "seq": 3,
              "title": "Test with Group 1.",
              "body": "Offer the product at the test prices to Group 1; record every response — what they said, what they paid or refused.",
              "doneWhen": "at least five real responses from Group 1 are logged.",
              "bandVariants": {
                "g3_5": "Parent present throughout; child makes the offers.",
                "g6_8": "Parent nearby.",
                "g9_12": "Child runs it; log includes verbatim reactions."
              },
              "completesCriterion": false
            },
            {
              "id": "3.2.4",
              "seq": 4,
              "title": "Test with Group 2.",
              "body": "Repeat with Group 2, same offer, same recording standard.",
              "doneWhen": "at least five real responses from Group 2 are logged.",
              "bandVariants": {},
              "allBandsNote": "as in 3.2.3.",
              "completesCriterion": false
            },
            {
              "id": "3.2.5",
              "seq": 5,
              "title": "Write the pricing verdict.",
              "body": "One page: the chosen price, the margin at that price, how the two groups differed, and one surprise.",
              "doneWhen": "the verdict page is in the Founder File and the child defends the chosen price to a parent asking \"why not higher? why not lower?\"",
              "bandVariants": {
                "g3_5": "Page may be a poster; defense is verbal.",
                "g9_12": "Includes a simple chart of responses by price point."
              },
              "completesCriterion": true
            }
          ]
        },
        {
          "id": "3.3",
          "seq": 3,
          "passCriterion": "Submit an AI-tool audit: selection, rationale, and outcome for at least 3 tools adopted since Day 1",
          "tasks": [
            {
              "id": "3.3.1",
              "seq": 1,
              "title": "Inventory every tool tried.",
              "body": "List every AI tool used since Day 1 of the home program — kept or abandoned — with one line on what it was tried for.",
              "doneWhen": "the inventory is in the Founder File (minimum five tried tools; broad interpretations fine — features count).",
              "bandVariants": {
                "g3_5": "Parent helps reconstruct the list from the Founder File's history.",
                "g6_8": "Child reconstructs it.",
                "g9_12": "Child reconstructs it."
              },
              "completesCriterion": false
            },
            {
              "id": "3.3.2",
              "seq": 2,
              "title": "Write the selection story for three adopted tools.",
              "body": "For each of three tools still in use: what job it was hired for, what alternative was considered, and why this one won.",
              "doneWhen": "all three selection stories (3–4 sentences each) are written.",
              "bandVariants": {},
              "allBandsNote": "as written; **9–12** must name a real alternative actually tested, not hypothetical.",
              "completesCriterion": false
            },
            {
              "id": "3.3.3",
              "seq": 3,
              "title": "Write the outcome for each.",
              "body": "For each of the three: what it made possible, what it cost (time/money), and whether it stays in the toolkit next phase.",
              "doneWhen": "all three outcomes are written with a keep/drop verdict each.",
              "bandVariants": {},
              "allBandsNote": "as written.",
              "completesCriterion": false
            },
            {
              "id": "3.3.4",
              "seq": 4,
              "title": "Add one graveyard entry.",
              "body": "Write up one tool that was tried and abandoned: why it was chosen, why it failed, and what that taught about picking tools.",
              "doneWhen": "the graveyard entry is in the audit.",
              "bandVariants": {},
              "allBandsNote": "as written.",
              "completesCriterion": false
            },
            {
              "id": "3.3.5",
              "seq": 5,
              "title": "Assemble and defend the audit.",
              "body": "Combine inventory, three selection stories, three outcomes, and the graveyard entry into one audit document. The child walks a parent through it; the parent picks any tool and asks \"what job does this one do?\" — answered without notes.",
              "doneWhen": "the assembled audit is in the Founder File and the quiz is passed.",
              "bandVariants": {
                "g3_5": "Audit may be assembled by the parent from the child's pieces; quiz is verbal.",
                "g6_8": "Child assembles.",
                "g9_12": "Audit opens with a one-paragraph \"my rules for picking AI tools.\""
              },
              "completesCriterion": true
            }
          ]
        },
        {
          "id": "3.4",
          "seq": 4,
          "passCriterion": "Without adult help, choose a validation path; present the reasoning and outcome",
          "tasks": [
            {
              "id": "3.4.1",
              "seq": 1,
              "title": "The handover.",
              "body": "Parent formally hands over: the child writes their own validation plan — what to test, how, and what the pass bar is — completely alone. The plan goes in a sealed envelope or dated file *before* any discussion.",
              "doneWhen": "the sealed/dated plan exists and the parent confirms they gave no input on its content.",
              "bandVariants": {
                "g3_5": "Plan may be drawn or dictated to a recording (not to the parent).",
                "g6_8": "Written alone.",
                "g9_12": "Written alone, including a budget and timeline."
              },
              "completesCriterion": false
            },
            {
              "id": "3.4.2",
              "seq": 2,
              "title": "Run the test solo.",
              "body": "Execute the plan. Parent supervises for safety only — no suggestions, no course corrections, even if the child is heading for a wall.",
              "doneWhen": "the test has run and the child's own record of what happened is in the Founder File.",
              "bandVariants": {},
              "allBandsNote": "as written. Letting it fail is allowed and valuable.",
              "completesCriterion": false
            },
            {
              "id": "3.4.3",
              "seq": 3,
              "title": "Prepare the presentation alone.",
              "body": "Build a short presentation of the reasoning (why this test), the method, and the outcome — including anything that went wrong — without adult editing.",
              "doneWhen": "the presentation materials exist, made entirely by the child.",
              "bandVariants": {
                "g3_5": "Any format — poster, show-and-tell, slides.",
                "g9_12": "Must include what they'd do differently."
              },
              "completesCriterion": false
            },
            {
              "id": "3.4.4",
              "seq": 4,
              "title": "Present at the Family Demo Session.",
              "body": "Deliver at a calendared Family Demo Session. The audience asks questions but offers no fixes. Afterward, open the sealed plan and compare: did they do what they said?",
              "doneWhen": "the presentation is delivered, recorded, and the plan-vs-actual comparison is noted in the Founder File.",
              "bandVariants": {},
              "allBandsNote": "as written.",
              "completesCriterion": true
            }
          ]
        },
        {
          "id": "3.5",
          "seq": 5,
          "passCriterion": "Publish two pieces of content that attract external engagement",
          "tasks": [
            {
              "id": "3.5.1",
              "seq": 1,
              "title": "Choose the platform and set the rules.",
              "body": "With a parent, pick where content will live (parents' accounts are fine and expected for under-13s), what formats, and the publishing safety rules (nothing identifying, parent approves every post).",
              "doneWhen": "platform, format, and signed publishing rules are in the Founder File.",
              "bandVariants": {},
              "allBandsNote": "as written — approval gate for every band, per the safety rules.",
              "completesCriterion": false
            },
            {
              "id": "3.5.2",
              "seq": 2,
              "title": "Make and publish Piece 1.",
              "body": "Create the first piece about the business or the build journey and publish it.",
              "doneWhen": "Piece 1 is live and the link/screenshot is filed.",
              "bandVariants": {
                "g3_5": "Child creates content; parent edits lightly and posts.",
                "g6_8": "Child creates and drafts the post; parent approves and posts.",
                "g9_12": "Child creates and posts from a parent-visible account."
              },
              "completesCriterion": false
            },
            {
              "id": "3.5.3",
              "seq": 3,
              "title": "Make and publish Piece 2, changed on purpose.",
              "body": "Before making Piece 2, write one deliberate change based on how Piece 1 performed (topic, format, hook, time of day). Publish Piece 2.",
              "doneWhen": "the pre-declared change and the live Piece 2 are both filed.",
              "bandVariants": {},
              "allBandsNote": "as written.",
              "completesCriterion": false
            },
            {
              "id": "3.5.4",
              "seq": 4,
              "title": "Track engagement for a week.",
              "body": "For at least seven days after each piece, track external engagement: comments, shares, saves, DMs/inbound, reposts, or citations — from people outside the household.",
              "doneWhen": "screenshots of external engagement on both pieces are in the Founder File. If a piece gets zero external engagement, one more piece is made and published (repeat 3.5.3) until two pieces have external engagement.",
              "bandVariants": {},
              "allBandsNote": "as written; the retry rule keeps the bar real without punishing a slow start.",
              "completesCriterion": false
            },
            {
              "id": "3.5.5",
              "seq": 5,
              "title": "Write the content verdict.",
              "body": "Three lines: which piece did better, by which number, and the child's best theory why.",
              "doneWhen": "the verdict is in the Founder File.",
              "bandVariants": {
                "g3_5": "Dictated fine.",
                "g9_12": "Adds what they'd post next and the number it should beat."
              },
              "completesCriterion": true
            }
          ]
        }
      ]
    },
    {
      "num": "04",
      "key": "GROW",
      "subtitle": "Turn a validated idea into a running business.",
      "seq": 4,
      "criteria": [
        {
          "id": "4.1",
          "seq": 1,
          "passCriterion": "10 sales or 3 repeat customers",
          "tasks": [
            {
              "id": "4.1.1",
              "seq": 1,
              "title": "Build the sales ledger.",
              "body": "Create the running ledger every sale will enter: date, customer, item, amount, new or repeat.",
              "doneWhen": "the ledger exists, back-filled with every sale to date, and the new/repeat column is accurate.",
              "bandVariants": {
                "g3_5": "Parent builds the ledger; child back-fills it.",
                "g6_8": "Child builds and maintains it.",
                "g9_12": "Child builds and maintains it."
              },
              "completesCriterion": false
            },
            {
              "id": "4.1.2",
              "seq": 2,
              "title": "Set the weekly selling routine.",
              "body": "Decide when selling happens every week — a standing slot (\"Saturday morning booth,\" \"Wednesday order messages\") — and put it on the family calendar.",
              "doneWhen": "the routine is calendared and has run for its first week.",
              "bandVariants": {},
              "allBandsNote": "as written; the routine, not the mood, drives the asks.",
              "completesCriterion": false
            },
            {
              "id": "4.1.3",
              "seq": 3,
              "title": "Run the repeat campaign.",
              "body": "Go back to every past customer with a reason to buy again: a new item, a refill offer, a loyalty deal. Contact each one.",
              "doneWhen": "every past customer has been re-contacted (logged), whatever they answer.",
              "bandVariants": {
                "g3_5": "Parent sends messages the child composes; in-person re-asks are the child's.",
                "g6_8": "Child contacts with parent review.",
                "g9_12": "Child designs the offer and runs the campaign solo."
              },
              "completesCriterion": false
            },
            {
              "id": "4.1.4",
              "seq": 4,
              "title": "The halfway review.",
              "body": "At 5 total sales or 1 repeat customer, sit down with a parent and answer three questions from the ledger: where do sales come from, what's the best seller, what will we double down on?",
              "doneWhen": "the three answers are written in the Founder File.",
              "bandVariants": {},
              "allBandsNote": "as written.",
              "completesCriterion": false
            },
            {
              "id": "4.1.5",
              "seq": 5,
              "title": "Hit the bar.",
              "body": "Keep the routine running until the ledger shows **10 total sales or 3 repeat customers**.",
              "doneWhen": "the ledger verifiably shows the bar is met — parent audits every row against real money received.",
              "bandVariants": {},
              "allBandsNote": "same bar. **9–12** adds: state the revenue total and the single best decision that drove it.",
              "completesCriterion": true
            }
          ]
        },
        {
          "id": "4.2",
          "seq": 2,
          "passCriterion": "Track a simple P&L for four consecutive weeks of active business",
          "tasks": [
            {
              "id": "4.2.1",
              "seq": 1,
              "title": "Build the P&L template and learn its lines.",
              "body": "Create a weekly P&L: money in (sales), money out (costs), profit. The child explains each line to a parent in their own words.",
              "doneWhen": "the blank four-week template exists and the explanation is given.",
              "bandVariants": {
                "g3_5": "Three lines only, whole dollars; parent builds, child explains.",
                "g6_8": "Child builds it on paper or spreadsheet.",
                "g9_12": "Spreadsheet with formulas; adds a cumulative profit row."
              },
              "completesCriterion": false
            },
            {
              "id": "4.2.2",
              "seq": 2,
              "title": "Set up the records habit.",
              "body": "Create one place receipts and sales records land every time (envelope, photo folder, note) so the P&L is filled from records, not memory.",
              "doneWhen": "the system exists and the first week's records are in it.",
              "bandVariants": {},
              "allBandsNote": "as written.",
              "completesCriterion": false
            },
            {
              "id": "4.2.3",
              "seq": 3,
              "title": "Weeks 1–2.",
              "body": "Fill in the P&L for two consecutive weeks of active business, from records.",
              "doneWhen": "two weeks are complete and every number traces to a record — parent spot-checks two entries.",
              "bandVariants": {},
              "allBandsNote": "as written.",
              "completesCriterion": false
            },
            {
              "id": "4.2.4",
              "seq": 4,
              "title": "Weeks 3–4.",
              "body": "Complete weeks three and four consecutively — no gaps. If a week has no business activity, the clock restarts.",
              "doneWhen": "four consecutive weeks are filled in from records.",
              "bandVariants": {},
              "allBandsNote": "as written.",
              "completesCriterion": false
            },
            {
              "id": "4.2.5",
              "seq": 5,
              "title": "The month review.",
              "body": "Circle the best week and answer in writing: why was it best, and what one change will next month test?",
              "doneWhen": "the review is written and the child presents the four-week P&L to a parent, walking through every number without help.",
              "bandVariants": {
                "g3_5": "Presentation verbal, review dictated.",
                "g9_12": "Adds week-over-week profit trend and one sentence on what the trend means."
              },
              "completesCriterion": true
            }
          ]
        },
        {
          "id": "4.3",
          "seq": 3,
          "passCriterion": "Create one daily or weekly repeating AI process that supports the business",
          "tasks": [
            {
              "id": "4.3.1",
              "seq": 1,
              "title": "Pick the chore worth automating.",
              "body": "List the repeating chores in the business (reminders, social drafts, inventory counts, thank-you messages, bookkeeping) and pick one that happens at least weekly. Write what it takes to do by hand.",
              "doneWhen": "the chosen chore and its by-hand description (steps + minutes) are in the Founder File.",
              "bandVariants": {},
              "allBandsNote": "as written.",
              "completesCriterion": false
            },
            {
              "id": "4.3.2",
              "seq": 2,
              "title": "Design the AI process.",
              "body": "Using Claude Cowork or another AI agent/tool, write the instructions or prompt that will do the chore on a schedule. The child authors the instructions; the words must be theirs.",
              "doneWhen": "the written process instructions are filed and set up in the tool.",
              "bandVariants": {
                "g3_5": "Parent operates the tool; child dictates and refines the instructions.",
                "g6_8": "Child sets it up on a parent's account with review.",
                "g9_12": "Child sets it up solo."
              },
              "completesCriterion": false
            },
            {
              "id": "4.3.3",
              "seq": 3,
              "title": "Supervised first run.",
              "body": "Run the process once with the child watching the output closely. Compare it to the by-hand version; fix the instructions where it fell short.",
              "doneWhen": "the first run's output and at least one instruction fix are documented.",
              "bandVariants": {},
              "allBandsNote": "as written.",
              "completesCriterion": false
            },
            {
              "id": "4.3.4",
              "seq": 4,
              "title": "Let it run on schedule.",
              "body": "Let the process run at least two more cycles on its own schedule (two days or two weeks, per its cadence).",
              "doneWhen": "the child shows a parent evidence of two unattended runs and what each produced.",
              "bandVariants": {},
              "allBandsNote": "as written.",
              "completesCriterion": false
            },
            {
              "id": "4.3.5",
              "seq": 5,
              "title": "Write the process card.",
              "body": "One card/half-page: what the process does, when it runs, how to check it worked, how to stop it. Filed so anyone could take it over.",
              "doneWhen": "the process card is in the Founder File and a parent can answer \"how would I check it ran this week?\" from the card alone.",
              "bandVariants": {
                "g3_5": "Dictated to parent.",
                "g6_8": "Child writes it.",
                "g9_12": "Child writes it."
              },
              "completesCriterion": true
            }
          ]
        },
        {
          "id": "4.4",
          "seq": 4,
          "passCriterion": "Close at least one real negotiation with documented terms",
          "tasks": [
            {
              "id": "4.4.1",
              "seq": 1,
              "title": "Learn the moves.",
              "body": "With a parent, learn four negotiation basics — the ask, the counter, the trade, the walk-away point — and role-play a scenario twice, once as each side.",
              "doneWhen": "both role-plays have run and the child can name all four moves with an example.",
              "bandVariants": {
                "g3_5": "Scenarios are concrete and playful (negotiating the price of a hot chocolate stand's supplies).",
                "g9_12": "Adds anchoring and silence as moves; role-play includes a hostile counterpart."
              },
              "completesCriterion": false
            },
            {
              "id": "4.4.2",
              "seq": 2,
              "title": "Pick the real negotiation and set the sheet.",
              "body": "Choose a real counterparty and stake — supplier price, bulk discount, booth fee, commission split, trade of services — and privately write the goal, the opening ask, and the walk-away point *before* the conversation.",
              "doneWhen": "the pre-negotiation sheet is dated and filed before contact.",
              "bandVariants": {
                "g3_5": "Counterparty may be a known adult (store owner, market organizer); parent arranges the meeting, child negotiates.",
                "g6_8": "Child arranges and negotiates; parent present.",
                "g9_12": "Child arranges and negotiates; parent may be out of the room where safe."
              },
              "completesCriterion": false
            },
            {
              "id": "4.4.3",
              "seq": 3,
              "title": "Negotiate.",
              "body": "Have the real conversation. The child speaks for themselves; the parent does not step in on substance.",
              "doneWhen": "the negotiation has concluded — deal or no deal — and the child writes what happened, including which moves they used.",
              "bandVariants": {},
              "allBandsNote": "as written. A dignified no-deal above the walk-away line counts as a completed negotiation *conversation* — but the criterion needs a closed deal, so if no deal, pick a new counterparty and repeat 4.4.2–4.4.3.",
              "completesCriterion": false
            },
            {
              "id": "4.4.4",
              "seq": 4,
              "title": "Document the terms and confirm both sides.",
              "body": "Write the agreed terms — who does what, for how much, by when — and have both parties confirm (signature, reply, or witnessed handshake note).",
              "doneWhen": "the terms document with both confirmations is in the Founder File.",
              "bandVariants": {
                "g3_5": "Parent formats the document; terms are the child's words.",
                "g9_12": "Adds a comparison: final terms vs the pre-negotiation sheet — what was won, what was given."
              },
              "completesCriterion": false
            },
            {
              "id": "4.4.5",
              "seq": 5,
              "title": "Deliver the deal.",
              "body": "Perform the child's side of the terms in full, on time, and get the counterparty to confirm they got what was agreed.",
              "doneWhen": "delivery evidence and the counterparty's confirmation are in the Founder File.",
              "bandVariants": {},
              "allBandsNote": "as written — a negotiation is only closed when both sides have what they shook on.",
              "completesCriterion": true
            }
          ]
        },
        {
          "id": "4.5",
          "seq": 5,
          "passCriterion": "Present their financials the way a founder presents to a board",
          "tasks": [
            {
              "id": "4.5.1",
              "seq": 1,
              "title": "Build the board pack.",
              "body": "Three to five slides or pages: sales to date, costs, profit trend across the P&L month, and what's next.",
              "doneWhen": "the board pack exists and every number in it traces to the ledger or P&L.",
              "bandVariants": {
                "g3_5": "Child chooses what goes on each page; parent assembles; numbers are the child's.",
                "g6_8": "Child builds it.",
                "g9_12": "Includes one chart and one honest \"what's not working\" slide."
              },
              "completesCriterion": false
            },
            {
              "id": "4.5.2",
              "seq": 2,
              "title": "Own the numbers.",
              "body": "Rehearse until the child can answer \"why?\" for every number without reading — why was week 3 best, why is that cost so high.",
              "doneWhen": "a parent quizzes any three numbers from the pack and the child answers all three cold.",
              "bandVariants": {},
              "allBandsNote": "as written.",
              "completesCriterion": false
            },
            {
              "id": "4.5.3",
              "seq": 3,
              "title": "Convene the board.",
              "body": "Schedule the Family Board Meeting; recruit at least one non-family adult to sit on the board with a brief to ask real questions, not cheerlead.",
              "doneWhen": "the meeting is calendared and the board (parents + non-family adult) is confirmed.",
              "bandVariants": {
                "g3_5": "One non-family adult.",
                "g6_8": "One non-family adult.",
                "g9_12": "Two non-family adults; at least one who reads financial statements in real life."
              },
              "completesCriterion": false
            },
            {
              "id": "4.5.4",
              "seq": 4,
              "title": "Present and take the hard questions.",
              "body": "Deliver the board pack and take at least three questions, at least one of which is uncomfortable. No parent rescues.",
              "doneWhen": "the meeting has run, recorded on video, with all questions answered by the child.",
              "bandVariants": {},
              "allBandsNote": "as written.",
              "completesCriterion": false
            },
            {
              "id": "4.5.5",
              "seq": 5,
              "title": "Write the board memo.",
              "body": "Afterward, the child writes what the board pushed on, what they conceded, and one commitment for next month — and sends it to the board members.",
              "doneWhen": "the memo is in the Founder File and sent.",
              "bandVariants": {
                "g3_5": "Dictated; parent sends.",
                "g6_8": "Child writes; parent sends.",
                "g9_12": "Child writes and sends."
              },
              "completesCriterion": true
            }
          ]
        }
      ]
    },
    {
      "num": "05",
      "key": "SCALE",
      "subtitle": "Build systems so the business runs beyond them.",
      "seq": 5,
      "criteria": [
        {
          "id": "5.1",
          "seq": 1,
          "passCriterion": "Automate one real part of the business with an AI agent or automation, and show it running",
          "tasks": [
            {
              "id": "5.1.1",
              "seq": 1,
              "title": "Map the work and pick the target.",
              "body": "Map everything the business does weekly, mark what's already automated, and pick one real function (order intake, scheduling, customer replies, restock alerts, invoicing) to fully automate.",
              "doneWhen": "the work map and the chosen target, with a sentence on why this one, are in the Founder File.",
              "bandVariants": {},
              "allBandsNote": "as written.",
              "completesCriterion": false
            },
            {
              "id": "5.1.2",
              "seq": 2,
              "title": "Baseline the by-hand cost.",
              "body": "Measure how long the function takes by hand across one normal week (minutes, and steps).",
              "doneWhen": "the baseline number is written down with how it was measured.",
              "bandVariants": {
                "g3_5": "Parent times; child counts steps.",
                "g6_8": "Child measures.",
                "g9_12": "Child measures."
              },
              "completesCriterion": false
            },
            {
              "id": "5.1.3",
              "seq": 3,
              "title": "Build the automation.",
              "body": "Build it with an AI agent or automation tool. The child authors the logic — what triggers it, what it does, what \"done\" looks like.",
              "doneWhen": "the automation exists and completes the function once with the child initiating but not intervening.",
              "bandVariants": {
                "g3_5": "Parent operates the tool; every rule and decision is dictated by the child.",
                "g6_8": "Child builds with parent review.",
                "g9_12": "Child builds solo, with error handling for one thing that could go wrong."
              },
              "completesCriterion": false
            },
            {
              "id": "5.1.4",
              "seq": 4,
              "title": "The hands-off test.",
              "body": "Let the automation handle the function for one full real cycle (a real order, a real week of replies) with the child not touching it.",
              "doneWhen": "evidence of the untouched cycle — logs, outputs, timestamps — is in the Founder File.",
              "bandVariants": {},
              "allBandsNote": "as written.",
              "completesCriterion": false
            },
            {
              "id": "5.1.5",
              "seq": 5,
              "title": "Demo it live with the savings math.",
              "body": "Show a parent the automation running end to end, live, and present the math: minutes per week by hand vs now, and what the child does with the recovered time.",
              "doneWhen": "the live demo has run and the savings math is filed.",
              "bandVariants": {},
              "allBandsNote": "as written; **9–12** also names the automation's weakest point and the watch-out.",
              "completesCriterion": true
            }
          ]
        },
        {
          "id": "5.2",
          "seq": 2,
          "passCriterion": "Delegate a task with written instructions that worked",
          "tasks": [
            {
              "id": "5.2.1",
              "seq": 1,
              "title": "Choose the task and the delegate.",
              "body": "Pick a real recurring business task and a delegate: a friend, a sibling, or an AI agent. The task must matter — if it's skipped, a customer would notice.",
              "doneWhen": "task and delegate are named in the Founder File, with the \"a customer would notice\" test answered.",
              "bandVariants": {
                "g3_5": "Sibling or parent-as-employee is fine; AI agent with help.",
                "g6_8": "Friend, sibling, or AI agent.",
                "g9_12": "Prefer a human delegate — instructions for humans are the harder skill."
              },
              "completesCriterion": false
            },
            {
              "id": "5.2.2",
              "seq": 2,
              "title": "Write instructions that need no questions.",
              "body": "Write the instruction sheet: steps in order, what \"done\" looks like, an example of good output, and what to do if stuck. Standard: the delegate should need zero clarifying questions.",
              "doneWhen": "the instruction sheet is complete with all four parts.",
              "bandVariants": {
                "g3_5": "Child dictates; parent scribes verbatim, including the unclear bits — they're the lesson.",
                "g6_8": "Child writes.",
                "g9_12": "Child writes; includes a quality checklist the delegate self-checks against."
              },
              "completesCriterion": false
            },
            {
              "id": "5.2.3",
              "seq": 3,
              "title": "Hand off and stand back.",
              "body": "Give the delegate the sheet and let them do the task. The child answers no questions — questions get written down instead, as instruction bugs.",
              "doneWhen": "the delegate has attempted the task using only the sheet, and every question they asked is logged as a bug.",
              "bandVariants": {},
              "allBandsNote": "as written.",
              "completesCriterion": false
            },
            {
              "id": "5.2.4",
              "seq": 4,
              "title": "Grade the output and fix the instructions.",
              "body": "Compare the delegate's output to the written \"done\" standard. Fix every instruction bug, then have the delegate run it once more.",
              "doneWhen": "the second run meets the written standard with zero questions — that is the \"instructions that worked\" bar.",
              "bandVariants": {},
              "allBandsNote": "as written; repeat the fix-and-rerun loop until the bar is met.",
              "completesCriterion": false
            },
            {
              "id": "5.2.5",
              "seq": 5,
              "title": "File the final playcard.",
              "body": "File the final working instruction sheet with a note: what had to change between v1 and the version that worked.",
              "doneWhen": "the final sheet and the what-changed note are in the Founder File.",
              "bandVariants": {},
              "allBandsNote": "as written.",
              "completesCriterion": true
            }
          ]
        },
        {
          "id": "5.3",
          "seq": 3,
          "passCriterion": "Keep the business serving customers through a week they took off",
          "tasks": [
            {
              "id": "5.3.1",
              "seq": 1,
              "title": "Plan the off week.",
              "body": "Pick the actual week (calendar it) and list everything the business must still do that week: orders, deliveries, replies, posts.",
              "doneWhen": "the week is calendared and the must-still-happen list is complete.",
              "bandVariants": {},
              "allBandsNote": "as written.",
              "completesCriterion": false
            },
            {
              "id": "5.3.2",
              "seq": 2,
              "title": "Cover every item.",
              "body": "Assign every list item to a system: the automation (5.1), the delegate (5.2), pre-work done in advance, or — where truly necessary — an honest customer notice (\"orders ship again Monday\"). No item may be assigned to \"the child will quickly check.\"",
              "doneWhen": "the coverage plan shows every item covered and a parent has challenged it (\"what happens if an order comes in Tuesday?\") with answers from the plan.",
              "bandVariants": {
                "g3_5": "Parent may be one of the assigned systems (as a briefed employee with written instructions, not as a rescuer).",
                "g9_12": "No parent coverage; automation, delegate, and pre-work only."
              },
              "completesCriterion": false
            },
            {
              "id": "5.3.3",
              "seq": 3,
              "title": "Dry-run one day.",
              "body": "Before the off week, run one full day hands-off as a rehearsal. Fix what broke.",
              "doneWhen": "the dry-run day has run, and fixes (if any) are logged.",
              "bandVariants": {},
              "allBandsNote": "as written.",
              "completesCriterion": false
            },
            {
              "id": "5.3.4",
              "seq": 4,
              "title": "Take the week off.",
              "body": "The child does no business work for the full week. The parent verifies daily — the discipline of *not* working is the task.",
              "doneWhen": "the week has passed with zero child interventions (parent attests), and at least one customer was actually served during the week — an order, a delivery, a reply — with evidence.",
              "bandVariants": {},
              "allBandsNote": "as written. If no customer interaction naturally occurred, extend until one does; a week of silence proves nothing.",
              "completesCriterion": false
            },
            {
              "id": "5.3.5",
              "seq": 5,
              "title": "The re-entry review.",
              "body": "Back from the week: what held, what broke, what the fix is. Written and reviewed with a parent.",
              "doneWhen": "the review is in the Founder File with at least one system improvement adopted.",
              "bandVariants": {},
              "allBandsNote": "as written.",
              "completesCriterion": true
            }
          ]
        },
        {
          "id": "5.4",
          "seq": 4,
          "passCriterion": "Write the one-page playbook someone else could use to run it",
          "tasks": [
            {
              "id": "5.4.1",
              "seq": 1,
              "title": "Outline the machine.",
              "body": "List every recurring thing the business needs done — daily, weekly, monthly — in one skeleton outline.",
              "doneWhen": "the outline covers the full business (parent challenges: \"what about X?\" until nothing's missing).",
              "bandVariants": {},
              "allBandsNote": "as written.",
              "completesCriterion": false
            },
            {
              "id": "5.4.2",
              "seq": 2,
              "title": "Write the one-pager.",
              "body": "Compress the outline into one page: the weekly rhythm, the tools and where they live, how money is handled, who to contact when stuck. (A parent-held key list for logins may ride alongside, not on, the page.)",
              "doneWhen": "the playbook fits one page and covers every outline item.",
              "bandVariants": {
                "g3_5": "Dictated; may be a large illustrated page.",
                "g6_8": "Child writes.",
                "g9_12": "Child writes; page includes the three numbers to watch weekly."
              },
              "completesCriterion": false
            },
            {
              "id": "5.4.3",
              "seq": 3,
              "title": "The stranger test.",
              "body": "Hand the playbook to someone who has never run the business (the delegate from 5.2 doesn't count). Using only the page, they run one full day or cycle. The child watches silently, logging every stumble.",
              "doneWhen": "the test has run and every stumble is logged.",
              "bandVariants": {
                "g3_5": "Tester may be the other parent or an older sibling.",
                "g6_8": "Non-household tester preferred.",
                "g9_12": "Non-household tester required."
              },
              "completesCriterion": false
            },
            {
              "id": "5.4.4",
              "seq": 4,
              "title": "Fix and finalize.",
              "body": "Revise the playbook to remove every logged stumble; the tester (or a second tester) confirms the confusing parts now read clean.",
              "doneWhen": "the final playbook is in the Founder File with the tester's confirmation.",
              "bandVariants": {},
              "allBandsNote": "as written.",
              "completesCriterion": false
            },
            {
              "id": "5.4.5",
              "seq": 5,
              "title": "Live by the page.",
              "body": "For one full week, the playbook is the business's source of truth: the child runs the week from the page, and anywhere reality and the page disagree, the page gets corrected the same day.",
              "doneWhen": "the week has run with the playbook as the working checklist, and the page either needed zero corrections or shows its dated corrections.",
              "bandVariants": {},
              "allBandsNote": "as written — a playbook nobody runs from is a poster.",
              "completesCriterion": true
            }
          ]
        },
        {
          "id": "5.5",
          "seq": 5,
          "passCriterion": "Pitch what the business becomes next year, on stage",
          "tasks": [
            {
              "id": "5.5.1",
              "seq": 1,
              "title": "Draft the vision pitch.",
              "body": "Build the pitch: this year's real numbers (from the Founder File), what the business becomes next year, and what it will take to get there. Three slides or one poster, 3–5 minutes.",
              "doneWhen": "the draft pitch exists and every backward-looking number in it is real and traceable.",
              "bandVariants": {
                "g3_5": "Child directs; parent assembles visuals.",
                "g6_8": "Child builds it.",
                "g9_12": "Includes one concrete next-year target (revenue, customers, or product) and the first step toward it."
              },
              "completesCriterion": false
            },
            {
              "id": "5.5.2",
              "seq": 2,
              "title": "Rehearse to performance standard.",
              "body": "Practice until the pitch runs 3–5 minutes from memory, twice consecutively, including handling one planted audience question.",
              "doneWhen": "two clean timed runs with the planted question are logged.",
              "bandVariants": {},
              "allBandsNote": "as written.",
              "completesCriterion": false
            },
            {
              "id": "5.5.3",
              "seq": 3,
              "title": "Produce the Showcase.",
              "body": "Plan the event like a founder: date at least one week out, invitations sent, venue arranged (living room transformed, community room, backyard), stage area set, recording arranged.",
              "doneWhen": "five-plus attendees including two non-family adults are confirmed, and the logistics checklist is complete.",
              "bandVariants": {
                "g3_5": "Parent produces; child hosts.",
                "g6_8": "Child produces with parent handling bookings.",
                "g9_12": "Child produces end to end."
              },
              "completesCriterion": false
            },
            {
              "id": "5.5.4",
              "seq": 4,
              "title": "Take the stage.",
              "body": "Deliver the pitch live at the Showcase, then take audience questions. This is a performance: introduced by name, applause allowed, no restarts.",
              "doneWhen": "the pitch was delivered live within time to the assembled audience, on video, with questions answered by the child alone.",
              "bandVariants": {},
              "allBandsNote": "as written.",
              "completesCriterion": false
            },
            {
              "id": "5.5.5",
              "seq": 5,
              "title": "Seal the Founder File.",
              "body": "File the Showcase video, then complete the portfolio: every criterion's evidence checked present, the full checklist signed by parent and child, and one final page written by the child — \"What I can do now that I couldn't do a year ago.\"",
              "doneWhen": "the signed checklist and final page are in the Founder File.",
              "bandVariants": {},
              "allBandsNote": "as written. The final page is the child's alone, every band.",
              "completesCriterion": true
            }
          ]
        }
      ]
    }
  ]
};

registerProgram(PROGRAM_2026_27);

export default PROGRAM_2026_27;
