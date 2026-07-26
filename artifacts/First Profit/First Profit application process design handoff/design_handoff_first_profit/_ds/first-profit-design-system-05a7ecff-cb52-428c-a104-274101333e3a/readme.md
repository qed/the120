# First Profit — Design System

**One app. Two skins. 125 real things done in the real world, verified by a real adult, celebrated like they matter.**

First Profit is the progress engine for **The 120's** entrepreneurship curriculum. The curriculum's work happens in the world — at booths, on doorsteps, in board meetings, on stage — across five phases (**Sell → Build → Validate → Grow → Scale**), 25 pass criteria, and 125 unit tasks. The app is where that journey is *seen*: a student tracks each step, files evidence that proves it happened, gets it verified by an adult, collects wisdom, and is celebrated in proportion to what was actually achieved.

**The one-sentence test for everything here:** *does this make a real thing a child did in the real world more visible, more verified, or more celebrated?*

### One engine, two skins
The mechanics never change; the skin and copy register switch:
- **HQ** — the founder dashboard. Clean, confident, Linear/Notion/Stripe sensibility. Plain founder-to-founder voice. Defaults for Grades 6–12.
- **Trail** — the illustrated journey game. Warm, storybook, collectible. Kid-register voice (never babyish). Defaults for Grades 3–5.

Everything earned carries across the toggle — the same crest/seal artwork, the same progress, two renderings. The skin toggle affects **only the student's view**; parents and Guides always see the grounded verifier interface.

---

## Sources

This system was reverse-engineered from an attached codebase (read-only, mounted locally). Nothing here assumes the reader has access — details are recorded in case they do.

- **Codebase:** `First Profit/` — a Vite + React + TypeScript + Tailwind app ("Magic Patterns" template). Design tokens lived in `src/index.css`; the Tailwind theme in `tailwind.config.js`; the component reference in `src/components/{system,hq,trail,showcase}`; sample data in `src/components/showcase/sampleData.ts`. Original Magic Patterns source design: https://www.magicpatterns.com/c/7mm4djvyajdd2m17u1coee
- **Briefs (source of truth for copy & structure):** `First Profit/first-profit-app-design-brief.md` (the two-skin visual system, states, celebration tiers, roles) and `First Profit/first-profit-home-study-curriculum-brief.md` (the 5 phases, 25 criteria, 125 tasks, band model, safety rules).
- **Imagery:** four evidence photographs from `First Profit/public/` → copied to `assets/evidence/`.

All tokens, colors, fonts, animation curves, and component behavior below are lifted from those files, not invented.

---

## CONTENT FUNDAMENTALS

How First Profit writes. The product ships **two copy registers for every string** — same meaning, two voices — and the register is chosen by skin, not by dumbing anything down.

- **HQ (founder register):** plain, confident, no cheerleading, quiet warmth. A founder spoken to as a founder. Verbs and numbers do the work. *"Phase 01 sealed. Real sales, real money, real no's. The Build phase is open."* · *"1.1.3 verified. 2 tasks remaining in criterion 1.1."*
- **Trail (kid register):** direct address, short sentences, verbs first, real respect. Never babyish, never sarcastic. *"THE GATE IS OPEN. You finished SELL. You sold real things to real people. Go celebrate — you earned it."*

**Casing & tone.**
- Phase names are set in **UPPERCASE** as proper nouns (SELL, BUILD, VALIDATE, GROW, SCALE). Everything else is sentence case. No Title Case headings.
- **"Not Yet," never "failed."** A declined task is *Not Yet* — information, not judgment. Every Not Yet points at the *Done when* line and carries the curriculum's line: *not done — yet.* No red, no error iconography, no broken streaks.
- **Second person, warm and direct** ("your satchel's in," "ask until one yes"). The student is *you*; the adult is named ("Dad is taking a look").
- **Numbers are respected and never inflated.** The only score is verified tasks (n/125), criteria (n/25), phases (n/5). No XP, no daily-login points, no vanity metrics. Real totals only: *"25 outreach attempts. 9 conversations. 2 yeses."*
- **Adult words are the best reward.** A verifier's comment ("You knocked on nine doors and never lost the smile") is surfaced prominently on verification.
- **The Done-when line is sacred** — always present tense, binary, answerable yes/no by a parent with no business background. *"Money from a non-family customer is in hand and the sale is logged."*
- **Emoji:** none. Meaning is carried by Lucide icons, crests, seals, and type.
- **Task IDs** are dotted `phase.criterion.task` (e.g. `2.3.4`) and always set in the mono face.

**Vibe:** earnest, grounded, a little ceremonial. The app is a scorekeeper for real achievement, so it never pretends — no simulated progress, no manufactured urgency, no shame for a slow week.

---

## VISUAL FOUNDATIONS

- **Color.** A warm neutral base — **ink on warm paper** (HQ) and **ink on parchment** (Trail) — never cool gray. The signature is the **five-phase spine**: one accent per phase (terracotta / steel blue / violet / green / gold), constant across skins and used everywhere progress shows. Verification has its own semantics: green *verified*, blue *awaiting*, **amber** *not-yet* (never red). Ceremony colors — **wax red** and **gold leaf** — are reserved for stamps, seals, and wins. At most one or two background tones per screen. See `tokens/colors.css`.
- **Type.** Three families with clear jobs: **Fraunces** (optical display serif) for headlines, celebration, Trail warmth, and crest/seal numerals; **Inter** for all UI and body; **Spline Sans Mono** for numbers treated with respect (task IDs, tallies, the n/125 meter, dates). Display is set tight (-0.02em); eyebrows are uppercase with wide tracking. See `tokens/typography.css`.
- **Backgrounds.** Solid warm surfaces, no gradients as decoration. Trail sits on parchment; HQ on near-white warm paper. Imagery (real evidence photos) provides the only "texture." The Trail world is illustrated in the full product (placeholder schematic here — see Caveats).
- **Imagery.** Warm, natural-light **documentary photography** — real kids doing real business (counting cash over a ledger, a doorstep delivery, a market stall). Golden-hour, faint film grain, candid. Never staged stock, never a simulation. The phase montage in celebrations is built from the student's *own* filed evidence.
- **Corner radii.** Generous and friendly: 8px buttons, 12px cards, 16–20px panels & Trail cards, full pills for chips, meters, and seals.
- **Cards.** HQ cards: 1px warm border, 12px radius, soft low shadow (`--tp-shadow-hq`); the "Now" card gets a colored left spine and a stronger shadow. Trail cards: 2px ink-tint border, 20px radius, and a warm "paper lift" shadow with a hard offset (`--tp-shadow-trail`) that reads like a printed sticker. No colored-left-border-only cards.
- **Shadows.** Warm-tinted (brown/ink), never neutral. Two HQ elevations (rest, raised) plus the distinctive Trail paper-lift.
- **Borders.** 1px warm border for HQ; 2px ink-tint for Trail. Dividers use the same border color; the review grid uses 1px gaps over a border fill.
- **Motion.** Proportional to achievement. Task motion is small and quick; celebration motion is spring-loaded and unmistakable. The signature is the **wax-stamp thump** — a scale/rotate overshoot (`--tp-ease-spring`, `cubic-bezier(0.34,1.56,0.64,1)`). Evidence under review **shimmers** gently (opacity loop). Wisdom cards **flutter** down; margin notes **slide** in; the phase seal **presses**. Nothing eases linear; everything honors `prefers-reduced-motion`.
- **Hover / press.** Hover: primary buttons darken (HQ) or brighten (Trail); secondary/ghost warm to a sunken tint. Press: a 1px downward nudge (`translateY(1px)`); Trail steps scale down slightly. Focus: a 2px ink ring on a surface-colored offset.
- **Transparency & blur.** Sparingly — sticky top bars use a translucent surface with an 8px backdrop blur. Accent tints use `color-mix` at 8–16% for chip/panel fills.
- **Layout.** App shells are a fixed left sidebar + scrolling content with a sticky top bar. Content is held to comfortable max-widths (≈720–1120px). Progress reads left-to-right (HQ ledger, meter) and as a journey (Trail map). Generous whitespace, especially in HQ.

---

## ICONOGRAPHY

- The icon set is **Lucide** — 2px stroke, round caps and joins — matching the warm-but-precise UI. The reference app imported `lucide-react`.
- This design system **inlines the subset it uses** as SVG through the **`Icon`** component (`components/primitives/Icon.jsx`), so components carry no runtime CDN dependency. Names cover nav (`compass`, `map`, `dashboard`), task states (`lock`, `stamp`, `check`, `clock`, `circle-dot`…), evidence (`image`, `video`, `file`, `link`, `camera`…), wisdom/celebration (`sparkles`, `quote`, `star`, `party`, `trophy`…), and the Trail world (`backpack`, `mountain`, `tent`, `flag`, `map-pin`). See `ICON_NAMES` for the full list; the full Lucide set is available from CDN for consumers who need more.
- **The logo is the five-step mark** — five ascending 3D steps, one per phase, recolored to the phase accents (SELL terracotta → BUILD blue → VALIDATE violet → GROW green → SCALE gold). Files: `assets/logo.svg` (mark), `assets/logo-lockup.svg` (mark + THE PATH in Inter ExtraBold, light surfaces), `assets/logo-original.png` (the supplied artwork, original palette). The compass glyph is now just an icon, not the app mark. **No emoji, no Unicode-glyph icons.**
- **Crests and seals are heraldic marks, not icons** — one artwork lineage rendered illustrated (Trail) or monochrome (HQ). See the `Crest` and `Seal` components.

---

## Components

All are React components, PascalCase named exports, exposed on `window.ThePathDesignSystem_05a7ec.*` from the compiled bundle. Each has a `.d.ts` contract, a `.prompt.md`, and a `@dsCard` preview.

**Primitives** (`components/primitives/`)
- **Icon** — the Lucide glyph set, inlined as SVG.
- **Button** — the shared action primitive (HQ crisp / Trail round; primary / secondary / ghost / accent).
- **SkinToggle** — the student's Trail↔HQ control.

**Status** (`components/status/`)
- **StatusChip** — the six task states as a pill (Not Yet is amber).
- **ProgressMeter** — the `n / 125 verified` credential bar, filling phase-by-phase.

**Awards** (`components/awards/`)
- **Crest** — the criterion badge (25), one lineage two finishes.
- **Seal** — the phase mark (5), wax (Trail) or monochrome (HQ).

**Tasks** (`components/tasks/`)
- **HQTaskCard** — the founder's task spec sheet.
- **TrailStep** — one illustrated step on the trail.

**Ledger** (`components/ledger/`)
- **PhaseRow** — one row of the HQ progress ledger.

**Review** (`components/review/`)
- **ReviewPanel** — the parent's split verification view.

**Wisdom** (`components/wisdom/`)
- **WisdomCard** — Trail Almanac card (collectible, favoritable).
- **MarginNote** — HQ Almanac pull-quote.

**Celebration** (`components/celebration/`)
- **PhaseSealCelebration** — the Tier-3 phase-sealed moment (both skins).

### Intentional additions
- **Icon** — the source used `lucide-react` directly. A single `Icon` wrapper is added so every component and kit draws from one glyph vocabulary at a consistent 2px stroke, with no runtime CDN dependency. This is the only component with no 1:1 counterpart in the source.

---

## UI kits

High-fidelity, click-through recreations of the product's surfaces, composed from the components. Each has its own `README.md`, `index.html`, `data.js`, and `app.jsx`.

- **`ui_kits/hq/`** — the HQ founder dashboard: Home (progress ledger + Now card), current task, Trophy Wall, Founder File, Almanac.
- **`ui_kits/trail/`** — the Trail journey game: the territory map, a landmark's step trail, the phase-seal celebration.
- **`ui_kits/parent/`** — the grounded verifier: Review Queue, split Review (verify / Not Yet), the multi-sibling family dashboard.

---

## Templates (consumer starting points)

Consuming projects see these in the template picker — each is a `templates/<slug>/` folder with a `.dc.html` entry that loads this system via its sibling `ds-base.js`. Tweakable props are noted.

- **HQ Founder Dashboard** (`templates/hq-dashboard/`) — meter + Now card + five-phase ledger. Tweak: `verified` (0–125).
- **Parent Review** (`templates/parent-review/`) — the split verification screen. Tweak: `reviewer`.
- **Trail Landmark** (`templates/trail-landmark/`) — a criterion's step trail on parchment + wisdom card. Tweak: `completedSteps` (0–6).
- **Phase Celebration** (`templates/phase-celebration/`) — the Tier-3 sealed moment. Tweaks: `phase`, `skin`.

In a consuming project, point each template's `ds-base.js` base line at the bound `_ds/<folder>` tree, and the `../../assets/…` image paths likewise.

---

## Foundations (Design System tab)

Specimen cards live in `guidelines/` (Colors, Type, Spacing, Brand groups) plus one `@dsCard` per component directory (Components group) and the three kits.

---

## Index / manifest (root folder)

- `styles.css` — **the entry point.** Links this one file. `@import`-only manifest → fonts + tokens + base + components.
- `tokens/` — `colors.css`, `typography.css`, `layout.css` (spacing/radius/elevation), `motion.css`.
- `base.css` — document defaults, link colors, type utilities (`.tp-display`, `.tp-mono`, `.tp-eyebrow`).
- `components.css` — the component class layer (consumed by the React components; ships to consumers).
- `components/` — the React components (`primitives/`, `status/`, `awards/`, `tasks/`, `ledger/`, `review/`, `wisdom/`, `celebration/`), each with `.jsx` + `.d.ts` + `.prompt.md` + a `@dsCard` HTML. Shared helper: `components/lib/phases.js`, `components/lib/types.d.ts`.
- `guidelines/` — foundation specimen cards.
- `ui_kits/` — `hq/`, `trail/`, `parent/`.
- `assets/` — `logo.svg` (mark), `logo-lockup.svg`, `logo-original.png` (supplied artwork), and `evidence/` (the four documentary photos: `booth.jpg`, `doorstep.jpg`, `handoff.jpg`, `product.jpg`).
- `templates/` — the four consumer templates (see above).
- `thumbnail.html` — the homepage tile.
- `SKILL.md` — Agent-Skills entry point.
- Generated (do not edit): `_ds_bundle.js`, `_ds_manifest.json`, `_adherence.oxlintrc.json`.

---

## Caveats & things to confirm

- **Logo colors were adapted.** The supplied logo (five ascending steps) arrived in its own palette (gold/blue/cyan/purple/magenta); per "maybe needing different colors," the vector recreation maps the five steps to the five phase accents in phase order. The original is preserved at `assets/logo-original.png` — say the word to keep the original palette instead.
- **Fonts load from Google Fonts** (Fraunces, Inter, Spline Sans Mono), matching the source app. These are the real brand fonts, not substitutions — no font-file swap was required. If you'd prefer self-hosted webfonts, send the files and I'll add `@font-face` rules.
- **Trail illustration is a placeholder.** The brief specifies a "full illustrated journey game" with commissioned world/character art (an explicit open question in the brief). The Trail UI kit renders a faithful *schematic* of that world from components; final art would replace the map/landmark visuals.
- **Crests are a single parametric heraldic template**, not 25 bespoke illustrations. The brief calls for 25 distinct crests (e.g. 1.3's built from three "no" marks). The lineage, color, and numeral system are here; bespoke per-criterion artwork is a content task.
