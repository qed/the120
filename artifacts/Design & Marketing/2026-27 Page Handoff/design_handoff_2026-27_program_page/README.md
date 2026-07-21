# Handoff: The 2026-27 Program Page (`/2026-27`)

## Overview
A public marketing/recruitment page for **The 120** (the120.school) describing the 2026-27 founding-year program. It adapts the founders.school "freshman year" structure for kids ages 9–16, at variable pace, and speaks to **parents** by default. The page has two cross-cutting interactive layers: an **audience toggle** (Parents ↔ Kids) that rewrites all copy, and a **group selector** in the hero that personalizes the hero subhead for each of The 120's five groups. Everything below the hero is written Founders-first as the worked example.

## About the Design Files
The files in this bundle are **design references created in HTML** — a working prototype showing intended look and behavior. They are **not production code to copy directly**. The task is to **recreate this design in the target codebase's environment** (React/Next.js, Vue, etc.) using its established components, patterns, and libraries. If no environment exists yet, pick the most appropriate framework and implement there.

The prototype is authored as a "Design Component" (`.dc.html`) — a single streaming HTML file with an embedded template and a logic class. Treat the template as the markup structure and the logic class as the state/behavior spec; both are documented below so you do not need to reverse-engineer the runtime.

The 120 already has a design system (tokens + React components under `The120DesignSystem_cdb8b7`). **Use the existing design system in the real codebase** — the tokens and components here mirror it (Wordmark, Button, SeatsDot, Kicker, DisplayHeading, FaqItem, etc.).

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, copy, and interactions. Recreate pixel-faithfully using the codebase's existing 120 design-system primitives. Exact hex values, type roles, and spacing are listed under Design Tokens.

---

## Global Chrome

### Sticky header (floats over the hero)
Two stacked cards, `position: sticky; top: 18px`, max-width 1240, side padding via a 20px gutter. The hero is pulled up under it with `margin-top: -136px`.

1. **Nav bar** — white card, radius 14, shadow `0 4px 18px rgba(19,20,22,0.14)`, padding `11px 22px`, space-between:
   - Left: **Wordmark** (red "120" chip + "The 120" / "TORONTO" sublabel).
   - Right: text links `2026-27` (active, red, 600), `The Gauntlet`, `Tuition`, `FAQ` (14px, ink); then two buttons — ghost **{callCta}** and primary red **{joinCta}** (mono uppercase labels; labels change with audience — see below).
2. **Anchor sub-nav** — white card, radius 14, 1px `#e4e2dd` border, 8px below the nav. A centered, horizontally-scrolling row of mono 11px links (label text only, no numbers) joined by `·`: `THE YEAR · WHO THEY BECOME · COACHING · BOOKS · SCHEDULE · THE LOOP · SKILLS · THE PATH · MATH · END OF YEAR` (anchors: `#year #become #coaching #books #schedule #loop #skills #path #math #end`; built from a `NAV` array). A **scroll-spy** sets the current section's link to red/600 as you scroll (default active = `THE YEAR`); all others are ink-soft/400. On the **right, pinned**, a pill segmented control: **PARENTS | KIDS** (the audience toggle). Active segment = ink fill / white text; inactive = transparent / ink-soft. Anchor jumps are instant (the brand deliberately avoids smooth-scroll).

---

## Sections (in DOM order)

All sections: max-width 1240, side padding 44px (24px ≤920, via responsive rules), vertical padding 88px (56px ≤600). Band background alternates to never repeat adjacent: bone → white → bone → white → bone(schedule) → white(loop) → bone(skills) → **blue(path)** → bone(math) → white(end) → **red(CTA)** → **blue(footer)**.

Every section opens with a numbered mono kicker (red on light, blush on dark) and a Georgia headline with one *italic accent phrase* (red on light, blush on dark).

### Hero (`<section>`, photo/blue, min-height 780)
Full-bleed. Layers bottom→top: solid `--blue` fallback → **image slot** (user-fillable hero photo) → protection gradient `linear-gradient(rgba(19,20,22,.18) 0%, rgba(19,20,22,0) 30%, rgba(19,20,22,.02) 55%, rgba(19,20,22,.78) 100%)` → text block (`pointer-events:none` so the slot stays droppable; the group control re-enables `pointer-events:auto`). The text block is **vertically centered** in the section: the `<section>` is `display:flex; flex-direction:column; justify-content:center; box-sizing:border-box; padding-top:136px` (the padding-top offsets the sticky-header overlap so the content is optically centered in the visible band between the sub-nav and the section bottom); the text block itself uses `padding: 0 44px`.
- **Group segmented control**: pills `The 120` + `Athletes` `Founders` `Givers` `Makers` `Scholars`. Active = blush fill/ink; inactive = transparent, white text, `rgba(255,255,255,.32)` border. Default selected = `The 120`.
- **Kicker** (blush): `THE 2026-27 YEAR · FIVE GROUPS · ONE PROGRAM`
- **Headline** (Georgia 68, white; ≤920→46, ≤600→36) — **each sentence on its own line** (the blush accent is `display:block`): line 1 `The 2026-27 year.`, line 2 (blush italic) `Your business.`
- **Subhead** (18, full white, max-width 760, **3px blush left accent rule + 18px padding-left** for legibility over the photo): the **group business line** — swaps with the selector (see Group selector). Default (`The 120`): "Athletes, Founders, Givers, Makers and Scholars each build a business: NIL brands, startups, service ventures, shows, research. Same program, your business."
- **Note** (mono 11, white .68): "The program is to learn how to build a business - you adapt the plan to your business."

### 01 · The Year at a glance (bone)
Kicker `01 · THE YEAR AT A GLANCE`. Headline `One year.` + red italic `At a glance.` 3×2 grid (≤920→2col, ≤600→1col) of white cards (radius 14, shadow `0 2px 14px rgba(19,20,22,.06)`, padding `24px 22px`): a Georgia 40 figure with a red italic accent word, a 15/600 label, a 14 muted description. The six cards (figure / label / description):
1. `20 sessions` / Weekend workshops / "In-person workshops on the 1st and 3rd Saturday of every month, September 2026 to June 2027."
2. `5 phases` / The Path / "Sell, then Build, then Validate, then Grow, then Scale. Every child moves through the same five phases, at their own pace."
3. `5 × 5` / Pass to move on / "Each phase has five criteria a child must demonstrate before moving to the next. No seat time, no shortcuts. Proof or you stay."
4. `20 books` / Three reading tracks / "A curated year of reading at your child's level: one track for Grades 3–5, one for 6–8, one for 9–12."
5. `40 paragraphs` / The writing habit / "Optional but encouraged: one published paragraph a week on what they're reading and building. The start of a personal brand."
6. `2X, 3X or 4X speed` (Georgia **34**, so the longer figure fits one line) / **Learn math to run the numbers** / "Knowing math means you know the health of your business. Catch up, reach ahead, or get solid through Math Academy and The Gauntlet."
Right-aligned muted note beneath: "20 Saturdays, 20 books, one real business. Book a call or join today." (These are the **Parents** strings; Kids equivalents are in the Copy Appendix.)

### 02 · Who they become (white)
Kicker `02 · WHO THEY BECOME`. Headline `Thoughtful,` + red italic `tech-native leaders.` Intro (17 muted, max 620). Three numbered cards with a 2px ink top border (mono kicker + 15 muted body). Then a full-width **math callout**: white card, 3px red left border, mono kicker `NO COMPROMISE ON MATH`, 18px body.

### 03 · Coaching (bone)
Kicker `03 · COACHING`. Headline `An entrepreneur in their corner.` + red italic `A room full of them.` Two-column (`1fr 1.1fr`, gap 56; stacks ≤920): left = intro paragraph + an **image slot** (radius 18, min-height 280); right = 4 rows on a `168px 1fr` grid with hairline dividers (mono red row label + 15 muted body).

### 04 · Read widely (white)
Kicker `04 · READ WIDELY`. Headline `Twenty books.` + red italic `Three tracks.` Intro. **Three-tab toggle** (`GRADES 3–5` / `6–8` / `9–12`): active = ink fill/white; inactive = transparent/ink-soft w/ `--line-strong` border. Below, a 5-column grid (≤920→3, ≤600→2), one column per Path phase: mono red phase label + four book cards (bone, 1px `--line`, radius 12; 16/600 title + 14 muted author). Then a **writing-habit strip** (bone card, 1px border): mono kicker `40 WRITING EFFORTS · OPTIONAL` + 17 body.

### 05 · The Schedule (bone)
Kicker `05 · THE SCHEDULE`. Headline `Year. Month. Week.` + red italic `How it all fits.` Three stacked white cards:
- **THE YEAR**: paragraph, then the 20-date strip grouped into three hairline-separated blocks — `FALL 2026`, `WINTER 2027`, `SPRING 2027` — each a 4-column grid of mono pills. Pill states: normal (bone, `--line` border), **Demo Day** (`★`, darker `--line-strong` fill), **kickoff** (red fill/white + `KICKOFF` tag on Sep 19), **special/TBD** (dashed border, muted). Note lines beneath.
- **THE MONTH**: two labelled bullet clusters (`AT THE WORKSHOP · TWO SATURDAYS` with red-dot bullets; `AT HOME · IN BETWEEN` with ink-dot bullets).
- **THE WEEK**: `THE AT-HOME RHYTHM · MOST WEEKS` — 2×2 red-dot bullets, then a Georgia italic 20px closing line with a red accent clause.

### 06 · The Core Loop (white)
Kicker `06 · THE CORE LOOP · EXPERTISE → AUDIENCE → PRODUCT`. Headline `The loop that` + red italic `compounds.` Intro. Three numbered cards (2px ink top border; mono kicker + 21/600 title + 15 muted body): EXPERTISE / AUDIENCE / PRODUCT. Closing paragraph (max 900).

### 07 · The Skill Track (bone)
Kicker `07 · THE SKILL TRACK`. Headline `Fifteen skills.` + red italic `Tracked all year.` Intro. Three pillar columns (2px ink top border) — LIFE, ENTREPRENEURSHIP, AI — each five mono-numbered (`01`–`05`) skills. Then a 4-column strip of level cards (`LEVEL 1`–`LEVEL 4`): mono level label, mono 15/600 title (`STARTING` / `PRACTICING` / `SOLID` / `COULD TEACH IT`), 14 muted desc. Level 4 card gets a 1px red border and red label/title.

### 08 · The Path (BLUE statement band)
Kicker (blush) `08 · THE PATH · SELL → BUILD → VALIDATE → GROW → SCALE`. Headline (white) `Five Phases.` + blush italic `At your pace.` Intro (white .75, max 760).
- **5-node stepper**: bone 48px circles with a mono number, a Georgia 22 white name below, `→` connectors (`rgba(255,255,255,.4)`). Stacks vertically ≤920 (arrows hidden).
- **3 pacing cards** (bone on blue): mono red title (`PASS FIVE, MOVE ON` / `STUCK IS NORMAL` / `FINISH EARLY, GO DEEPER`) + body.
- **Kids-only criteria sub-toggle** (shows only in Kids audience): mono `PASS CRITERIA` label + pill toggle `KID VOICE | ORIGINAL` (active = white/ink; inactive = transparent/white).
- **Accordion** (single-open, `+`/`−`, first item open by default): white cards. Header = mono red `PHASE 0N · KEY` + Georgia 28 title + 15 muted subtitle. Open body = italic principle, a numbered criteria list (5 items, hairline dividers, mono red index), then a mono muted label (`WHAT PARENTS SEE` / kids `WHAT YOU'LL PULL OFF`) + italic line.

### 09 · The Foundation / Math (bone)
Kicker `09 · THE FOUNDATION`. Headline `Math at` + red italic `2X, 3X, 4X` + ` speed.` Two-column (`1.15fr 0.85fr`, stacks ≤920): left = three paragraphs; right = white card with two hairline-divided rows (`THE CURRICULUM` → Math Academy; `THE SPEED LAYER` → The Gauntlet), each a mono muted label + 21/600 name + 15 muted desc.

### 10 · End of Year (white)
Kicker `10 · END OF YEAR`. Headline `By June,` + red italic `they've actually done it.` Intro. 3×2 grid of bone cards (Georgia 26 figure with red italic accent + 15 muted desc): A real *sale* / A real *product* / Real *numbers* / Up to *20 books* / A *stage moment* / A *tested mind*. Closing paragraph (max 760).

### CTA band (RED)
Centered. Georgia 52 white (≤920→40, ≤600→32): `One year. One real business.` + blush italic `One of 120.` Two-line subline (white .85). Buttons: white-filled **{joinCta}** + white-bordered **{callCta}**. **SeatsDot** beneath (blush dot + `113 OF 120 SEATS REMAIN`, mono, white-soft).

### Footer (BLUE)
Wordmark (light) + link row (`2026-27`, The groups, Parents, Tuition, FAQ, Sign in) + hairline rule + legal line: "© 2026 The 120 · A learning centre. Not an accredited school. TIN CAN is a trademark of Tin Can Untechnologies, Inc."

---

## Interactions & Behavior

- **Audience toggle (Parents ↔ Kids)** — the PARENTS/KIDS control in the sub-nav swaps **every readable string** on the page from a copy dictionary keyed by audience (`COPY.parents` / `COPY.kids`). Kids copy is second-person and follows a tone journey: hyped/playful in the hero, easing to cool/respectful by the end. Default = **parents**; not persisted (resets on reload). Also swaps the two CTA button labels (`Join the 120`/`Book a call` → `Get my seat`/`Show my parents`) and, in the accordion, the "what parents see" label and the step subtitle/principle/one-liner.
- **Group selector (hero)** — `The 120` + 5 group pills. Selecting a group swaps **only the hero subhead** to that group's business line; `The 120` shows the combined overview. **Nothing else on the page changes** — the body stays Founders-flavored (that is what the hero note explains). Default = `The 120`. Independent of the audience toggle. The exact subhead per selection:
  - **The 120** (default): "Athletes, Founders, Givers, Makers and Scholars each build a business: NIL brands, startups, service ventures, shows, research. Same program, your business."
  - **Athletes**: "Athletes build an NIL business: your name, image, and likeness turned into a personal brand and real sponsorships."
  - **Founders**: "Founders build a real startup: a product built with AI, real paying customers, and real revenue that grows month over month."
  - **Givers**: "Givers build a service venture: raising real money and real awareness for a cause in their community, and rallying people to turn up."
  - **Makers**: "Makers build a showcase business: an art exhibition, a theatre production, or a concert that puts their work in front of an audience."
  - **Scholars**: "Scholars build a research venture: finding funding for a science project and building a following for their scholarly work."
  These group lines are single-voice (they do not change with the Parents/Kids toggle).
- **Kids-only criteria sub-toggle (Path)** — visible only when audience = Kids. `KID VOICE` (default) shows kid-worded pass criteria; `ORIGINAL` shows the original/adult criteria. Parents view always shows the original criteria and hides this control.
- **Book track tabs** — switch which grade track's 5×4 book grid is shown. Default = first track (Grades 3–5). Book titles are identical across audiences.
- **Path accordion** — single-open; clicking a header opens it and closes the rest; `+`/`−` sign; Phase 01 open on load.
- **Anchor sub-nav + scroll-spy** — plain `#id` jumps (instant, no smooth-scroll); sections have `scroll-margin-top: 152px` to clear the sticky header. A `scroll` listener tracks which section top has passed `scrollY + 170` and highlights that link red/600 (all others ink-soft/400). No link numbering and no group dividers — the active-red state is the sole wayfinding device.
- **Hover/press** — links ink→red (light) / bone→blush (dark); buttons darken/brighten and lift ~1px; `prefers-reduced-motion` respected. Transitions are short ease-out (`.2s cubic-bezier(.2,.8,.3,1)`).
- **Responsive** — desktop-first. Breakpoints at 920px and 600px collapse the multi-column grids (3→2→1, 5→3→2, two-col→1), stack the Path stepper vertically, hide secondary nav links, and scale the hero/CTA headlines down.

## State Management
Component state:
- `audience`: `'parents' | 'kids'` (default `'parents'`)
- `groupSel`: `'all' | 'athletes' | 'founders' | 'givers' | 'makers' | 'scholars'` (default `'all'`)
- `pathOpen`: number — open accordion index, `-1` = none (default `0`)
- `bookTrack`: number — selected track index (default `0`)
- `kidOriginal`: boolean — Kids criteria showing original wording (default `false`)
- `data`: content loaded async from `program-data.js` (dates, path phases + kid variants, book tracks)

Copy for both audiences is embedded in the component as a `COPY` object so it renders synchronously (no blank flash). Repeated/edit-prone content (workshop dates, the 25 pass criteria + kid versions, book lists) lives in `program-data.js` so non-devs can edit without touching markup. In the real codebase, model these as a copy/i18n map + a content data module.

## Design Tokens
Colors: `--paper #f7f6f3`, `--paper-2 #efece6`, `--white #ffffff`, `--ink #131416`, `--ink-soft #55585e`, `--muted #9fa2a7`, `--line #e4e2dd`, `--line-strong #d8d5cf`, `--red #d92632`, `--red-dark #b31d28`, `--red-bright #e8404b`, `--blush #efc5b8`, `--blue #0300ed`, `--blue-dark #0200bd`.
Type: **Georgia** (display headlines, weight 400, tracking −0.01em, line-height ~1.08, italic accent word); **Space Grotesk** (all UI/body/numerals, 15–19px, line-height 1.6); **IBM Plex Mono** (kickers/labels/pills/CTA labels, uppercase, tracking 0.06–0.12em). Scale: hero 68 · CTA 52 · section 44 · card/accordion 26–28 · body 17 · UI 15 · small 13–14 · mono kicker 12 · mono label 11 · mono micro 9–10.
Radius: 10 button · 12 CRM/book card · 14 nav + marketing card · 18 image slot · 100 pill/chip.
Shadow: card `0 2px 14px rgba(19,20,22,.06)` · nav `0 4px 18px rgba(19,20,22,.14)`.
Spacing/layout: content max 1240 · side pad 44 (24 on mobile) · section pad 88 (56 mobile) · hero min-height 780.
Motion: ease `cubic-bezier(.2,.8,.3,1)`, dur .2s; 1px hover lift; no bounces/parallax.
Iconography: typographic — `→` (only glyph, on CTAs/steppers), `·` separators, `★` demo-day marker, red dot/pips; no icon library. Brand mark = the Wordmark component (type, no SVG logo).

## Assets
- **Image slots (user-fillable placeholders)**: hero photo (`id="hero-photo"`, full-bleed) and an optional coaching photo (`id="coaching-photo"`). In the real app, replace with real documentary photography of kids working; hero shows solid `--blue` until filled. Prototype uses the `image-slot.js` web component (drag-drop placeholder) — not needed in production.
- **Design-system reference photos** (`_ds/.../assets/hero-science.webp`, `project-robotics.webp`) exist but are not placed on this page.
- No icons/illustrations.

## Files
- `2026-27 Program Page.dc.html` — the full page prototype (template + logic class with the `COPY` dictionary and all interaction state).
- `program-data.js` — editable content: `workshopDates`, `dateNotes` (+`dateNotesKid`), `pathSteps` (+`pathStepsKid`), `bookTracks`.
- `image-slot.js` — prototype-only web component for the fillable image placeholders.
- `support.js` — the Design Component runtime (prototype-only; do not port).
- `_ds/the-120-design-system-cdb8b763-5ad1-4de1-b3e4-fa05ba758e75/` — the bound 120 design system (token CSS + component bundle) the prototype loads. Mirror against the real design system in the codebase rather than copying these files.

To view the prototype: open `2026-27 Program Page.dc.html` in a browser (all dependencies are bundled in this folder).


---

## Screenshots
Reference captures of the built prototype live in `screenshots/` (desktop):
- `01-screen.png` — hero, Parents audience, group = The 120 (default overview subhead)
- `02-screen.png` — hero with the Athletes group selected (subhead swaps)
- `03-screen.png` — 01 · The Year at a glance (six stat cards)
- `04-screen.png` — 04 · Read widely (three-tab book tracks)
- `05-screen.png` — 05 · The Schedule (date grid + month/week)
- `06-screen.png` — 08 · The Path (stepper, pacing cards, accordion)
- `07-screen.png` — hero, Kids audience (copy rewritten to kid voice)
- `08-screen.png` — 08 · The Path in Kids view, showing the KID VOICE / ORIGINAL criteria sub-toggle

## Copy Appendix (exact strings, both audiences)
The page reads copy from a `COPY` object with `parents` and `kids` keys (same key set). Below, **P:** = Parents, **K:** = Kids. Group business lines and everything in `program-data.js` (workshop dates + notes, the 25 pass criteria, book lists) are single-voice or listed in that file — see "Data" at the end.

### CTA button labels (nav + red band)
- joinCta — P: "Join the 120" · K: "Get my seat"
- callCta — P: "Book a call" · K: "Show my parents"

### Hero
- Kicker — P: "THE 2026-27 YEAR · FOUNDING COHORT · TORONTO" · K: "THE 2026-27 YEAR · FIRST-EVER COHORT · TORONTO" (NOTE: the live hero currently shows the fixed group-mode kicker "THE 2026-27 YEAR · FIVE GROUPS · ONE PROGRAM"; the audience-specific kickers above remain in COPY for reference.)
- Headline is fixed group-mode copy: line1 "The 2026-27 year." / line2 (blush) "Your business."
- Subhead = group business line (see Group selector). Note line (fixed): "The program is to learn how to build a business - you adapt the plan to your business."

### 01 · Year at a glance
- Kicker — P: "01 · THE YEAR AT A GLANCE" · K: "01 · YOUR YEAR, QUICK VERSION"
- Headline accent — P: "At a glance." · K: "Here's the deal." (lead "One year." both)
- Card labels — P: Weekend workshops / The Path / Pass to move on / Three reading tracks / The writing habit / Learn math to run the numbers · K: Saturday workshops / The Path / Prove it to level up / Three reading tracks / The writing habit / Learn math to run the numbers
- (Card 6 label is the same both voices per latest direction. Descriptions differ in voice — Kids uses second person; see the file's COPY.kids for verbatim.)

### 02 · Who they become
- Kicker — P: "02 · WHO THEY BECOME" · K: "02 · WHO YOU BECOME"
- Headline — P: "Thoughtful," + "tech-native leaders." · K: "A sharp," + "tech-native builder."
- Card kickers — P: 01 WELL-GROUNDED ENTREPRENEUR / 02 DEEP THINKER / 03 AI EXPERT · K: 01 A REAL FOUNDER / 02 DEEP THINKER / 03 AI EXPERT
- Math callout kicker — P: "NO COMPROMISE ON MATH" · K: "NO SKIPPING MATH"

### 03 · Coaching
- Kicker — P: "03 · COACHING" · K: "03 · YOUR COACHES"
- Headline — P: "An entrepreneur in their corner." + "A room full of them." · K: "A founder in your corner." + "A whole room of them."
- Row labels — P: YOUR CHILD'S COACH / GUEST FOUNDERS / THE ADVISOR BENCH / PARENTS IN THE LOOP · K: YOUR COACH / GUEST FOUNDERS / THE ADVISOR BENCH / YOUR PARENTS, IN THE LOOP

### 04 · Read widely
- Kicker "04 · READ WIDELY" (both). Writing-habit kicker "40 WRITING EFFORTS · OPTIONAL" (both). Intro + writing body differ in voice (see COPY).

### 05 · Schedule
- Kicker "05 · THE SCHEDULE" (both). Block labels THE YEAR / THE MONTH / THE WEEK (both). "THE MONTH" at-home bullets and "THE WEEK" closing line differ in voice. Season labels FALL 2026 / WINTER 2027 / SPRING 2027.

### 06 · The Core Loop
- Kicker (both) "06 · THE CORE LOOP · EXPERTISE → AUDIENCE → PRODUCT". Headline accent — P: "compounds." · K: "stacks up." Card titles fixed: "Get good at something real." / "Share it until people listen." / "Build what the audience asks for."

### 07 · The Skill Track
- Kicker "07 · THE SKILL TRACK" (both). Pillars LIFE / ENTREPRENEURSHIP / AI with the 15 skill names (fixed). Level cards LEVEL 1–4 → STARTING / PRACTICING / SOLID / COULD TEACH IT (fixed); descriptions differ in voice.

### 08 · The Path
- Kicker (both) "08 · THE PATH · SELL → BUILD → VALIDATE → GROW → SCALE". Headline "Five Phases." + accent — P: "At your child's pace." · K: "At your pace." Pacing card titles PASS FIVE, MOVE ON / STUCK IS NORMAL / FINISH EARLY, GO DEEPER (fixed). Accordion "what parents see" label — P: "WHAT PARENTS SEE" · K: "WHAT YOU'LL PULL OFF".

### 09 · Math
- Kicker "09 · THE FOUNDATION" (both). Headline "Math at 2X, 3X, 4X speed." (fixed). Card rows THE CURRICULUM → Math Academy, THE SPEED LAYER → The Gauntlet (fixed names; descriptions differ in voice).

### 10 · End of Year
- Kicker "10 · END OF YEAR" (both). Headline "By June," + accent — P: "they've actually done it." · K: "you've actually done it." Six card figures fixed (A real sale / A real product / Real numbers / Up to 20 books / A stage moment / A tested mind); descriptions differ in voice.

### CTA band
- Headline fixed: "One year. One real business." + blush "One of 120." Subline (two lines) — P: "The founding cohort kicks off September 19, 2026." / "Seats are 120, and they're going." · K: "The first cohort kicks off September 19, 2026." / "There are only 120 seats, and they're going." Seats indicator: "113 OF 120 SEATS REMAIN".

## Data (single source, in `program-data.js`)
- **workshopDates** (19 dated + 1 "SPECIAL/TBD"): SEP 19 (kickoff), OCT 3, OCT 17, NOV 7★, NOV 21, DEC 5, DEC 19, JAN 9, JAN 23, FEB 6, FEB 20, MAR 6★, MAR 20, APR 3, APR 17, MAY 1, MAY 15, JUN 5★, JUN 19★, SPECIAL. ★ = Demo Day Workshop.
- **dateNotes / dateNotesKid** — the ★ legend, the winter-break note, and the special-session note (parent + kid voice).
- **pathSteps / pathStepsKid** — the five phases, each with subtitle, principle, "what you'll pull off" line, and **five pass criteria**. Kids view uses `pathStepsKid` unless the ORIGINAL sub-toggle is on, which shows `pathSteps` (the original criteria). Read the file for the verbatim 25 criteria in both voices.
- **bookTracks** — three grade tracks (3–5 / 6–8 / 9–12), each five path-phase groups of four books (title + author). Identical across audiences.
