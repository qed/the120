# Handoff: The 120 — Marketing Site + Member Dashboard

## Overview
The 120 is a selective network of 120 kids (grades 3–8) in Toronto, organized into five groups: The Athletes, The Founders, The Makers, The Scholars (run as "GT Toronto"), and The Givers. Members get a screen-free Tin Can phone with the "120 Address Book," a mentored year-long project demoed at quarterly Toronto intensives, and accelerated academics. This bundle contains the full site design: public marketing pages (home, five group pages, GT Toronto sub-site, tuition, FAQ), the enrollment funnel (Join / Book a Call / Dossier), and internal views (Dashboard, Admin).

## About the Design Files
The files in `design_files/` are **design references created in HTML** — prototypes showing intended look and behavior, not production code to ship. Your task is to **recreate these designs in your target codebase's environment** (Next.js, React, Vue, whatever the project uses) with its established patterns and libraries. If no codebase exists yet, choose an appropriate framework (a simple Next.js or Astro site fits this project well) and implement the designs there.

Technical notes on reading the files:
- Each `.dc.html` file opens directly in a browser (they load a small runtime, `support.js` — you do not need to port it).
- All styling is **inline `style="..."` attributes** — every exact pixel value, color, and font setting is in the markup. Treat the HTML as the source of truth for measurements.
- Dynamic parts use `{{ mustache }}` holes plus a `class Component` script block at the bottom of each file — that script holds the data arrays (card content, FAQ copy, pricing lists) and simple state logic (FAQ accordion, seat counts). Port that data into your own components/CMS.
- `<x-import ... component-from-global-scope="image-slot">` marks a **drag-and-drop image placeholder** — in production this is simply an `<img>` / CSS `background-image` whose asset the client will provide.

## Fidelity
**High-fidelity.** Colors, typography, spacing, and copy are final design intent. Recreate pixel-perfectly, using the exact copy in the files (the copy has been deliberately edited — e.g. no em dashes, "group" not "tribe").

## Design Tokens

Colors:
- `#F7F6F3` — bone / page background (light pages)
- `#131416` — ink (primary text)
- `#55585E` — muted body text
- `#9FA2A7` — faint text / footer links
- `#E4E2DD`, `#D8D5CF` — hairline borders (light surfaces)
- `#0300ED` — electric blue (dark band + group-page background)
- `#D92632` — brand red (logo chip, primary CTA, accents)
- `#EFC5B8` — blush (italic accent + mono labels on dark surfaces)
- `#FFFFFF` — cards, nav bar, white CTA
- On dark surfaces: white at 0.6/0.68/0.75/0.85 opacity for secondary text; `rgba(255,255,255,0.24)` hairlines

Typography (Google Fonts):
- **Space Grotesk** (400/500/600/700) — UI + body. Body 15–19px, line-height 1.6–1.65.
- **Georgia** (serif, system) — display headlines. 36–72px, weight 400, letter-spacing -0.01em, line-height 1.02–1.12. Accent words italic in `#D92632` (light bg) or `#EFC5B8` (dark bg).
- **IBM Plex Mono** (400/500) — kicker labels (11–12px, letter-spacing 0.1–0.12em, uppercase, e.g. `01 · THE NETWORK`) and CTA button labels (13–14px, letter-spacing 0.04em, uppercase).

Other tokens:
- Radius: 10px (buttons), 14px (nav bar, cards), 18px (image slots), 100px (pills)
- Shadows: nav `0 4px 18px rgba(19,20,22,0.14)`; light cards `0 2px 14px rgba(19,20,22,0.06)`
- Content max-width 1240px, side padding 32–44px; section vertical padding 80–96px
- Separator character between mono label segments: `·`

## Shared Components

**Logo lockup**: red `#D92632` chip with white "120" (700 weight, 17px, padding 6px 9px, square corners) + stacked "The 120" (700, 17px) over a 9px letterspaced red sublabel ("TORONTO" or "GT TORONTO").

**Floating nav**: sticky at `top: 18px`, 20px side margins, white bg, radius 14px, nav shadow, padding 11px 22px. Left: logo lockup. Right: 14px text links, gap 18px, then two mono CTA buttons:
- BOOK A CALL — white/transparent with 1px `#D8D5CF` border, ink text, padding 11px 20px, radius 10px
- JOIN THE 120 — `#D92632` bg, white text, padding 12px 21px, radius 10px

**CTA pair (on dark/red surfaces)**: same mono style; white-filled button (ink text) + red-filled or white-bordered button. On the five group pages the pair is: BOOK A CALL (white bg `#FFFFFF`, ink text) + JOIN THE 120 (red bg `#D92632`, white text), both padding 16px 28px.

**Footer**: `#0300ED` bg, logo lockup, 13px `#9FA2A7` links, hairline `rgba(255,255,255,0.24)` above a 12px legal line.

**Seats indicator**: 8px red dot + mono 12px label `113 OF 120 SEATS REMAIN` (count is a variable; default shows 7 seats taken).

## Screens / Views

### Home (`Home.dc.html`)
1. **Hero**: full-bleed photo (min-height 780px) with vertical gradient (dark 0.18 top → transparent → dark 0.78 bottom); floating nav on top. Bottom-anchored Georgia headline 68px white: "There are *120 of them.* Is your kid one?" (italic part `#EFC5B8`), hairline, then 18px subhead + mono tagline "PART OF THE 2 HOUR LEARNING NETWORK".
2. **Intro + seats**: 18px muted paragraph left, seats indicator right.
3. **The five groups** (`id="groups"`): `#0300ED` band, kicker "FIVE GROUPS · ONE NETWORK", Georgia 44px "Every kid needs *their people*", right-aligned note "120 seats across 5 groups. Book a call or join today." Grid of 5 equal cards (gap 14px): bone `#F7F6F3` bg, radius 14px, min-height 250px, padding 22px 20px; each has 9.5px mono category, 26px Georgia name, 13px blurb, bottom mono CTA line ("ENROLLING NOW · BOOK OR JOIN →"; Scholars links to GT - Home with "ENROLLING NOW · GT TORONTO →"). All five cards are enrolling (same light style). Cards link to their group page.
4. **Membership is 3 things**: Georgia 42px heading "Membership is *3 things*"; 3-col grid, each column topped with 2px ink border: mono kicker (`01 · THE NETWORK`, `02 · THE PROJECT`, `03 · THE CRAFT`), 21px semibold title, 15px muted body.
5. **How it works** (`id="how"`): white band, 2-col; left kicker + Georgia 40px "Joining the 120" + paragraph; right: 3 rows (STEP 01–03) in a 120px/1fr grid with hairline dividers.
6. **Tuition teaser**: "Two prices. *Two ways in.*" + line "$3,000 CAD a year for Membership with math through Math Academy, or $15,000 for the Full Academic Core with TimeBack. Every group is enrolling now." + bordered "SEE TUITION →" button.
7. **CTA band**: `#D92632`, centered Georgia 52px white "Come join the network. *Come join the 120.*", subline, white JOIN + bordered BOOK buttons.
8. **Footer**.

### Group pages (The Athletes / Founders / Makers / Givers — one file each)
Full-viewport (min-height 100vh) `#0300ED` page with:
- **Background image slot** filling the page (client drops in a full-bleed photo; `background-size: cover; background-position: center top`) under the same gradient overlay as the Scholars/GT hero: `linear-gradient(rgba(19,20,22,0.18) 0%, rgba(19,20,22,0) 30%, rgba(19,20,22,0.02) 55%, rgba(19,20,22,0.78) 100%)`. Blue shows until an image is provided.
- Top bar: "← THE 120" mono link left, compact logo right.
- Bottom-anchored content (max-width 760px): blush mono kicker `GROUP 01 · ATHLETES · ENROLLING NOW` (02 · ENTREPRENEURS, 03 · CREATIVE, 05 · SERVICE), Georgia 72px "The *Athletes*" (italic name in `#EFC5B8`), 19px group-specific paragraph, CTA pair (white BOOK A CALL + red JOIN THE 120), then a small mono line "TIN CAN + ADDRESS BOOK INCLUDED · 3–5 HRS/WEEK · ...".
- Footer row above bottom edge: "All five groups enrolling now · See the groups" (links to `Home#groups`) left; mono "FOUNDING COHORT · FALL 2026 · TORONTO" right.
Each page's paragraph is specific to the group (see files for exact copy). The Scholars' page is the GT Toronto sub-site below.

### GT Toronto sub-site (`GT - Home`, `GT - How It Works`, `GT - The Full Program`, `GT - Advisors`, `GT - Intensives`)
GT - Home is a long-form page mirroring Home's system: photo hero with the gradient above; blue three-part product band; three alternating feature sections (Network / Project / Subject) each with a 460px rounded image slot; blue "founding year" key-dates grid (4 intensives); testimonial grid; three promises band; tuition split (left copy: Membership $3,000 / Full Academic Core $15,000 via GT Anywhere; right card: FULL ACADEMIC CORE · 2026–27, $15,000, checklist, red JOIN button); red CTA band; press strip; FAQ accordion (single-open, +/− toggles); large multi-column footer. The other GT pages follow the same vocabulary — see files.

### Tuition (`Tuition.dc.html`)
Hero: "Two price points. *One network.*" + explanation of the two tiers. Two-card grid:
- **Membership** (blue `#0300ED` card): $3,000 CAD / YEAR, "MOST FAMILIES" pill, checklist (Tin Can + Address Book, year-long project, math via Math Academy, four intensives, virtual cohorts), CTA pair (white BOOK A CALL + red JOIN THE 120), seats indicator. Explicitly **no TimeBack academics**.
- **Full Academic Core** (white card): $15,000 CAD / YEAR, checklist (everything in Membership plus 5 hrs/week TimeBack, 1–3 subjects of choice, weekly PhD-advisor 1:1, academics via Alpha Anywhere or GT Anywhere by group, Ontario homeschool support), bordered "SEE THE FULL PROGRAM" button.
Then a 3-col fine-print band and the red CTA band + footer.

### Funnel + internal (`Join`, `Book a Call`, `Dossier`, `Dashboard`, `Admin`, `FAQ`)
Same design system: account creation / call booking / child-profile ("dossier") flows and internal dashboards. See files for exact layouts, form styles, and state logic in the script blocks.

### Design System (`Design System.dc.html`)
A reference sheet of the identity (tokens, type, components). Useful as a visual companion to this README.

## Interactions & Behavior
- Nav is sticky (floats 18px from top over hero imagery).
- All CTAs navigate: JOIN THE 120 → Join page; BOOK A CALL → Book a Call page; group cards → group pages.
- FAQ accordions: one item open at a time; `+` / `−` indicator; first item open by default.
- Link colors: light pages `a { color: #131416 }` hover `#D92632`; dark pages `a { color: #F7F6F3 }` hover `#EFC5B8`. Smooth scrolling for `#groups` / `#how` anchors.
- Seat counts ("N OF 120 SEATS REMAIN") should come from one shared value (design default: 7 taken → 113 remain).
- No animations are specified beyond default hover color changes.
- Responsiveness is not designed; grids use fixed column counts at desktop width (~1240px content). Plan mobile stacking yourself, keeping the type hierarchy.

## State Management
- FAQ open-index (per accordion).
- Seats-taken count (shared, drives all "seats remain" labels).
- Dossier/Join/Dashboard forms hold local form state (see each file's script block for fields and status values).

## Assets
- `assets/mla-icon-*.svg` — icon marks (bone/ink/red variants).
- Photography in hero/feature slots currently uses placeholder URLs from gt.school's CDN and tincan.kids — **replace with licensed client photography**. Empty `image-slot` placeholders (group-page backgrounds) await client images.
- Fonts via Google Fonts: Space Grotesk, IBM Plex Mono (Georgia is a system font).
- "TIN CAN" trademark + legal line in footer must be kept.

## Screenshots
Full-page reference captures of every screen are in `screenshots/`, numbered to match the file list below (01-home … 18-design-system). Note: very tall pages are scaled to fit the capture cap, so use them for layout/color reference and the HTML files for exact pixel values. Group-page captures (02–05) show the state **before** a client photo is dropped into the full-bleed background slot (solid blue with the gradient overlay).

## Files
- `design_files/Home.dc.html` — main marketing page
- `design_files/The Athletes|Founders|Makers|Givers.dc.html` — group pages
- `design_files/GT - *.dc.html` — GT Toronto (The Scholars) sub-site
- `design_files/Tuition.dc.html`, `FAQ.dc.html` — pricing + FAQ
- `design_files/Join.dc.html`, `Book a Call.dc.html`, `Dossier.dc.html` — enrollment funnel
- `design_files/Dashboard.dc.html`, `Admin.dc.html` — signed-in views
- `design_files/Design System.dc.html` — identity reference
- `design_files/support.js`, `image-slot.js` — prototype runtime (do not port)
- `design_files/gt-workshops-data.js`, `gt-workshops.json` — workshop catalog data used by GT pages
- `design_files/assets/` — SVG icon marks
