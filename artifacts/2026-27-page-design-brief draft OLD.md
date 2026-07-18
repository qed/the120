# Design Brief — "2026-27" Program Page · the120.school

**Version:** v2 draft for Peter's edit pass · 2026-07-17
**Page:** `/2026-27` — new top-level page, linked from the main nav on every page
**Source of adaptation:** [founders.school/freshman-year](https://founders.school/freshman-year), rebuilt for The 120 (ages 9–16, variable pace, parent audience)
**Design system:** The 120 identity exactly as specified in `design_handoff_the120/README.md` — no new tokens, no new components beyond what's listed in §Layout Notes.

---

## 1. What this page is

The 2026-27 page is the program page for The 120's founding year. For 2026-27 the core program is the Founders track: every enrolled kid runs the entrepreneur path (Sell → Build → Validate → Grow → Scale) at their own pace, anchored by twice-monthly Saturday workshops in Toronto, 20 books, an optional weekly writing habit, and non-negotiable accelerated math.

**SECTION ORDER RULE (Peter, 2026-07-17): this page follows the section order of founders.school/freshman-year exactly, one-to-one.** Hero → Year At A Glance → Who We Develop → Coaching & Mentors → Read Widely, Write Rigorously → The Schedule → The Core Loop → The Skill Stack → The Year In Detail → End Of Year → CTA → Footer. Every section on our page maps to exactly one section on theirs, in the same position. Nothing may be inserted, reordered, or split into a new section; new content must be folded into the section it maps to. (This is why Math has no standalone section in v2: founders.school has none, so Math lives inside Who Students Become, where their academic gate conceptually sits.)

Every claim is rewritten to be honest for 9–16 year olds at variable pace, and the whole page speaks to **parents** ("your child," "they"), consistent with the rest of the120.school. Founders.school speaks to the student; we do not, per Peter's decision 2026-07-17.

What this page is **not**: it carries **no pricing** (the red CTA band routes to Join / Book a Call; Tuition handles money) and it makes **no revenue guarantees**. It coexists with the existing Founders group page (assumption A16 — see appendix).

**Voice rules (apply to all copy below):**

- Parent-facing third person for the child ("your child," "they") and second person for the parent ("you'll see them demo it in November").
- Follow the site's established copy discipline: no em dashes, "group" not "tribe," short declarative sentences.
- Concrete over hyped. Founders.school promises "$50K+ revenue" and "$1M or refund." We promise observable milestones: a real sale to a real customer, a real product, real numbers presented to real parents. Where a dollar figure appears it is small, honest, and framed as a milestone, not a guarantee (assumption A-money, appendix).

---

## 2. Nav + page-level mechanics

- **Nav label:** `2026-27` (mono-styled like the other links; exact string, no "The"). Insert as the **first text link** in the floating nav, before existing links, on every page. Also add to footer link list. (Assumption A13.)
- **Anchor sub-nav on the page:** yes, like founders.school. A slim secondary bar directly under the floating nav, visible only on this page, sticky with it. Mono 11px links separated by `·`, in page order: `THE YEAR · WHO THEY BECOME · COACHING · BOOKS · SCHEDULE · THE LOOP · SKILLS · THE PATH · END OF YEAR`. Light bg `#FFFFFF`, hairline `#E4E2DD` bottom border, radius 14px matching the nav, sits 8px below it. On dark hero it floats with the nav. Smooth scrolling to `id` anchors, matching existing `#groups`/`#how` behavior.
- **Band rhythm** (follows the section order rule; reuses Home's alternation): photo hero → bone (Glance) → white (Become) → bone (Coaching) → blue (Books) → bone (Schedule) → white (Core Loop) → bone (Skills) → blue (Path In Detail) → white (End of Year) → red CTA → blue footer. The two blue "system" bands carry the two densest sections, matching Home's rhythm.
- **Interactions:** the Path detail uses the existing FAQ accordion pattern (single-open, `+`/`−`, first open by default). Book tracks use a three-tab toggle (see §7). No other new behavior.
- **Seats:** the standard seats indicator (`N OF 120 SEATS REMAIN`) appears in the CTA band, driven by the same shared seats value as the rest of the site. 120 is the number for this page (Peter, 2026-07-17).

---

## 3. Section 1 — Hero *(maps to founders.school: Hero)*

**Band:** full-bleed photo hero, min-height 780px, same gradient overlay and bottom-anchored text block as Home. Floating nav + anchor sub-nav on top. Image slot for client photography: ideal shot is a kid mid-pitch or mid-build at a workshop table, adults in soft focus. Blue `#0300ED` shows until a photo is provided. (Assumption A15: photo hero, not type-on-blue.)

**Kicker (mono, blush on photo):** `THE 2026-27 YEAR · FOUNDING COHORT · TORONTO`

**Headline (Georgia 68px, white, italic accent in `#EFC5B8`):**

> The foundation to become *an entrepreneur.*

**Subhead (18px, white 0.85):**

> In one year your child takes real steps toward becoming an entrepreneur: one who reads widely, thinks deeply, builds with AI, and runs a real business. This is the start of the path to founding their own company one day.

*(Adapted from Peter's draft: his hero copy addressed the kid — "you'll take steps" — and contained a typo, "In one you'll." Rewritten to parent voice per the voice decision. Peter's title kept verbatim in meaning; the founders.school original is "The Foundation To Become a Millionaire," which we deliberately do not echo for this age group.)*

**Below subhead (mono, white 0.68):** `PART OF THE 2 HOUR LEARNING NETWORK`

---

## 4. Section 2 — The Year At A Glance (`id="year"`) *(maps to: Year At A Glance)*

**Band:** bone `#F7F6F3`. Kicker `01 · THE YEAR AT A GLANCE`. Georgia 44px headline:

> One year. *At a glance.*

**Layout:** stats grid in the style of founders.school's Year At A Glance, built with the site's card vocabulary: 3×2 grid of white cards (radius 14px, light card shadow, padding 22px 20px), each with a large Georgia numeral/figure (36–44px, ink, the italic accent word in `#D92632`), a 15px semibold label, and a 14px muted description. Peter's six stats, copy finalized:

| Figure | Label | Description |
|---|---|---|
| **20 sessions** | Weekend workshops | In-person workshops on the 1st and 3rd Saturday of every month, September 2026 to June 2027. |
| **5 steps** | The Path | Sell, then Build, then Validate, then Grow, then Scale. Every child moves through the same five steps, at their own pace. |
| **5 × 5** | Pass to move on | Each step has five criteria a child must demonstrate before moving to the next. No seat time, no shortcuts. Proof or you stay. |
| **20 books** | Three reading tracks | A curated year of reading at your child's level: one track for Grades 3–5, one for 6–8, one for 9–12. |
| **40 paragraphs** | The writing habit | Optional but encouraged: one published paragraph a week on what they're reading and building. The start of a personal brand. |
| **3 hrs / week** | Math, no compromise | Math at 2X, 3X, even 4X the normal pace through Math Academy and The Gauntlet. Nobody builds a business on a weak foundation. |

**Right-aligned note under the grid (15px muted):** "20 Saturdays, 20 books, one real business. Book a call or join today."

---

## 5. Section 3 — Who Students Become (`id="become"`) *(maps to: Who We Develop)*

**Band:** white. Kicker `02 · WHO STUDENTS BECOME`. Georgia 44px:

> Thoughtful, *tech-native leaders.*

**Descriptor (17px muted, max-width 620px):**

> The next generation of entrepreneurs will need to think deeply and be native with the latest tools. The 2026-27 year is designed to produce both, without letting either crowd out the other.

**Layout:** three numbered cards in the "Membership is 3 things" style (2px ink top border, mono kicker, 21px semibold title, 15px muted body), followed by a full-width math callout band with a two-row tools card. Copy finalized from Peter's draft, parent voice:

**01 · WELL-GROUNDED ENTREPRENEUR**
"By June your child can sell. They can build with AI. They can read a profit and loss statement. They can run a loop to validate a business idea. And they have enough math and financial literacy under them to set the stage for everything that comes next."

**02 · DEEP THINKER**
"They've read up to 20 books chosen to make them think about life, business, and entrepreneurship at their level. If they've taken on the writing habit, they've published a paragraph or more every week on what they've read and built. They can hold a real discussion, a real one, for their age, about ethics, technology, and the shape of the world."

**03 · AI EXPERT**
"Outside their schoolwork, they treat AI as a co-founder. They've shipped products in days, deployed agents and automations, and used AI on every part of building a business: research, writing, selling, operating. They will never work the old way, because they never learned it."

### Math, no compromise — sub-band within this section

*(Per the section order rule, Math is folded here rather than standing alone; founders.school has no separate math section. This carries the full weight of Peter's "no compromise" requirement plus the two named tools.)*

**Full-width white card, red left border 3px, mono kicker `NO COMPROMISE ON MATH`:**

> "You can't build a sustainable business without a core understanding of math. So the deal is simple: the same math they'd learn in school, at 2X, 3X, 4X the pace, three hours a week, mastery-based so nothing is skipped and no hole is left behind. The gate is real: keeping pace in math is what unlocks the Saturday workshops. If math falls behind, the business work pauses until it's back on track. In practice, kids protect their math hours fiercely, because the workshops are what they refuse to miss."

**Attached tools card (white, radius 14px, two stacked rows with hairline divider):**

**MATH ACADEMY** — mono kicker `THE CURRICULUM` — "Adaptive, mastery-based math that moves exactly as fast as your child does. The engine behind the 2X to 4X pace."

**THE GAUNTLET** — mono kicker `THE SPEED LAYER` — "The 120's own fast-math game: Grade 3 to 12 fact fluency as boss battles and leaderboards. Where math facts get automatic, so the hard stuff gets easier." Small mono link: `PLAY THE GAUNTLET →` (routes to `/gauntlet`).

*(This mirrors founders.school's "academics unlock build time" gate, translated to our workshop structure. Enforcement mechanics stated plainly but without dashboard-level detail; see assumption A-math-gate. Cross-promotes the Gauntlet exactly once, per Peter's "Math Academy + The Gauntlet" decision.)*

---

## 6. Section 4 — Coaching & Mentors (`id="coaching"`) *(maps to: Coaching & Mentors)*

**Band:** bone. Kicker `03 · COACHING`. Georgia 44px:

> An entrepreneur in their corner. *A room full of them.*

**Layout:** 2-col like Home's "How it works": left column headline + intro paragraph; right column stacked rows with hairline dividers (120px/1fr grid).

**Intro (left col):**

> Every Saturday workshop is run by working entrepreneurs, not lecturers. Coaches sit with each child wherever they are on the path: listening to a pitch, reviewing a P&L line by line, asking the questions a real investor would ask, gently, and then less gently as your child levels up.

**Right column rows:**

**YOUR CHILD'S COACH** — "A working operator who knows your child's business by name. Feedback is specific and tied to their numbers, 'you dropped your price twice in four pitches, why?', never generic praise."

**GUEST FOUNDERS** — "Throughout the year, founders and builders from the Toronto community and beyond join workshops to demo, tell the truth about their failures, and take questions. Kids get comfortable in rooms with real operators."

**THE ADVISOR BENCH** — "Behind the coaches sits The 120's advisor network. When a child's business needs something specific, a pricing question, a supply problem, a legal basic, there's an adult who has done it before."

**PARENTS IN THE LOOP** — "You're not guessing. You see the path map, you know which criteria your child has passed, and twice a year you watch them present at an intensive."

*(Deliberately no student:coach ratio and no "20+ fireside chats" count — founders.school claims both; we have no confirmed commitments to publish. Numbers can be added when real. Assumptions A6, A7.)*

---

## 7. Section 5 — Read Widely, Write Rigorously (`id="books"`) *(maps to: Read Widely. Write Rigorously)*

**Band:** blue `#0300ED`. Kicker (blush): `04 · READ WIDELY, WRITE RIGOROUSLY`. Georgia 44px white:

> Twenty books. *Three tracks.*

**Intro (white 0.75):**

> Reading is half of thinking deeply. Every child reads roughly a book every two weeks, drawn from a track matched to their reading level, not just their grade. Each track follows the path: four books per step, mixing business, ingenuity, and the kind of stories that make a kid think about how the world works. Parents get the full list in September.

**Layout:** three-tab toggle (`GRADES 3–5` / `GRADES 6–8` / `GRADES 9–12`), mono 12px tab labels, active tab white bg + ink text, inactive white 0.68 text with `rgba(255,255,255,0.24)` border. Below the tabs, the selected track renders as five groups (one per path step) of four books each — white cards, mono step label, book title in 16px semibold, author in 14px muted. Single shared component, data-driven.

**Full v1 book lists (Peter to edit; chosen to be well-known, in print, and age-appropriate):**

### Track 1 · Grades 3–5

*Sell* — The Lemonade War (Jacqueline Davies) · Lunch Money (Andrew Clements) · Charlotte's Web (E.B. White) · Swindle (Gordon Korman)
*Build* — The Toothpaste Millionaire (Jean Merrill) · The Boy Who Harnessed the Wind, Young Readers Edition (William Kamkwamba) · Frindle (Andrew Clements) · The Wild Robot (Peter Brown)
*Validate* — Mistakes That Worked (Charlotte Foltz Jones) · What Do You Do with an Idea? (Kobi Yamada) · The Westing Game (Ellen Raskin) · Hatchet (Gary Paulsen)
*Grow* — How to Turn $100 into $1,000,000 (McKenna, Glista, Fontaine) · Kid Start-Up (Mark Cuban) · Matilda (Roald Dahl) · Holes (Louis Sachar)
*Scale* — The Phantom Tollbooth (Norton Juster) · Wonder (R.J. Palacio) · Charlie and the Chocolate Factory (Roald Dahl) · Danny the Champion of the World (Roald Dahl)

*(Rationale notes for Peter: Charlotte's Web is filed under Sell on purpose — the "Some Pig" campaign is the best marketing story in children's literature. Mistakes That Worked is validation-by-iteration for 9 year olds. Swindle is knowing what things are worth.)*

### Track 2 · Grades 6–8

*Sell* — How to Win Friends and Influence People (Dale Carnegie) · The Go-Giver (Bob Burg & John David Mann) · Rich Dad Poor Dad for Teens (Robert Kiyosaki) · Better Than a Lemonade Stand (Daryl Bernstein)
*Build* — Steve Jobs: The Man Who Thought Different (Karen Blumenthal) · The Boy Who Harnessed the Wind (William Kamkwamba) · Elon Musk and the Quest for a Fantastic Future, Young Readers Edition (Ashlee Vance) · A Wrinkle in Time (Madeleine L'Engle)
*Validate* — The Martian, Classroom Edition (Andy Weir) · Atomic Habits (James Clear) · Who Moved My Cheese? (Spencer Johnson) · Chew On This (Eric Schlosser & Charles Wilson)
*Grow* — Lawn Boy (Gary Paulsen) · Shoe Dog, Young Readers Edition (Phil Knight) · Start Something That Matters (Blake Mycoskie) · The 7 Habits of Highly Effective Teens (Sean Covey)
*Scale* — Ender's Game (Orson Scott Card) · The Giver (Lois Lowry) · Animal Farm (George Orwell) · The Alchemist (Paulo Coelho)

*(Rationale notes: Lawn Boy is a middle-grade novel about a kid's lawn business scaling out of control — it is the Grow step in 90 pages. The Martian Classroom Edition is iterate-or-die. Chew On This teaches skepticism about marketing claims — validation's twin skill.)*

### Track 3 · Grades 9–12

*Sell* — Never Split the Difference (Chris Voss) · Meditations (Marcus Aurelius) · The War of Art (Steven Pressfield) · Letters from a Self-Made Merchant to His Son (George Horace Lorimer)
*Build* — Zero to One (Peter Thiel) · Shoe Dog (Phil Knight) · Steve Jobs (Walter Isaacson) · Anything You Want (Derek Sivers)
*Validate* — The Lean Startup (Eric Ries) · Thinking in Bets (Annie Duke) · The Goal (Eliyahu Goldratt) · The Richest Man in Babylon (George S. Clason)
*Grow* — The Psychology of Money (Morgan Housel) · Rework (Jason Fried & David Heinemeier Hansson) · Man's Search for Meaning (Viktor Frankl) · The E-Myth Revisited (Michael E. Gerber)
*Scale* — The Prince (Niccolò Machiavelli) · The Autobiography of Benjamin Franklin · The Almanack of Naval Ravikant (Eric Jorgenson) · Sapiens (Yuval Noah Harari)

*(The 9–12 track deliberately overlaps founders.school's list where the books are right — Voss, Thiel, Goldratt, Duke, Clason, Machiavelli, Franklin — and swaps their heaviest picks (Antifragile, The Beginning of Infinity, The Fountainhead, Free to Choose) for equally famous but more attemptable books for a 14–16 year old reading two a month alongside a business.)*

### The writing habit — sub-band within this section

White card strip at the bottom of the blue band, mono kicker `40 PARAGRAPHS · OPTIONAL, BUT`:

> One paragraph a week, published, on what they're reading and building. Forty by June. It's optional, and it's the single best predictor of the kids who go furthest: the habit of thinking in public is the habit of building a brand. Coaches read everything and the best paragraphs get read aloud at workshops.

*(Publishing platform intentionally unspecified on the page — see assumption A11.)*

---

## 8. Section 6 — The Schedule (`id="schedule"`) *(maps to: The Schedule)*

**Band:** bone. Kicker `05 · THE SCHEDULE`. Georgia 44px:

> Year. Month. Week. *How it all fits.*

**Layout:** three stacked zoom levels (Year → Month → Week), each a horizontal card row, mirroring founders.school's Year/Week/Day zoom but at the cadences that fit our structure (Peter's draft: "Year, Month, Week"). His Section 4 was cut off after item 1; items below are proposed (assumption A1).

### The Year

> Twenty in-person workshops, September 2026 to June 2027, on the 1st and 3rd Saturday of every month. Each workshop runs twice, 9 am to 12 pm and 12 pm to 3 pm, same session both times, so families attend whichever fits their weekend. Plus the Toronto intensives, where kids demo their businesses on stage.

**Date strip (mono, 12px, wrapping grid of 20 pills):**
SEP 5 · SEP 19 · OCT 3 · OCT 17 · NOV 7★ · NOV 21 · DEC 5 · DEC 19 · JAN 2† · JAN 16 · FEB 6 · FEB 20 · MAR 6 · MAR 20 · APR 3 · APR 17 · MAY 1 · MAY 15 · JUN 5 · JUN 19

- ★ **Nov 7 collides with the Fall Intensive (Nov 7–8, 2026).** Recommendation: workshop #5 *is* the intensive — kids demo instead of a regular session, billed on the page as "Workshop 5 = Fall Intensive demo day." Peter to confirm.
- † **Jan 2 is New Year's weekend.** Recommendation: shift to Jan 9 and footnote "one January date shifts for the holiday." Peter to confirm.
- Note: Mar 20 lands the Saturday after Ontario March break — kept, flagged for awareness.
- The page itself should show the date strip (concrete dates sell seriousness); the two footnoted adjustments resolve before build. (Assumption A4: dates shown.)

### The Month

> Two Saturdays at the workshop: demo what you built, pass criteria with your coach, sell to the room, plan the next two weeks. In between, the business runs at home, with parents as the first customers, chauffeurs, and board of directors.

### The Week

> The at-home rhythm, most weeks: three hours of math, a book on the go (about one every two weeks), one published paragraph if they're on the writing habit, and whatever hours the business demands, which, be warned, kids stop calling homework.

*(Venue intentionally "in Toronto" without a named address until confirmed — assumption A2. Summer 2027 not addressed on the page — assumption A5.)*

---

## 9. Section 7 — The Core Loop (`id="loop"`) *(maps to: The Core Loop)*

**Band:** white. Kicker `06 · THE CORE LOOP · EXPERTISE → AUDIENCE → PRODUCT`. Georgia 44px:

> The loop that *compounds.*

**Intro (17px muted, max-width 640px):**

> Every lasting entrepreneur runs the same loop, whether they're 11 or 40. Get genuinely good at something. Share what you're learning until people pay attention. Build what those people ask for. Then go around again, one level up. Most adults never learn this loop. Your child will run it all year.

**Layout:** three numbered cards, same component as Who Students Become (2px ink top border, mono kicker, 21px semibold title, 15px muted body), with small mono arrows between cards on desktop (`→` in `#D92632`) and a loop-back arrow from card 03 to card 01. Closing line full-width below.

**01 · EXPERTISE — Get good at something real.**
"The loop starts with knowing something worth knowing. Your child picks a domain they already care about, sneakers, baking, Minecraft servers, dog training, it truly doesn't matter, and goes deep: the reading track, the math, and the workshops all feed it. Kids don't need credentials to become experts. They need obsession plus structure, and they have more spare obsession than any adult you know."

**02 · AUDIENCE — Share it until people listen.**
"This is what the writing habit is really for. One published paragraph a week on what they're learning isn't a school assignment, it's how a young person earns trust: people believe the kid who teaches what they know. Their first audience is small and safe, the cohort, the neighbors, your own network. It grows from there, at your pace and with your supervision."

**03 · PRODUCT — Build what the audience asks for.**
"Here's the secret most first-time founders miss: when you know a subject and people already listen to you about it, you don't have to guess what to build. The audience tells you. Products built this way sell easier, because the trust arrived before the pitch did. This is where the Path, Sell through Scale, plugs in."

**Closing line (full-width, below the cards, 17px):**

> Around the loop again, and again. Each pass makes the next one easier: deeper expertise, a warmer audience, a better product. This is why reading, writing, math and business aren't four separate subjects at The 120. They're one loop, and it's the same loop that will protect your child's career in the age of AI: knowledge that's theirs, people who trust them, and real things they've built to prove it.

*(The closing line doubles as the parent-goals appeal; no separate "why this matters" paragraph needed.)*

---

## 10. Section 8 — The Skill Track (`id="skills"`) *(maps to: The Skill Stack)*

**Band:** bone. Kicker `07 · THE SKILL TRACK`. Georgia 44px:

> Fifteen skills. *Tracked all year.*

**Intro:**

> Underneath the path, coaches track fifteen skills in three pillars. Every child, at every step, is developing all fifteen; the path just changes which ones are under the spotlight. Parents see the skill map at intensives.

**Layout:** three columns (2px ink top border style), one per pillar, five mono-numbered skills each; below, a 4-column strip for the assessment scale. Skills adapted from founders.school for 9–16 (same pillar structure, kid-appropriate names):

**LIFE** — 01 Integrity & Humility · 02 Courage & Discipline · 03 Agency & Ambition · 04 Communication · 05 Leadership & Social Intelligence

**ENTREPRENEURSHIP** — 01 Selling · 02 Building · 03 Rapid Iteration · 04 Financial Thinking · 05 Knowing Your Domain

**AI** — 01 AI as Thinking Partner · 02 AI-Augmented Building · 03 AI Tool Literacy · 04 Agents & Automation · 05 AI Judgment & Ethics

**Assessment scale strip (4 cards, mono numerals):**

1. **STARTING** — "Aware of the skill, first attempts."
2. **PRACTICING** — "Applying it with a coach's support."
3. **SOLID** — "Delivers consistently without help."
4. **COULD TEACH IT** — "Coaches other kids. The bar."

---

## 11. Section 9 — The Path In Detail (`id="path"`) *(maps to: The Year In Detail)*

Founders.school closes its page body with the five expandable session breakdowns; ours does the same, with the pacing model explained here. This is the biggest structural divergence in content (not position): their five sessions are fixed 8-week blocks; our five steps are **paced by mastery, not by calendar**. The section must make "go at your own pace" feel rigorous, not loose — the 5×5 pass criteria are what carry that.

**Band:** blue `#0300ED` (the "system" band, like Home's five-groups band). Kicker (blush): `08 · THE PATH · SELL → BUILD → VALIDATE → GROW → SCALE`. Georgia 44px, white, blush italic:

> Five steps. *At your child's pace.*

**Intro paragraph (17px, white 0.75, max-width 640px):**

> Every child in the 2026-27 cohort walks the same path: Sell, Build, Validate, Grow, Scale. But unlike school, nobody moves on a bell schedule. Each step has five criteria, real things your child must do and demonstrate, not attend and absorb. A nine year old might spend the whole year mastering Sell and Build. A motivated fourteen year old might reach Scale by spring. Both are winning. The only way to fail the path is to fake it.

**Path diagram:** horizontal 5-node stepper across the band. Each node: bone `#F7F6F3` circle (48px) containing the step number in mono, connected by 2px `rgba(255,255,255,0.24)` hairlines with a small `→`; step name below in Georgia 26px white. On mobile this stacks vertically (see §Responsive).

**How pacing works (3 short cards, bone bg, matching Home's group-card style):**

1. **PASS FIVE, MOVE ON** — "Each step has five pass criteria. Your child demonstrates each one to their coach at a Saturday workshop. Five checks, and they step forward."
2. **STUCK IS NORMAL** — "Some criteria take one Saturday. Some take five. Coaches work with whatever step each child is on, every session. Nobody is left behind and nobody is held back."
3. **FINISH EARLY, GO DEEPER** — "A child who completes all five steps before June doesn't stop. They run their business at Scale, mentor kids earlier on the path, and preview what next year holds."

### The five steps — accordion (`id="path-detail"`)

Reuses the FAQ accordion component (single-open, `+`/`−`, first open by default), restyled on white cards within the blue band. Each item: mono kicker `STEP 01 · SELL`, Georgia 28px title, one-line principle, then the five pass criteria as a numbered list, then a one-line "what parents see."

**Full draft copy — the 25 pass criteria (v1 for Peter's edit):**

**Step 01 · Sell — Learn to confidently sell anything.**
Principle: "Entrepreneurship starts with a stranger saying yes. Before your child builds anything, they learn to sell something."

1. Pitch a product in 60 seconds to an adult who isn't family, without notes.
2. Make a real sale: a real customer, real money changing hands.
3. Hear "no" at least three times and log what each no taught them.
4. Explain cost, price, and profit for their product on one page.
5. Complete 25 supervised outreach attempts: a booth, door to door, calls, or messages.

*What parents see:* "Your child pitches you, then pitches strangers. The first sale usually happens faster than either of you expect."

**Step 02 · Build — Make a real product with AI.**
Principle: "Your child stops being a user of technology and becomes a builder with it."

1. Ship a working product, site, or offer built with AI tools in under two weeks.
2. Demo it live at a Saturday workshop.
3. Show the prompts and instructions they gave the AI, and explain what the AI did and what they did.
4. Ship a v2 that responds to feedback from at least three real users.
5. Keep a build log: what they tried, what broke, what they fixed.

*What parents see:* "A link you can open. A thing that works. Built by your kid, with an AI co-founder, in days not months."

**Step 03 · Validate — Test ideas like a scientist.**
Principle: "Most business ideas are wrong. The skill is finding out fast and cheap."

1. Write a testable guess: 'X people will pay $Y for Z.'
2. Design and run a test of that guess in two weeks or less.
3. Talk to 10 potential customers and record what they actually said.
4. Kill or change an idea based on evidence, and explain the decision to the group.
5. Run the full loop twice: guess, test, learn, adjust.

*What parents see:* "Your child stops defending ideas and starts testing them. This is the step where they learn to love being wrong quickly."

**Step 04 · Grow — Turn a validated idea into a running business.**
Principle: "One sale is a story. Repeat sales are a business."

1. Earn repeat revenue: a second sale, or a customer who comes back.
2. Track a simple profit and loss statement for four consecutive weeks.
3. Double one number that matters, customers, revenue, or audience, and show how they did it.
4. Win at least one customer through something they published.
5. Present their numbers to the cohort the way a founder presents to a board.

*What parents see:* "A kid who can read their own P&L and tell you which week was best and why. Most adults can't."

**Step 05 · Scale — Build systems so the business runs beyond them.**
Principle: "The final step is the founder's step: making the business bigger than one person's hours."

1. Automate one real part of the business with an AI agent or automation, and show it running.
2. Delegate a task, to a friend, a sibling, or an AI agent, with written instructions that worked.
3. Keep the business serving customers through a week they took off.
4. Write the one-page playbook someone else could use to run it.
5. Pitch what the business becomes next year, on stage, at an intensive.

*What parents see:* "The end state of year one: a child who owns a small machine, not a chore. That's the founder's mindset, at whatever size."

---

## 12. Section 10 — End of Year (`id="end"`) *(maps to: End Of Year)*

**Band:** white. Kicker `09 · JUNE 2027`. Georgia 44px:

> By June, *they've actually done it.*

**Intro:**

> Not "learned about." Done. Wherever your child lands on the path by June 2027, here is what's true of every single kid who does the year:

**Checklist grid (2×3 white cards, Georgia figures like §4):**

- **A real sale** — to a real customer, real money. Every child clears this in the Sell step.
- **A real product** — built with AI, shipped, demoed live, improved from feedback.
- **Real numbers** — weeks of their own P&L data they can read and explain.
- **Up to 20 books** — read and discussed, at their level, chosen to make them think.
- **A stage moment** — at least one intensive demo in front of the cohort and parents.
- **A tested mind** — at least one idea they killed themselves, with evidence, and were proud of it.

**Moving on (short paragraph, no advancement-gate hard sell):**

> The path doesn't reset in June. Wherever your child finishes, year two of The 120 picks up exactly there: a child mid-Validate resumes at Validate; a child who reached Scale starts the year running a real business and mentoring the next cohort. Progress is the only currency.

*(Founders.school ends with a three-part advancement gate including peer voting on every classmate. Deliberately not adapted: peer-vote elimination mechanics read as harsh for 9–16 and for a parent audience. If Peter wants an advancement ritual, propose "end-of-year defense" only, framed as a celebration demo. Assumption A-advance.)*

---

## 13. Section 11 — CTA band + footer *(maps to: CTA + Footer)*

**Band:** red `#D92632`, identical structure to Home's CTA band. Centered Georgia 52px white:

> One year. One real business. *One of 120.*

**Subline (white 0.85):** "The founding cohort starts September 5, 2026. Seats are 120, and they're going."

**Buttons:** white-filled `JOIN THE 120` (ink text) + bordered `BOOK A CALL`. Seats indicator beneath (shared seats value). No pricing anywhere on the page (Peter, 2026-07-17); Tuition remains one nav click away.

**Footer:** standard blue footer, unchanged, with `2026-27` added to the link list.

---

## 14. Layout notes, responsive, and build notes

- **Everything reuses existing tokens and components** from the design handoff: colors, type scale, mono kickers, card radii/shadows, CTA styles, seats indicator, FAQ accordion, 1240px content width, 80–96px section padding. New assemblies (not new primitives): the 5-node path stepper, the 3-tab book-track toggle, the 20-pill date strip, the Core Loop arrow row, the anchor sub-nav.
- **Responsive:** as with the rest of the site, desktop is designed and mobile stacking is the builder's job. Specific notes: path stepper becomes vertical with left-rail connectors; stats grid 3×2 → 1-col; book tracks keep tabs, cards stack; date strip wraps naturally; Core Loop arrows rotate to vertical between stacked cards; anchor sub-nav horizontally scrolls.
- **Accordion default:** Step 01 · Sell open on load.
- **Data-driven content:** book lists, pass criteria, and workshop dates should live in a data file (same pattern as `gt-workshops-data.js`) so Peter's edits don't touch markup.
- **SEO/meta:** title "The 2026-27 Year · The 120"; description drawn from the hero subhead.
- **Image slots:** hero (1), coaching section optional inline slot (1). Same `image-slot` placeholder pattern.

---

## 15. Appendix — every assumption Peter can veto

Decisions Peter made (locked): parent voice throughout · Founders track is the core 2026-27 program · adapt all founders.school sections incl. skill track · **section order mirrors founders.school/freshman-year exactly (2026-07-17)** · full draft copy incl. criteria and book lists · Core Loop section adapted as Expertise → Audience → Product (2026-07-17) · Math Academy + The Gauntlet named · no pricing on page · 120 seats.

Proposed by Claude, awaiting veto (numbers match the question list from chat):

- **A1 (Q1):** Section 4's cut-off items drafted as Month = two-Saturday cadence + at-home rhythm; Week = 3 hrs math / reading / paragraph / business time.
- **A2 (Q2):** venue stated as "in Toronto," no address.
- **A3 (Q3):** intensives appear on the page as demo-day stage moments; Fall Intensive proposed to absorb the Nov 7 workshop.
- **A4 (Q4):** the 20 actual dates are shown, with Jan 2 → Jan 9 shift proposed.
- **A5 (Q5):** summer 2027 not mentioned.
- **A6/A7 (Q6–7):** no coach ratio and no guest-founder count published; sections written to be true with zero confirmed commitments.
- **A8 (Q8):** criteria are signed off by the child's coach at Saturday workshops.
- **A9 (Q9):** workshops serve mixed steps in one room (coaches meet each child at their step); no step-themed sessions.
- **A10 (Q10):** early finishers go deeper + mentor; no "you're done" state.
- **A11 (Q11):** publishing platform for the 40 paragraphs unspecified on-page.
- **A12 (Q12):** tracks chosen by reading level ("not just grade"); books mapped 4 per path step.
- **A13 (Q13):** nav label `2026-27`, first text link, plus footer link.
- **A14 (Q14):** sticky anchor sub-nav included, links in page order.
- **A15 (Q15):** photo hero (like Home), not type-on-blue.
- **A16 (Q16):** page coexists with The Founders group page; group page should gain a "SEE THE 2026-27 YEAR →" mono link.
- **A17 (Q17):** audience phrased as "ages 9–16" via the three grade-band tracks (3–5 / 6–8 / 9–12); the site's "grades 3–8" claim will need reconciling later, per Peter's "I'll change the website after this piece works."
- **A18 (Q18):** no guarantee/refund analog. Founders.school's "$1M or refund" has no honest equivalent here.
- **A19 (Q19):** AI stays generic on-page ("AI tools," "agents"); no vendor names.
- **A20 (Q20):** skill track kept at 15 skills / 3 pillars; scale renamed Starting / Practicing / Solid / Could Teach It.
- **A-money:** no revenue targets or dollar-figure promises anywhere. The honest, checkable claims are "a real sale, real money" (Sell), "repeat revenue" (Grow), and "a business that ran without them for a week" (Scale). If Peter wants a number, the safest is a milestone framing such as "most kids earn their first $100 before winter break", only if we believe it.
- **A-math-gate:** the math gate is stated plainly ("workshops unlock; business work pauses") without specifying the tracking mechanism. Math is folded into Who Students Become per the section order rule, not a standalone section.
- **A-advance:** founders.school's peer-voting advancement gate dropped; June framed as "the path picks up where it left off."
- **A-loop:** the Core Loop's three domains are illustrated with kid-relatable examples (sneakers, baking, Minecraft servers, dog training); audience-building is framed as parent-supervised and starting with the cohort and family network. Domain examples are placeholders Peter can swap.
