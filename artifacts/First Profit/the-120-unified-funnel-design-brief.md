# The 120 — The Unified Funnel — Design Brief
**Home page → Group landing pages → First Profit application flow**

Status: Approved direction (Peter, 2026-07-23) · Open questions resolved same day (D9–D12) · Supersedes the marketing-surface routing assumptions in the Foundry/First Profit briefs where they conflict; the First Profit funnel itself (design_handoff_first_profit) is unchanged except where this brief says otherwise.

Companion documents:
- `artifacts/First Profit/First Profit application process design handoff/design_handoff_first_profit/README.md` — the funnel spec (landing → explainer → capture → doors → templates → quiz → compose → tasks → reveal → apply → deposit). Pixel-fidelity source of truth for every funnel screen.
- `artifacts/First Profit/the-120-interactive-application-design-brief.md` — vision, gate ladder, copy registers.
- `app/lib/site.ts` — single source of truth for groups, seats, tuition, dates.

---

## Decisions Log

| # | Decision | Ruling |
|---|---|---|
| D1 | Group landing pages vs. existing `/groups/[slug]` brochure pages | **The five First Profit group landing pages BECOME the group pages**, at `/groups/[slug]`. The current brochure treatment retires. |
| D2 | Scholars | Scholars get a group landing page at **`/groups/scholars`** like the other four; the home card points there. The existing `/scholars` program page **stays live but unlinked** from the card — its content is repurposed in a future story and future brief. |
| D3 | Door pre-selection | **Middle path.** A visitor arriving via a group landing page carries that group into the funnel: at "Five doors. Pick yours." their door is pre-selected and highlighted in its phase color; one tap confirms; switching is free and unremarkable. The switch is a tracked event. |
| D4 | 2026-27 page | **Supporting depth page, not a funnel step.** It exists for the diligence-minded parent. Linked from nav, landing FAQ, and nurture. Its CTAs reroute into Start Building. |
| D5 | The one spine | **First Profit is the spine.** For any logged-out visitor, the top-right red nav button — and every mid-page red CTA anywhere on the site — leads to the same place: the Start Building stage (the 3-page How It Works explainer, then capture). All links everywhere go to the same starting place. |
| D6 | Book a call | **Moves inside the funnel.** No "Book a call" on the logged-out marketing site. After Conversion 1 (email captured), the call is offered downstream: parent dashboard quiet link + nurture emails. The Join modal retires for new families. |
| D7 | Attribution | Extend the existing `src=` marker pattern (`cta-source.ts`): every entry surface stamps a source, carried into `/start` and written onto the lead at C1, so home-entry vs. each group-landing entry can be compared per conversion. |
| D8 | Generic landing | `/first-profit` survives as the sixth, group-neutral variant of the same landing template — the ad destination for broad (non-group) campaigns. Nothing internal links to it. |
| D9 | Door colors | **Confirmed:** door position → phase color (Athletes coral, Founders blue, Givers purple, Makers green, Scholars gold). §3.3 is authoritative; no prototype check needed. |
| D10 | CTA label | **Unified on "Start Here."** The nav button, landing heroes, red bands, depth pages — every CTA into the funnel reads **Start Here →**. "Start Building" survives only as the internal stage name for `/start`. |
| D11 | Home hero CTA | **The home hero gets its own red "Start Here →" CTA in this build**, routing to `/start?src=home`. |
| D12 | Nav order | **2026–27 keeps the leading nav slot** (2026–27 / Tuition / FAQ). The red Start Here button is the spine regardless of link order. |

---

# PART ONE — THE FLOW

## 1. The Shape

One spine, three entries, one starting place.

```
ENTRIES                          THE SPINE                                    THE LADDER
                                                                              (per child)
Ads (broad) ──→ /first-profit ─┐
                               │
Ads (group) ──→ /groups/[slug]─┤──→ /start ──→ Capture ──→ Add Children ──→  Doors → Templates
                               │    3-page      (C1)        (per child)      → Quiz → Compose
Organic/word ──→ Home ─────────┤    explainer                                → First 3 tasks
of mouth        │              │   "How It                                   → Reveal → Apply (C2)
                │five cards    │    Works"                                    → work → Deposit (C3)
                ▼              │                                              → Tuition (C4)
        /groups/[slug] ────────┘
        (5 group landing pages)

Depth, off-spine: /2026-27 · /tuition · /faq · /parents — every red CTA on them → /start
```

Three rules make it one system:

1. **Every red CTA for a logged-out visitor goes to `/start`.** The nav button, every mid-page band, every card footer. There is exactly one front door and it opens onto the explainer. (Signed-in users see Dashboard instead.)
2. **The five home-page cards are the only links that don't go to `/start`** — they go one step *sideways*, to the group landing pages, which exist to warm the visitor up before the same front door. Group cards route; red buttons convert.
3. **The group a visitor entered through follows them** as a hint, never a lock: pre-selected door, free to switch, tracked when they do.

## 2. Surface by Surface

### 2.1 The home page (the120.school)

The home page keeps its structure — Hero, GroupsBand, ThreeThings, HowItWorks, ParentStoriesBand, TuitionTeaser, CtaBand, Footer — with these changes:

**Nav.** The red top-right button becomes **"Start Here"** → `/start?src=home` (D10). The Join modal no longer opens from marketing surfaces. (Sign in remains for existing families.) Nav link order is unchanged: 2026–27 keeps the leading slot (D12).

**The blue band ("FIVE GROUPS · ONE NETWORK").** The five paper cards keep their category kicker, Georgia name, and blurb. The card footer line changes:

- Old: `ENROLLING NOW · BOOK OR JOIN →` (mono, red, same on all five)
- New: **`EXPLORE YOUR GROUP →`** (mono, same size/tracking), colored per group with the door colors from the funnel's "Five doors. Pick yours." screen — the five Path phase accents (§3.3). Each card links to its group landing page, `/groups/scholars` included (D2).

This is the first place the visitor meets the five-color system they'll see again at the doors — the band teaches the palette before the funnel uses it.

**CtaBand (bottom of page)** and **TuitionTeaser** CTAs → `/start?src=home`.

**Hero (D11):** gains its own red **"Start Here →"** CTA in this build → `/start?src=home`. Placement: in the bottom-anchored content block, below the subhead/tagline row, left-aligned with the headline — same red 10px-radius CTA treatment as the landing pages, sized like the group-page CTAs (`px-7 py-4 text-sm`). The mono FOUNDING COHORT tagline stays; the gradient's dark bottom zone already gives the button its contrast. The headline, divider, and subhead are otherwise unchanged.

### 2.2 The five group landing pages — `/groups/[slug]` (new canonical)

**These are the First Profit landing page (handoff screen #1), instantiated five times.** Same skeleton, ~90% shared content; only the hero image, the headline's first line, and the subhead change per group. Everything below the hero is identical across all five (and `/first-profit`):

Shared skeleton, in order (per the handoff, pixel-final there):
1. Floating white nav card — 120 chip, The 120 / TORONTO, mono-red CTA (label "Start Here", the unified label sitewide, D10).
2. Full-bleed hero image slot with the site gradient + text lightbox: seats line (mono, from the single source of truth), Georgia headline, divider, subhead, FOUNDING COHORT line, red **"Start Here →"** CTA → `/start?g=[slug]&src=lp-[slug]`.
3. Proof strip — "No simulations. No pretend points." + Real customers / Real money / Verified by real adults.
4. "What is The 120" paragraph (selective network, five groups, 3–5 hrs/week alongside school) — identical on all five; this paragraph is where the *network* is sold, so it must not become group-flavored.
5. Red CTA band — "The application is the first day of the business. *Start it now.*" → `/start?g=[slug]&src=lp-[slug]`.
6. Real site footer on `#0300ed`.

Per-group content — the 10%: see the matrix in §3.2. The headline's second line, italic blush, is **constant on all six variants**: *"We'll show you how right now."* One promise, five accents.

**What these pages no longer have:** Book a call (D6), the Join modal, the "← THE 120 / see the groups" brochure chrome. One exit, forward.

**`/first-profit` (D8):** the same template with the group-neutral headline ("Your kid will build a real business this year.") and the original multi-group subhead. Broad-ads destination only.

### 2.3 The funnel — Start Building onward

Everything from `/start` on is the First Profit handoff, unchanged except:

**The doors, pre-selected (D3).** When the session carries a group (`?g=` from a landing page), the "Five doors. Pick yours." screen renders that door pre-selected: arch numeral chip and card border in its phase color at full strength, the other four doors at rest. One line under the highlighted door, band register: Trail *"We saved this door for you."* / HQ *"Your door's already open."* The primary action confirms with one tap; tapping any other door switches instantly, with zero friction copy and no confirmation dialog — switching must feel like choosing, not correcting. No `?g=` (home entry, `/first-profit` entry, direct) → the doors render cold, exactly as in the handoff.

The hint is **family-level and first-child-only**: it pre-selects the door for the first child's run. Siblings pick cold — the ad told us about one kid, not all of them.

**Book a call, relocated (D6).** Nothing before C1 offers a call. After C1: a quiet mono link on the parent dashboard ("QUESTIONS? BOOK A CALL"), and the call offer inside nurture emails (the existing `lib/nurture` sequence) — both using `BOOKING_URL` with the attributed-URL helper. High-touch families still get their human, but only downstream of the one front door, so the funnel's top stays unforked and every call is an identified family, not an anonymous click.

### 2.4 The 2026-27 page — depth, off-spine (D4)

Not a step. The "read everything" page for parents doing diligence. It stays in the nav, is linked from the landing pages' FAQ accordion ("What is The 120?" row → "Read the full 2026-27 program"), and is a nurture destination for stalled families. Changes:

- **RedCtaBand and MidPageCta:** the Join button routes to `/start?src=2026-27`, labeled **"Start Here →"** for both audiences (D10 — the unified label wins over per-audience button copy; the toggle still drives the surrounding body copy). The **Book-a-call link is removed** per D6. The audience-toggle machinery and `SRC_MARKER` pattern stay.
- **Nav position:** 2026–27 keeps the leading nav slot (D12) — the depth page stays one click away even as the red button owns conversion.
- The page keeps its own `src=2026-27` marker so depth-page-assisted conversions remain attributable.

### 2.5 `/scholars` and the rest

`/scholars` stays live and reachable by URL, off the cards (D2); its CTAs reroute to `/start?src=scholars-legacy` in the meantime; repurposing is a future brief. `/tuition`, `/faq`, `/parents` keep their jobs as depth pages with every CTA rerouted to `/start` with their own `src` markers.

---

# PART TWO — BUILD SPEC

## 3.1 Routes & information architecture

| Route | What it is | Status |
|---|---|---|
| `/` | Home. Cards → group landing pages; red CTAs → `/start?src=home` | Modified |
| `/groups/athletes` `/groups/founders` `/groups/makers` `/groups/givers` `/groups/scholars` | The five group landing pages (First Profit landing template + group content) | **Rebuilt** (scholars: new route) |
| `/first-profit` | Group-neutral landing, broad ads only, nothing internal links to it | New |
| `/start` | Stage 2: 3-page How It Works explainer → capture (C1) → Add Children. Accepts `?g=` and `?src=` | New (from handoff screens 2–3) |
| Funnel scenes (handoff → doors → … → checkout → arrival) | Per the handoff; routing/state model per handoff §State | Per handoff |
| `/2026-27` `/tuition` `/faq` `/parents` | Depth pages, CTAs → `/start?src=…` | Modified |
| `/scholars` | Legacy, unlinked from cards, future repurpose | Held |

`groups` in `app/lib/site.ts` remains the single source of truth; extend each `Group` with the landing-page fields (headline line 1, subhead, hero asset, door/phase token) rather than creating a parallel content module. Scholars' `href` changes to `/groups/scholars`.

## 3.2 Per-group content matrix (the 10%)

Headline line 2 is constant: italic blush ***"We'll show you how right now."*** Final copy is Peter's call; these are the working candidates, in the register of headline C.

| Group | Headline line 1 (Georgia) | Subhead (group-first; final sentence constant) | Hero image direction |
|---|---|---|---|
| Athletes | "Your athlete will build a real brand this year." | "NIL branding, a training clinic for younger kids, team merch people actually buy. In 10 minutes, your kid designs their business and you see where this can go." | Kid running a paid skills clinic on a Toronto field, younger kids mid-drill, parent watching from the fence, cash box on the bench. |
| Founders | "Your kid will start a real company this year." | "A typical startup: a product, first customers, real revenue. In 10 minutes, your kid designs their business and you see where this can go." | The original market-stand scene from the Foundry brief prompt (kid mid-pitch, handing product to a customer). |
| Makers | "Your kid will sell real work to real people this year." | "Shows and exhibits, prints and commissions, an audience that pays. In 10 minutes, your kid designs their business and you see where this can go." | Kid at an art-fair booth handing over a wrapped print, hand-lettered price sign, golden hour. |
| Scholars | "Your kid's ideas will earn real money this year." | "Thought leadership: teaching, writing, tutoring, a paid workshop of their own. In 10 minutes, your kid designs their business and you see where this can go." | Kid presenting to a small library-meetup audience, flip chart with hand-drawn diagrams, adults leaning in. |
| Givers | "Your kid will run a real service venture this year." | "A service venture that changes a corner of the city, funded and run by them. In 10 minutes, your kid designs their business and you see where this can go." | Kid orchestrating a neighbourhood drive — clipboard, donation table, volunteers on task. |
| *(neutral, `/first-profit`)* | "Your kid will build a real business this year." | The handoff's original multi-group subhead. | Handoff's original prompt. |

Hero prompts: adapt the Nano Banana Pro prompt in the Foundry brief §Stage 1 (same style constraints: editorial documentary, golden hour, quiet upper third and lower quarter for the gradient + lightbox, no logos/text, 16:9) with the scene column above. Request the same variant axes (girl/boy, ethnicity range, winter version). Every variant must survive the dark gradient with faces out of the darkest zones.

## 3.3 The five door colors

From First Profit DS tokens (`_ds/…/tokens/colors.css`) — the five phase accents, constant across both skins:

| Door / Group | Token | HSL |
|---|---|---|
| 01 Athletes | `--tp-phase-sell` | `hsl(14 78% 54%)` (coral) |
| 02 Founders | `--tp-phase-build` | `hsl(217 74% 56%)` (blue) |
| 03 Givers | `--tp-phase-validate` | `hsl(265 52% 58%)` (purple) |
| 04 Makers | `--tp-phase-grow` | `hsl(150 52% 42%)` (green) |
| 05 Scholars | `--tp-phase-scale` | `hsl(41 88% 52%)` (gold) |

Mapping is by door position per the handoff's doors order (SPORT / ENTREPRENEURSHIP / SERVICE / CREATIVE / GIFTED & TALENTED). **Confirmed by Peter (D9)** — this table is authoritative for both the funnel doors and the home-card accents.

Usage on the home cards: the `EXPLORE YOUR GROUP →` footer line takes the group's phase color on the paper card. **Contrast check required at build time** — phase-scale gold at 52% lightness on `#f7f6f3` paper will likely fail small-text contrast; if so, apply a darkened text-safe variant of the same hue for the label and keep the raw token for any chip/underline accent. Same check on phase-sell coral. The doors screen inside the funnel is untouched (it already handles this in First Profit DS).

These tokens are the *only* Path-register colors allowed on the marketing site — they appear on the card footer line and the pre-selected door, nowhere else. The two-register rule from the handoff stands.

## 3.4 CTA reroute table (every existing surface)

| Surface (component) | Today | Becomes |
|---|---|---|
| Nav `JoinButton` (all marketing pages) | Opens Join modal | Red **Start Here** → `/start?src=[page]`; Dashboard when signed in |
| Home `Hero` | No CTA | Red **Start Here →** `/start?src=home` (D11) |
| Home `GroupsBand` cards | `/groups/[slug]`, `/scholars`; footer "ENROLLING NOW · BOOK OR JOIN →" | `/groups/[slug]` ×5 (incl. scholars); footer "EXPLORE YOUR GROUP →" in door color |
| Home `CtaBand`, `TuitionTeaser` | Join modal / tuition | `/start?src=home` |
| Group pages (rebuilt) | Book a call + Join | Single red **Start Here →** `/start?g=[slug]&src=lp-[slug]` |
| `/2026-27` `RedCtaBand` + `MidPageCta` | Join modal + Book a call (audience labels) | **Start Here →** `/start?src=2026-27` (unified label, D10); Book-a-call link removed |
| `/tuition`, `/faq`, `/parents`, `/scholars` CTAs | Join / Book mix | `/start?src=[page]` |
| Footer | Full sitemap | Unchanged (sitemap + sign in); no red CTA added |
| Post-C1 dashboard | — | Quiet mono link "QUESTIONS? BOOK A CALL" (`BOOKING_URL`, attributed) |
| Nurture emails (`lib/nurture`) | — | Call offer added to the sequence (own story) |

`BOOKING_URL` and `attributedBookingUrl()` survive; they simply stop appearing pre-C1.

## 3.5 Group carry & attribution mechanics

- **Carry:** `?g=[slug]` set only by group landing pages, read at `/start`, held in the funnel state as `entryGroup` (family-level). At the first child's doors screen: pre-select `entryGroup`; siblings and no-`g` sessions render cold. Pre-selection also pre-orders nothing else — templates render normally behind the confirmed door.
- **Source:** `?src=` set by every entry (`home`, `lp-athletes`, `lp-founders`, `lp-makers`, `lp-scholars`, `lp-givers`, `fp-generic`, `2026-27`, `tuition`, `faq`, `parents`, plus raw ad-platform params if present). Written onto the lead at C1 (`entry_source`) so the CRM can segment every downstream conversion by entry. This is the yardstick for the ads plan: run traffic to home vs. each landing page, compare C1→C2→C3 by `entry_source`, shift spend.
- **Events** (extends the handoff's C1–C4): `lp_view {group}`, `start_view {src, g}`, `c1_captured {entry_source}`, `door_confirmed {group, preselected: bool, switched_from: group|null}`, `c2_applied`, `c3_deposit`, `c4_tuition`. The `switched_from` rate per landing page is the ad-targeting health metric: a high Givers→Makers switch rate means the Givers ad is finding Maker kids.

## 3.6 Copy rules

The handoff's rules apply to every new surface: no em dashes in product copy, no promised outcomes, no dollar predictions, phases are "complete", "Not Yet" never "failed", mono for labels/IDs, no emoji outside Path DS iconography. Marketing register on all six landing pages is the application register (paper/ink/red/blue/blush, Georgia/Space Grotesk/IBM Plex Mono).

## 3.7 Non-goals (this brief)

- Repurposing `/scholars` content (future story + brief, per D2).
- The funnel screens themselves (handoff is authoritative), the Gauntlet, the CRM beyond `entry_source`, the nurture copy rewrite (the call-offer insertion is flagged but written in its own story), tuition-page redesign, ad creative.

## 3.8 Resolved questions (Peter, 2026-07-23)

All four open questions from the first draft are resolved and folded into the decisions log:

1. Door-position → phase-color mapping confirmed as written in §3.3 (D9).
2. CTA label unified on **"Start Here"** everywhere — nav button, heroes, bands (D10). "Start Building" remains only the internal name of the `/start` stage.
3. The home hero gets its own red **Start Here →** CTA in this build (D11); spec in §2.1.
4. `/2026-27` keeps the leading nav slot (D12).
