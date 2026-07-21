# The 120 — Design System

**True North editorial.** The design language of **The 120**, a selective network of **120 kids** in Toronto, ages 8–17, organized into five groups: the **Athletes**, the **Founders**, the **Makers**, the **Scholars** (run as *GT Toronto*), and the **Givers**. Members get a screen-free **Tin Can** phone with the "120 Address Book," a mentored year-long project demoed at quarterly Toronto intensives, and accelerated academics through the 2 Hour Learning network (Math Academy / TimeBack). Only 120 seats; the founding cohort opens Fall 2026.

The identity is warm editorial paper, near-black ink, one loud Canadian red, and electric-blue statement bands — Georgia display headlines against Space Grotesk UI, with IBM Plex Mono for every label. It reads like a serious, scarce, grown-up thing built for kids.

## Products
1. **Marketing site** (`the120.school`) — public recruitment: home, five group pages, GT Toronto sub-site, tuition, FAQ, and the enrollment funnel (Join / Book a Call / Dossier). Electric blue.
2. **Member dashboard** (`/dashboard`) — signed-in families build each child's *dossier* and track the path to a seat. **Electric** blue.
3. **Staff CRM** (`/crm`) — two-person admissions tool for the founding-cohort close: pipeline, dossier review queue, GTM sprint dashboard, content library. Electric blue, denser and quieter.
> **Out of scope: The Gauntlet / MathRaiders** (`/raiders`, `/gauntlet`). The gamified math arena is a deliberate **sub-brand with its own visual system** — expressive arena palette, boss artwork, and shake/hit/flash animations quarantined to that surface. **This design system does not apply to it.** Do not use these tokens, type, or components to build Gauntlet screens, and do not extend the system to cover it.

## Sources
Everything here is distilled from the attached codebase (read-only):
- **Codebase:** `120-The120/` — a Next.js 16 app (`app/`, `app/components/`, `app/crm/`, `app/dashboard/`). `app/globals.css` is the token ground truth.
- **Design handoff:** `120-The120/artifacts/The 120 Design Handoff/design_handoff_the120/` — `README.md`, HTML design references (`Home.dc.html`, group pages, `Tuition.dc.html`, `Dashboard.dc.html`, `Admin.dc.html`, `Design System.dc.html`), and full-page `screenshots/`.
- **CRM brief:** `120-The120/artifacts/crm-design-brief.md`.
- **Facts / copy:** `120-The120/app/lib/site.ts` (seats, tuition, the five groups, intensives).

> Note: an earlier handoff `Design System.dc.html` is branded "Maple Leaf Academy / GT Toronto" with an orbital logo mark. That naming and mark are **superseded** — the live brand is **The 120**, whose mark is pure type (see Iconography). Do not use the `mla-icon-*.svg` marks.

---

## CONTENT FUNDAMENTALS

**Voice: plain, confident, a little scarce. Written for parents, about their kid.**

- **Person.** Talks to "you"/"your child" and about "we." "Your child finds people…"; "We'll take it from there."
- **Casing.** Sentence case everywhere except mono labels, which are ALL CAPS and letterspaced. Georgia headlines are sentence case with one *italic accent phrase*.
- **The deliberate edits (honor these).** No em dashes in product copy — use a spaced hyphen or a period. Say **"group," never "tribe."** Canadian spelling: **enrolment, centre, neighbourhood**. Prices in **CAD**.
- **Numbers do the work.** "120 of them." "113 of 120 seats remain." "$3,000 CAD a year." "3–5 hours a week." "1400+ SAT by 8th grade." Scarcity is stated flatly and truthfully, never hyped.
- **Kickers as structure.** Sections open with a numbered mono kicker joined by `·`: `01 · THE NETWORK`, `FIVE GROUPS · ONE NETWORK`, `FOUNDING COHORT · FALL 2026 · TORONTO`.
- **CTAs are verbs in mono caps.** `JOIN THE 120`, `BOOK A CALL`, `SEE TUITION →`. The `→` arrow is the only decoration.
- **Compliance voice (funnel/CRM).** CASL consent is explicit and never pre-checked: "Yes — I consent to receive email and SMS updates… I can unsubscribe at any time." Guardrails: never call The 120 an "accredited school"; attribute network outcomes to the network.
- **Emoji:** never. Not part of the brand.
- **Example headline:** *"Every kid needs **their people**"* · *"Two prices. **Two ways in.**"* · *"Come join the network. **Come join the 120.**"*

---

## VISUAL FOUNDATIONS

- **Palette.** Bone paper (`#F7F6F3`) is the page; **white** is cards; **ink** (`#131416`) is text, dark statement bands, and primary buttons. **Canadian red** (`#D92632`) is scarce and loud — one accent per viewport (the Join CTA, a key numeral, an italic word). **Electric blue** `#0300ED` is the one brand blue on every statement band, the footer, and the whole signed-in app (dashboard + CRM). **Blush** `#EFC5B8` carries italic accents and mono labels on dark surfaces.
- **Type.** Three families, strict roles. **Georgia** (system serif, weight 400, tracking −0.01em, line-height ~1.08) for display headlines with an *italic accent word* in red (light) or blush (dark). **Space Grotesk** for all UI, subheads, body (15–19px, line-height 1.6), and numerals (bold, tight). **IBM Plex Mono** (400/500, uppercase, 0.06–0.12em tracking) for kickers, data labels, pills, and CTA button labels.
- **Backgrounds.** Flat colour blocks, no gradients in the system (the one exception: the hero photo's vertical dark-to-transparent protection gradient, `rgba(19,20,22,0.18)` top → `0.78` bottom, so white type reads over imagery). No textures or patterns, except a faint hairline grid + a single cropped oversized mark on the legacy "statement band" motif. Statement bands are solid ink or solid blue.
- **Imagery.** Real, warm, documentary photography of kids working — full-bleed in the hero (min-height ~780px, object-position tuned), rounded (18px) in feature slots. Never illustration, never stock-slick.
- **Cards.** Square-ish: 14px radius on marketing cards + nav, 12px on CRM cards/inputs. **Hairline borders** (`#E4E2DD` on light, `#DDDAD4` on admin) — not shadows — define most cards. The resting card shadow is barely there (`0 2px 14px rgba(19,20,22,0.06)`); the floating nav gets `0 4px 18px rgba(19,20,22,0.14)`; a selected CRM row gets a soft electric-blue glow.
- **Buttons.** 10px radius, mono uppercase labels, letterspaced. Red primary (one per view) + ghost/bordered secondary; on dark surfaces, white-filled + white-bordered.
- **Motion.** Restrained. Short ease-out fades and a **1px lift** on hover (`translateY(-4px)` on group cards); no bounces, no parallax. Anchor scrolling is instant (long pages made smooth scroll feel dizzying). `prefers-reduced-motion` respected. The MathRaiders game is the one place with expressive keyframes (shakes, floats, hit flashes) — quarantined to that surface.
- **Hover / press.** Links go ink → red (light) or bone → blush (dark). Buttons darken (`red` → `red-dark`) or brighten on dark (`red` → `red-bright`) and lift 1px; press returns to baseline quickly. Ghost buttons fill on hover.
- **Borders & dividers.** 1px hairlines do most structural work; forms use 1.5px borders that go ink on focus. Section dividers are a hairline, occasionally with a small centered mark (used once per page).
- **Transparency & blur.** Sparse. On dark surfaces, secondary text is white at 0.6/0.7/0.75/0.85; hairlines are `rgba(255,255,255,0.24)`. No frosted glass / backdrop-blur in the system.
- **Radii recap.** 10 button · 12 CRM card/input · 14 nav + marketing card · 18 image slot · 100 pill/chip.
- **Layout.** Content max-width 1240px; side padding 32–44px; section vertical padding 80–96px. Marketing grids are fixed desktop column counts; the app is desktop-first (must merely survive on mobile).

---

## ICONOGRAPHY

**The 120 is almost entirely icon-free — the iconography is typographic.** This is deliberate and central to the look.

- **No icon library.** The codebase ships no Lucide / Heroicons / Font Awesome / icon font (confirmed in `package.json`). Do not introduce one. If a UI genuinely needs a glyph, prefer a Unicode arrow.
- **The one recurring glyph is `→`** (rightwards arrow), used on CTAs and pipeline steps.
- **Separators use `·`** (middle dot) between mono label segments.
- **Status is carried by pills and pips, not icons:** mono uppercase status pills, an 8px **red dot** for the seats indicator, five 8px red **squares** for CRM heat, numbered mono indices (`01 / 02 / 03`) for ordered content.
- **The brand mark is type, not an SVG:** a solid red square chip containing white **"120"** beside the **"The 120"** wordmark over a letterspaced sublabel (`TORONTO` / `GT TORONTO`). The favicon is the same "120" badge (`app/icon.tsx`). There is **no separate logo file** — render the `Wordmark` component. The legacy `mla-icon-*.svg` orbital marks belong to the retired "Maple Leaf Academy" identity; do not use them.
- **Checkmarks (`✓`) and `+ / −`** appear as plain characters (consent confirmed, FAQ accordion toggles) — no icon assets.
- The lone inline SVG in the codebase is a data line-graph in `PaceSimulator` — a chart, not an icon.

---

## Foundations (Design System tab)
Specimen cards live in `guidelines/*.card.html`, grouped **Brand · Colors · Type · Spacing**. Tokens live in `tokens/` (`colors.css`, `typography.css`, `spacing.css`, `fonts.css`, `base.css`), all imported by root **`styles.css`** — the single file consumers link. Webfonts (Space Grotesk, IBM Plex Mono) load from Google Fonts; Georgia is a system serif.

## Components
Reusable primitives in `components/<group>/`. Import from `window.The120DesignSystem_cdb8b7`.

**brand/** — `Wordmark` · `SeatsDot` · `Kicker` · `DisplayHeading`
**actions/** — `Button`
**forms/** — `TextField` · `Select` · `Checkbox`
**content/** — `GroupCard` · `StatCard` · `TestimonialCard` · `FeatureCard` · `FaqItem`
**crm/** — `StatusPill` · `HeatPips` · `FilterChip` · `PitchCard`

Each directory has a `*.card.html` thumbnail and each component a `.d.ts` + `.prompt.md`.

## UI Kits
- `ui_kits/marketing-site/` — The 120 homepage (hero, five groups, membership, proof, tuition, FAQ, CTA, footer) with the Join modal.
- `ui_kits/member-dashboard/` — signed-in family Overview (dossier cards, completeness, path to a seat).
- `ui_kits/staff-crm/` — admissions CRM: dossier review two-pane + family pipeline table.

## Root manifest
- `styles.css` — token/font entry point (consumers link this).
- `tokens/` — colors, typography, spacing, fonts, base.
- `guidelines/` — foundation specimen cards.
- `components/` — brand, actions, forms, content, crm.
- `ui_kits/` — marketing-site, member-dashboard, staff-crm.
- `assets/` — `hero-science.webp`, `project-robotics.webp` (real reference photography). No logo file — the mark is the `Wordmark` component.
- `thumbnail.html` — project tile.
- `SKILL.md` — Agent-Skills manifest.

## Caveats
- **Fonts:** Space Grotesk + IBM Plex Mono load from Google Fonts (matching the app's `next/font`), not self-hosted `@font-face` — so the compiler reports 0 fonts. Flag if you need self-hosted binaries.
- **No group-page / GT Toronto / tuition / funnel kits yet**, and **no MathRaiders kit** — the design system covers the home page, dashboard, and CRM. Say the word to add the rest.
- Blue is unified to **electric `#0300ED`** across every surface (marketing, dashboard, CRM). The codebase had briefly deepened the marketing site to indigo `#22219B`; per direction that split is removed — one blue everywhere.
